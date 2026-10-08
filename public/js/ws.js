// WebSocket client for /ws with automatic reconnect (exponential backoff with jitter),
// ping/pong based server clock offset and a reconnect banner.
//
// Server -> client messages (see docs/ARCHITEKTURA.md):
//   { type: 'snapshot', state, events, serverTime }
//   { type: 'event', event }
//   { type: 'state', state }
//   { type: 'clear' }
//   { type: 'gap', sinceId, dropped }   client fell behind, events after sinceId must be fetched via REST
//   { type: 'pong', serverTime }

const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 10000;
const PING_INTERVAL_MS = 10000;

export function createWsClient({
  url = null,
  bannerEl = null,
  onOpen = null,
  onClose = null,
  onSnapshot = null,
  onEvent = null,
  onState = null,
  onClear = null,
  onGap = null,
  onPong = null,
  onStatus = null,
} = {}) {
  let ws = null;
  let attempt = 0;
  let closedByUser = false;
  let reconnectTimer = null;
  let pingTimer = null;
  let pingSentAt = 0;
  let offsetMs = 0;
  let offsetKnown = false;
  let rttMs = null;
  let status = 'connecting';
  let everConnected = false;

  function resolveUrl() {
    if (url) return url;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function setStatus(next, extra = {}) {
    status = next;
    // The first attempt after the page loads is not a failure yet, so it shows no banner.
    if (bannerEl) bannerEl.hidden = next === 'open' || (next === 'connecting' && attempt === 0);
    if (typeof onStatus === 'function') {
      try {
        onStatus(next, { attempt, rttMs, offsetMs, everConnected, ...extra });
      } catch (err) {
        console.error('ws onStatus handler failed', err);
      }
    }
  }

  function safeCall(fn, ...args) {
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (err) {
      console.error('ws handler failed', err);
    }
  }

  /** Update the server clock offset from a server time sample (approximate when rtt unknown). */
  function updateOffset(serverTime, rtt = null) {
    if (!serverTime) return;
    const serverMs = Number.isFinite(serverTime.tsMs) ? serverTime.tsMs : Date.parse(serverTime.ts);
    if (!Number.isFinite(serverMs)) return;
    const localNow = Date.now();
    // Server stamped the time roughly half the round trip before we received it.
    const estimatedLocalAtStamp = rtt !== null ? localNow - rtt / 2 : localNow;
    offsetMs = serverMs - estimatedLocalAtStamp;
    offsetKnown = true;
  }

  function sendPing() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    pingSentAt = performance.now();
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
    } catch (err) {
      console.error('ws ping failed', err);
    }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(sendPing, PING_INTERVAL_MS);
    sendPing();
  }

  function stopPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }

  function handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      console.warn('ws: invalid JSON frame ignored', err);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'snapshot':
        updateOffset(msg.serverTime);
        safeCall(onSnapshot, msg);
        break;
      case 'event':
        if (msg.event) safeCall(onEvent, msg.event);
        break;
      case 'state':
        if (msg.state) {
          if (!offsetKnown && msg.state.serverTime) updateOffset(msg.state.serverTime);
          safeCall(onState, msg.state);
        }
        break;
      case 'clear':
        safeCall(onClear);
        break;
      case 'gap':
        safeCall(onGap, msg);
        break;
      case 'pong': {
        rttMs = pingSentAt ? performance.now() - pingSentAt : null;
        updateOffset(msg.serverTime, rttMs);
        safeCall(onPong, { serverTime: msg.serverTime, rttMs, offsetMs });
        setStatus('open');
        break;
      }
      default:
        break;
    }
  }

  function scheduleReconnect() {
    if (closedByUser || reconnectTimer) return;
    const base = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** Math.min(attempt, 6));
    const jitter = Math.floor(Math.random() * 250);
    const delay = base + jitter;
    attempt += 1;
    setStatus('reconnecting', { delayMs: delay });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (closedByUser) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    setStatus(everConnected ? 'reconnecting' : 'connecting');
    let socket;
    try {
      socket = new WebSocket(resolveUrl());
    } catch (err) {
      console.error('ws: cannot create socket', err);
      scheduleReconnect();
      return;
    }
    ws = socket;
    socket.addEventListener('open', () => {
      if (socket !== ws) return;
      attempt = 0;
      everConnected = true;
      setStatus('open');
      startPing();
      safeCall(onOpen);
    });
    socket.addEventListener('message', (e) => {
      if (socket !== ws) return;
      handleMessage(typeof e.data === 'string' ? e.data : '');
    });
    socket.addEventListener('error', () => {
      // 'close' always follows 'error'; nothing to do here except logging.
      console.warn('ws: socket error');
    });
    socket.addEventListener('close', (e) => {
      if (socket !== ws) return;
      stopPing();
      ws = null;
      safeCall(onClose, { code: e.code, reason: e.reason });
      if (!closedByUser) scheduleReconnect();
      else setStatus('closed');
    });
  }

  function close() {
    closedByUser = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    stopPing();
    if (ws) {
      try {
        ws.close();
      } catch (err) {
        console.error('ws close failed', err);
      }
    }
    ws = null;
    setStatus('closed');
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (err) {
      console.error('ws send failed', err);
      return false;
    }
  }

  /** Reconnect immediately (e.g. when the user clicks the banner). */
  function reconnectNow() {
    if (closedByUser) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (ws && ws.readyState === WebSocket.OPEN) return;
    connect();
  }

  // Reconnect quickly when the tab becomes visible again or the network is back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && status !== 'open') reconnectNow();
  });
  window.addEventListener('online', () => {
    if (status !== 'open') reconnectNow();
  });

  return {
    connect,
    close,
    send,
    reconnectNow,
    isOpen: () => !!ws && ws.readyState === WebSocket.OPEN,
    getStatus: () => status,
    getOffsetMs: () => offsetMs,
    isOffsetKnown: () => offsetKnown,
    getRttMs: () => rttMs,
    /** Current server time in epoch ms (local clock corrected by the measured offset). */
    serverNowMs: () => Date.now() + offsetMs,
  };
}
