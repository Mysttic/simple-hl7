// Express REST API + WebSocket live feed for the UI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { now } from '../core/events.js';
import { tokenize } from '../hl7/tokenize.js';
import { buildAck } from '../hl7/ack.js';
import { ACK_CODES } from '../hl7/dictionary.js';
import { sanitizeConfig, isPlainObject } from '../config.js';
import { AppError } from '../app.js';
import { IS_EXE, APP_ROOT, readAsset } from '../runtime.js';

const LEVELS = ['info', 'warn', 'error'];
const EXPORT_FORMATS = ['ndjson', 'csv'];
const LIB_FILE_RE = /^[A-Za-z0-9_-]+\.js$/;
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const STATE_THROTTLE_MS = 250;
const HEARTBEAT_MS = 2000;
const MAX_WS_BUFFERED = 16 * 1024 * 1024;
const MISSED_PONGS_LIMIT = 5;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Exe mode: send an embedded asset. Returns false when the asset does not exist. */
function sendAsset(req, res, key) {
  const buf = readAsset(key);
  if (!buf) return false;
  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(key)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', buf.length);
  res.end(req.method === 'HEAD' ? undefined : buf);
  return true;
}

function wrap(handler) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function intParam(query, name, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = first(query[name]);
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AppError(400, `Query parameter '${name}' must be an integer between ${min} and ${max}`);
  }
  return n;
}

function strParam(query, name) {
  const raw = first(query[name]);
  if (raw === undefined || raw === null) return null;
  const s = String(raw);
  return s === '' ? null : s;
}

function eventFilters(query, { defaultLimit, maxLimit }) {
  const typesRaw = strParam(query, 'types');
  const types = typesRaw ? typesRaw.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const level = strParam(query, 'level');
  if (level !== null && !LEVELS.includes(level)) {
    throw new AppError(400, `Query parameter 'level' must be one of: ${LEVELS.join(', ')}`);
  }
  return {
    sinceId: intParam(query, 'sinceId', 0),
    limit: intParam(query, 'limit', defaultLimit, { min: 1, max: maxLimit }),
    types: types && types.length ? types : null,
    endpointId: strParam(query, 'endpointId'),
    text: strParam(query, 'text'),
    level
  };
}

function body(req) {
  return isPlainObject(req.body) ? req.body : {};
}

function requireName(value, label) {
  if (typeof value !== 'string' || !NAME_RE.test(value)) {
    throw new AppError(400, `${label} must match ^[A-Za-z0-9_.-]+$`);
  }
  return value;
}

function exportFileName(format) {
  const stamp = now().ts.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  return `simple-hl7-events-${stamp}.${format}`;
}

export function createWebServer(app, { host = '0.0.0.0', port = 7575, staticDir, libDir } = {}) {
  if (!app || typeof app.state !== 'function') {
    throw new TypeError('createWebServer: app must be an App instance');
  }
  const rootDir = app.rootDir ?? APP_ROOT;
  const publicDir = staticDir ?? path.join(rootDir, 'public');
  const hl7LibDir = libDir ?? path.join(rootDir, 'src/hl7');

  const api = express();
  api.disable('x-powered-by');
  api.set('etag', false);
  api.use(express.json({ limit: '20mb', strict: false }));

  // ---- REST ---------------------------------------------------------------

  api.get('/api/health', (req, res) => {
    res.json({ ok: true, uptimeMs: app.uptimeMs(), version: app.version });
  });

  api.get('/api/state', (req, res) => {
    res.json(app.state());
  });

  api.get('/api/listeners', (req, res) => {
    res.json(app.listenerStatuses());
  });

  api.post('/api/listeners', wrap(async (req, res) => {
    const status = await app.addListener(body(req));
    scheduleState();
    res.status(201).json(status);
  }));

  api.put('/api/listeners/:id', wrap(async (req, res) => {
    const status = await app.updateListener(requireName(req.params.id, 'Listener id'), body(req));
    scheduleState();
    res.json(status);
  }));

  api.delete('/api/listeners/:id', wrap(async (req, res) => {
    await app.removeListener(requireName(req.params.id, 'Listener id'));
    scheduleState();
    res.status(204).end();
  }));

  api.post('/api/listeners/:id/start', wrap(async (req, res) => {
    const status = await app.startListener(requireName(req.params.id, 'Listener id'));
    scheduleState();
    res.json(status);
  }));

  api.post('/api/listeners/:id/stop', wrap(async (req, res) => {
    const status = await app.stopListener(requireName(req.params.id, 'Listener id'));
    scheduleState();
    res.json(status);
  }));

  api.post('/api/send', wrap(async (req, res) => {
    const result = await app.send(body(req));
    res.json(result);
  }));

  api.get('/api/events', (req, res) => {
    const filters = eventFilters(req.query, { defaultLimit: 500, maxLimit: 1_000_000 });
    res.json({ events: app.events.list(filters), stats: app.events.stats() });
  });

  api.delete('/api/events', (req, res) => {
    app.events.clear();
    res.status(204).end();
  });

  api.get('/api/events/export', (req, res) => {
    const format = strParam(req.query, 'format') ?? 'ndjson';
    if (!EXPORT_FORMATS.includes(format)) {
      throw new AppError(400, `Query parameter 'format' must be one of: ${EXPORT_FORMATS.join(', ')}`);
    }
    const filters = eventFilters(req.query, { defaultLimit: 100000, maxLimit: 10_000_000 });
    const events = app.events.list(filters);
    let content;
    let contentType;
    if (format === 'csv') {
      content = app.events.toCsv(events);
      contentType = 'text/csv; charset=utf-8';
    } else {
      content = app.events.toNdjson(events);
      contentType = 'application/x-ndjson; charset=utf-8';
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(format)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(content);
  });

  api.get('/api/events/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new AppError(400, 'Event id must be a positive integer');
    const event = app.events.get(id);
    if (!event) throw new AppError(404, `Event ${id} not found`);
    res.json(event);
  });

  api.post('/api/parse', (req, res) => {
    const { text, prefixHex, suffixHex } = body(req);
    if (typeof text !== 'string') throw new AppError(400, "'text' is required and must be a string");
    res.json(app.parse(text, { prefixHex, suffixHex }));
  });

  api.post('/api/ack/preview', (req, res) => {
    const { text, code, textMessage, errorCode, template } = body(req);
    if (typeof text !== 'string' || !text.trim()) throw new AppError(400, "'text' is required and must be a non-empty string");
    const opts = {};
    if (code !== undefined && code !== null && code !== '') {
      if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) {
        throw new AppError(400, `'code' must be a two-letter acknowledgment code (${Object.keys(ACK_CODES).join(', ')})`);
      }
      opts.code = code;
    }
    if (textMessage !== undefined && textMessage !== null) {
      if (typeof textMessage !== 'string') throw new AppError(400, "'textMessage' must be a string");
      opts.textMessage = textMessage;
    }
    if (errorCode !== undefined && errorCode !== null && errorCode !== '') {
      if (!['string', 'number'].includes(typeof errorCode)) throw new AppError(400, "'errorCode' must be a string or number");
      opts.errorCode = String(errorCode);
    }
    if (template !== undefined && template !== null && template !== '') {
      if (typeof template !== 'string') throw new AppError(400, "'template' must be a string");
      opts.template = template;
      opts.ctx = { vars: {} };
    }
    let ack;
    try {
      ack = buildAck(text, opts);
    } catch (err) {
      throw new AppError(400, `Cannot build ACK: ${err.message}`);
    }
    res.json({ ack, tokens: tokenize(ack) });
  });

  api.get('/api/examples', (req, res) => {
    res.json(app.examples());
  });

  api.get('/api/scenarios', (req, res) => {
    res.json(app.scenarios.list());
  });

  api.get('/api/scenarios/runs', (req, res) => {
    res.json(app.scenarios.runs);
  });

  api.get('/api/scenarios/runs/:runId', (req, res) => {
    const runId = req.params.runId;
    if (typeof runId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(runId)) throw new AppError(400, 'Invalid run id');
    const run = app.scenarios.get(runId);
    if (!run) throw new AppError(404, `Scenario run '${runId}' not found`);
    res.json(run);
  });

  api.post('/api/scenarios/:name/run', wrap(async (req, res) => {
    const name = req.params.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\\/\u0000]/.test(name)) {
      throw new AppError(400, 'Invalid scenario name');
    }
    const { overrides } = body(req);
    if (overrides !== undefined && overrides !== null && !isPlainObject(overrides)) {
      throw new AppError(400, "'overrides' must be an object");
    }
    const pending = app.scenarios.run(name, overrides ?? {});
    // from now on the list shows the scenario as running, with its stop button
    scheduleState();
    const run = await pending;
    scheduleState();
    res.json(run);
  }));

  api.post('/api/scenarios/:name/stop', (req, res) => {
    const name = req.params.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\\/\u0000]/.test(name)) {
      throw new AppError(400, 'Invalid scenario name');
    }
    const result = app.scenarios.stop(name);
    scheduleState();
    res.json(result);
  });

  api.get('/api/config', (req, res) => {
    res.json(sanitizeConfig(app.config));
  });

  api.put('/api/config/ui', (req, res) => {
    const ui = app.updateUiConfig(body(req));
    scheduleState();
    res.json(ui);
  });

  // ---- browser-safe HL7 modules under /lib/ ---------------------------------

  api.get('/lib/:file', (req, res, next) => {
    const file = req.params.file;
    if (typeof file !== 'string' || !LIB_FILE_RE.test(file) || file === 'encoding.js') {
      res.status(404).json({ error: `Not found: /lib/${file}` });
      return;
    }
    if (IS_EXE && !libDir) {
      if (!sendAsset(req, res, `lib/${file}`)) res.status(404).json({ error: `Not found: /lib/${file}` });
      return;
    }
    const full = path.join(hl7LibDir, file);
    if (!full.startsWith(path.resolve(hl7LibDir))) {
      res.status(404).json({ error: `Not found: /lib/${file}` });
      return;
    }
    fs.stat(full, (err, stat) => {
      if (err || !stat.isFile()) {
        res.status(404).json({ error: `Not found: /lib/${file}` });
        return;
      }
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(full, (sendErr) => {
        if (sendErr && !res.headersSent) next(sendErr);
      });
    });
  });

  // ---- static UI --------------------------------------------------------------

  if (IS_EXE && !staticDir) {
    api.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const rel = req.path === '/' ? '/index.html' : req.path;
      if (rel.includes('..')) return next();
      if (!sendAsset(req, res, `public${rel}`)) next();
    });
  } else {
    api.use(express.static(publicDir, { index: 'index.html', etag: true, maxAge: 0, fallthrough: true }));
  }

  api.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  // Final error handler: readable JSON, never leaks stack traces to the client.
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600
      ? err.status
      : (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500);
    let message = err?.message ? String(err.message) : 'Internal server error';
    if (err?.type === 'entity.parse.failed') message = `Invalid JSON body: ${message}`;
    if (err?.type === 'entity.too.large') message = 'Request body too large (limit 20mb)';
    if (status >= 500) {
      console.error(`[web] ${req.method} ${req.originalUrl}: ${err?.stack ?? message}`);
      try {
        app.events.push({
          source: 'system', endpointId: 'system', connId: null, type: 'system.error', direction: null, level: 'error',
          summary: `HTTP ${status} on ${req.method} ${req.path}: ${message}`, latencyMs: null,
          data: { code: err?.code ?? 'E_HTTP', message, method: req.method, path: req.path }
        });
      } catch { /* event store unavailable, console already has it */ }
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json({ error: message });
  });

  // ---- HTTP + WebSocket ------------------------------------------------------

  const httpServer = http.createServer(api);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  let listening = false;
  let actualPort = null;
  let heartbeat = null;
  let stateTimer = null;
  let lastStateMono = -Infinity;
  let stopping = false;

  function safeState() {
    try {
      return app.state();
    } catch (err) {
      console.error(`[web] app.state() failed: ${err?.stack ?? err}`);
      return null;
    }
  }

  function serialize(message) {
    try {
      return JSON.stringify(message);
    } catch (err) {
      console.error(`[web] cannot serialize ws message of type ${message?.type}: ${err.message}`);
      return null;
    }
  }

  function sendTo(ws, payload) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_WS_BUFFERED) {
      ws.droppedMessages = (ws.droppedMessages ?? 0) + 1;
      return;
    }
    ws.send(payload, (err) => {
      if (err) ws.terminate();
    });
  }

  function broadcast(message) {
    if (wss.clients.size === 0) return;
    const payload = serialize(message);
    if (payload === null) return;
    for (const ws of wss.clients) sendTo(ws, payload);
  }

  // A client that falls behind (bufferedAmount over the limit, e.g. after a multi MB message)
  // stops receiving events. Instead of losing them silently we remember the last id it got and,
  // once its buffer has drained, send { type: 'gap', sinceId } so the UI backfills via REST.
  function flushGap(ws) {
    const sinceId = ws.gapSinceId;
    ws.gapSinceId = null;
    const payload = serialize({ type: 'gap', sinceId, dropped: ws.droppedMessages ?? 0 });
    ws.droppedMessages = 0;
    if (payload) ws.send(payload, (err) => { if (err) ws.terminate(); });
  }

  function sendEvent(ws, payload, eventId) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.gapSinceId != null) {
      if (ws.bufferedAmount > MAX_WS_BUFFERED / 2) {
        ws.droppedMessages = (ws.droppedMessages ?? 0) + 1;
        return;
      }
      flushGap(ws);
    }
    if (ws.bufferedAmount > MAX_WS_BUFFERED) {
      ws.gapSinceId = eventId - 1;
      ws.droppedMessages = (ws.droppedMessages ?? 0) + 1;
      return;
    }
    ws.send(payload, (err) => {
      if (err) ws.terminate();
    });
  }

  function broadcastEvent(event) {
    if (wss.clients.size === 0) return;
    const payload = serialize({ type: 'event', event });
    if (payload === null) return;
    for (const ws of wss.clients) sendEvent(ws, payload, event.id);
  }

  function sendState() {
    stateTimer = null;
    lastStateMono = now().mono;
    const state = safeState();
    if (state) broadcast({ type: 'state', state });
  }

  function scheduleState() {
    if (stopping || wss.clients.size === 0 || stateTimer) return;
    const elapsed = now().mono - lastStateMono;
    if (elapsed >= STATE_THROTTLE_MS) {
      sendState();
    } else {
      stateTimer = setTimeout(sendState, Math.max(1, STATE_THROTTLE_MS - elapsed));
    }
  }

  const onEvent = (event) => broadcastEvent(event);
  const onClear = () => broadcast({ type: 'clear' });
  const onStatus = () => scheduleState();

  app.events.on('event', onEvent);
  app.events.on('clear', onClear);
  if (typeof app.on === 'function') app.on('status', onStatus);

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = null;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      pathname = null;
    }
    if (pathname !== '/ws' || stopping) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.missedPongs = 0;
    ws.on('pong', () => { ws.missedPongs = 0; });
    ws.on('error', (err) => {
      console.error(`[ws] client error: ${err?.message ?? err}`);
    });
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString('utf8'));
      } catch {
        sendTo(ws, serialize({ type: 'error', error: 'Invalid JSON' }));
        return;
      }
      if (isPlainObject(msg) && msg.type === 'ping') {
        sendTo(ws, serialize({ type: 'pong', serverTime: now() }));
      }
    });
    const snapshot = serialize({ type: 'snapshot', state: safeState(), events: app.events.last(500), serverTime: now() });
    if (snapshot) sendTo(ws, snapshot);
  });

  wss.on('error', (err) => {
    console.error(`[ws] server error: ${err?.message ?? err}`);
  });

  function heartbeatTick() {
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.gapSinceId != null && ws.bufferedAmount <= MAX_WS_BUFFERED / 2) flushGap(ws);
      if (ws.missedPongs >= MISSED_PONGS_LIMIT) {
        ws.terminate();
        continue;
      }
      ws.missedPongs += 1;
      try { ws.ping(); } catch { ws.terminate(); }
    }
    scheduleState();
  }

  function start() {
    return new Promise((resolve, reject) => {
      if (listening) {
        resolve({ port: actualPort });
        return;
      }
      const onError = (err) => {
        httpServer.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        httpServer.off('error', onError);
        listening = true;
        stopping = false;
        actualPort = httpServer.address().port;
        httpServer.on('error', (err) => {
          console.error(`[web] http server error: ${err?.message ?? err}`);
        });
        heartbeat = setInterval(heartbeatTick, HEARTBEAT_MS);
        if (typeof heartbeat.unref === 'function') heartbeat.unref();
        resolve({ port: actualPort });
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port, host);
    });
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; }
    app.events.off('event', onEvent);
    app.events.off('clear', onClear);
    if (typeof app.off === 'function') app.off('status', onStatus);
    for (const ws of wss.clients) {
      try { ws.close(1001, 'Server shutting down'); } catch { /* ignore */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const ws of wss.clients) {
      try { ws.terminate(); } catch { /* ignore */ }
    }
    await new Promise((resolve) => wss.close(() => resolve()));
    if (!listening) return;
    await new Promise((resolve) => {
      httpServer.close(() => resolve());
      if (typeof httpServer.closeAllConnections === 'function') httpServer.closeAllConnections();
    });
    listening = false;
  }

  return { start, stop, httpServer, app: api, wss };
}
