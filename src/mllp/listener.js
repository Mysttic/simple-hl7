// MLLP listener: accepts TCP connections, decodes frames, verifies framing, parses the
// payload through an injected parser and answers with an ACK built by an injected builder.
// Every step is recorded in the EventStore with millisecond timestamps; processing latency is
// measured from the monotonic clock (frame completed -> ACK flushed to the socket).
// This module must not import anything from src/hl7 (all HL7 logic is injected via deps).

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { bufferToHex, hexToBuffer, normalizeHex } from '../core/hex.js';
import { now } from '../core/events.js';
import { FrameDecoder, analyzeFraming, frame as frameBytes } from './framing.js';

export const DEFAULT_LISTENER_CONFIG = {
  id: 'default',
  name: 'Default listener',
  host: '0.0.0.0',
  port: 2575,
  prefixHex: '0B',
  suffixHex: '1C0D',
  encoding: 'utf8',
  ack: {
    mode: 'AA',
    delayMs: 0,
    template: null,
    prefixHex: null,
    suffixHex: null,
    textMessage: '',
    errorCode: null,
  },
  keepConnection: true,
  idleTimeoutMs: 0,
  frameTimeoutMs: 3000,         // > 0: bytes of an unfinished frame (no suffix yet) are reported as frame.incomplete (reason 'timeout') after this many ms without new data; the connection stays open
  maxMessageBytes: 10485760,
  autoStart: true,
  logBytes: true,
};

const RESTART_KEYS = ['host', 'port', 'prefixHex', 'suffixHex', 'encoding'];
const ACK_MODES = new Set(['AA', 'AE', 'AR', 'none', 'custom']);
const PREVIEW_BYTES = 32;
const END_GRACE_MS = 2000;

const FALLBACK_ENCODING = {
  encode: (text) => Buffer.from(String(text), 'utf8'),
  decode: (buf) => Buffer.from(buf).toString('utf8'),
};

export class MllpListener extends EventEmitter {
  /**
   * @param {object} config partial listener config (merged over DEFAULT_LISTENER_CONFIG)
   * @param {object} deps { events, ackBuilder, parse, encoding }
   */
  constructor(config, deps) {
    super();
    this.setMaxListeners(0);
    this._config = mergeConfig(DEFAULT_LISTENER_CONFIG, config);
    this._deps = normalizeDeps(deps);
    this._server = null;
    this._state = 'stopped';
    this._error = null;
    this._boundPort = null;
    this._active = null; // { prefix, suffix } framing of the running server
    this._ackFraming = null; // { prefix, suffix } used for outgoing ACKs
    this._sockets = new Map(); // socket -> conn
    this._connCounter = 0;
    this._startPromise = null;
    this._stopPromise = null;
    this._stopping = false;
    this._stats = {
      messages: 0,
      acksSent: 0,
      acksSkipped: 0,
      bytesIn: 0,
      bytesOut: 0,
      framingErrors: 0,
      garbageBytes: 0,
      incompleteFrames: 0,
      parseErrors: 0,
      connectionsTotal: 0,
      lastMessageTs: null,
      processingCount: 0,
      processingSum: 0,
      minProcessingMs: null,
      maxProcessingMs: null,
    };
  }

  get config() {
    return deepClone(this._config);
  }

  get id() {
    return this._config.id;
  }

  get state() {
    return this._state;
  }

  /**
   * Merge a partial config. Validates (throws Error with a readable message, nothing applied
   * on failure). Returns { restartRequired } when host/port/prefix/suffix/encoding changed.
   */
  updateConfig(partial) {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
      throw new Error('updateConfig expects a config object');
    }
    const incoming = { ...partial };
    delete incoming.id; // the id is the registry key, it never changes through updateConfig
    const next = mergeConfig(this._config, incoming);
    const compiled = validateConfig(next);
    const restartRequired = RESTART_KEYS.some((key) => !sameValue(key, this._config[key], next[key]));
    this._config = next;
    // ACK framing defaults to the framing of the server that is actually running
    const base = this._active || { prefix: compiled.prefix, suffix: compiled.suffix };
    this._ackFraming = resolveAckFraming(next, base);
    for (const conn of this._sockets.values()) {
      conn.decoder.maxMessageBytes = next.maxMessageBytes;
      this._applyIdleTimeout(conn);
    }
    this.emit('status', this.status());
    return { restartRequired };
  }

  /** Resolves when listening; rejects (and pushes listener.error) on EADDRINUSE etc. */
  start() {
    if (this._state === 'listening' && this._server) return Promise.resolve();
    if (this._startPromise) return this._startPromise;

    this._startPromise = new Promise((resolve, reject) => {
      let compiled;
      try {
        compiled = validateConfig(this._config);
      } catch (err) {
        this._error = err.message;
        this._setState('error');
        this._push({
          type: 'listener.error',
          level: 'error',
          summary: `Invalid listener config: ${err.message}`,
          data: { code: 'EINVAL', message: err.message },
        });
        reject(err);
        return;
      }

      const cfg = this._config;
      this._active = { prefix: compiled.prefix, suffix: compiled.suffix };
      this._ackFraming = resolveAckFraming(cfg, this._active);
      this._error = null;
      this._setState('starting');

      const server = net.createServer({ allowHalfOpen: false });
      this._server = server;
      let settled = false;

      server.on('connection', (socket) => this._onConnection(socket));

      server.once('listening', () => {
        settled = true;
        const addr = server.address();
        this._boundPort = addr && typeof addr === 'object' ? addr.port : cfg.port;
        this._setState('listening');
        this._push({
          type: 'listener.started',
          summary: `Listening on ${cfg.host}:${this._boundPort} (prefix ${compiled.prefixHex || 'none'}, suffix ${compiled.suffixHex || 'none'}, ${cfg.encoding})`,
          data: {
            host: cfg.host,
            port: this._boundPort,
            prefixHex: compiled.prefixHex,
            suffixHex: compiled.suffixHex,
            encoding: cfg.encoding,
            ack: deepClone(cfg.ack),
          },
        });
        resolve();
      });

      server.on('error', (err) => {
        const code = err && err.code ? err.code : 'ERROR';
        const message = err && err.message ? err.message : String(err);
        this._error = `${code}: ${message}`;
        this._push({
          type: 'listener.error',
          level: 'error',
          summary: `Listener error on ${cfg.host}:${cfg.port}: ${message}`,
          data: { code, message },
        });
        if (!settled) {
          settled = true;
          if (this._server === server) this._server = null;
          this._setState('error');
          reject(err);
        } else {
          this._setState('error');
        }
      });

      server.on('close', () => {
        if (this._server !== server) return;
        this._server = null;
        this._boundPort = null;
        if (!this._stopping && this._state === 'listening') {
          this._setState('stopped');
          this._push({ type: 'listener.stopped', summary: 'Listener closed', data: { reason: 'close' } });
        }
      });

      try {
        server.listen(cfg.port, cfg.host);
      } catch (err) {
        // synchronous listen errors (e.g. invalid host type) surface the same way as async ones
        server.emit('error', err);
      }
    }).finally(() => {
      this._startPromise = null;
    });
    return this._startPromise;
  }

  /** Destroys open sockets and closes the server. Idempotent. */
  stop() {
    if (this._stopPromise) return this._stopPromise;
    const pre = this._startPromise ? this._startPromise.catch(() => {}) : Promise.resolve();
    this._stopPromise = pre.then(() => new Promise((resolve) => {
      const server = this._server;
      if (!server) {
        if (this._state !== 'stopped') this._setState('stopped');
        resolve();
        return;
      }
      this._stopping = true;
      const socketClosed = [];
      for (const conn of this._sockets.values()) {
        socketClosed.push(new Promise((done) => conn.socket.once('close', done)));
        conn.socket.destroy();
      }
      server.close(() => {
        Promise.all(socketClosed).then(() => {
          if (this._server === server) this._server = null;
          this._boundPort = null;
          this._stopping = false;
          this._setState('stopped');
          this._push({ type: 'listener.stopped', summary: 'Listener stopped', data: { reason: 'stop' } });
          resolve();
        });
      });
    })).finally(() => {
      this._stopPromise = null;
    });
    return this._stopPromise;
  }

  status() {
    const cfg = this._config;
    const s = this._stats;
    return {
      id: cfg.id,
      name: cfg.name,
      host: cfg.host,
      port: this._boundPort != null ? this._boundPort : cfg.port,
      state: this._state,
      error: this._error,
      connections: this._sockets.size,
      config: deepClone(cfg),
      stats: {
        messages: s.messages,
        acksSent: s.acksSent,
        acksSkipped: s.acksSkipped,
        bytesIn: s.bytesIn,
        bytesOut: s.bytesOut,
        framingErrors: s.framingErrors,
        garbageBytes: s.garbageBytes,
        incompleteFrames: s.incompleteFrames,
        parseErrors: s.parseErrors,
        connectionsTotal: s.connectionsTotal,
        lastMessageTs: s.lastMessageTs,
        avgProcessingMs: s.processingCount ? round3(s.processingSum / s.processingCount) : null,
        maxProcessingMs: s.maxProcessingMs,
        minProcessingMs: s.minProcessingMs,
      },
    };
  }

  // ---------------------------------------------------------------------------------------------

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    this.emit('status', this.status());
  }

  _push(partial) {
    return this._deps.events.push({
      source: 'listener',
      endpointId: this._config.id,
      connId: null,
      direction: null,
      level: 'info',
      latencyMs: null,
      data: {},
      ...partial,
    });
  }

  _onConnection(socket) {
    const t = now();
    const connId = `${this._config.id}#${++this._connCounter}`;
    const decoder = new FrameDecoder({
      prefix: this._active.prefix,
      suffix: this._active.suffix,
      maxMessageBytes: this._config.maxMessageBytes,
    });
    const conn = {
      id: connId,
      socket,
      decoder,
      openedMono: t.mono,
      bytesIn: 0,
      bytesOut: 0,
      messages: 0,
      hadError: false,
      closed: false,
      queue: Promise.resolve(),
      endTimer: null,
      frameTimer: null,
      busy: 0,
    };
    this._sockets.set(socket, conn);
    this._stats.connectionsTotal += 1;
    socket.setNoDelay(true);

    this._push({
      type: 'conn.open',
      connId,
      summary: `Connection from ${socket.remoteAddress}:${socket.remotePort}`,
      data: { remoteAddress: socket.remoteAddress || null, remotePort: socket.remotePort || null, localPort: socket.localPort || null },
    });
    this.emit('status', this.status());

    decoder.on('frame', (f) => {
      // frames on one connection are processed strictly in order (MLLP is request/response)
      conn.busy += 1;
      conn.queue = conn.queue
        .then(() => this._handleFrame(conn, f))
        .catch((err) => this._pushConnError(conn, err, 'frame handling failed'))
        .finally(() => { conn.busy -= 1; });
    });
    decoder.on('incomplete', ({ bytes, reason }) => {
      this._stats.incompleteFrames += 1;
      this._stats.framingErrors += 1;
      const framing = analyzeFraming(bytes, this._active);
      this._push({
        type: 'frame.incomplete',
        connId,
        direction: 'in',
        level: 'warn',
        summary: `${bytes.length} byte(s) without suffix flushed on ${reason} (suffix expected ${framing.suffixHexExpected || 'none'}, got ${framing.suffixHexActual || 'none'})`,
        data: { hex: bufferToHex(bytes, ''), length: bytes.length, text: this._safeDecode(bytes), framing, reason },
      });
    });
    decoder.on('error', (err) => {
      this._stats.framingErrors += 1;
      this._pushConnError(conn, err, 'frame decoder error');
    });

    socket.on('data', (chunk) => {
      conn.bytesIn += chunk.length;
      this._stats.bytesIn += chunk.length;
      if (this._config.logBytes) {
        this._push({
          type: 'bytes.in',
          connId,
          direction: 'in',
          summary: `${chunk.length} byte(s) received`,
          data: { length: chunk.length, previewHex: bufferToHex(chunk.subarray(0, PREVIEW_BYTES), ''), totalBytesOnConn: conn.bytesIn },
        });
      }
      try {
        decoder.push(chunk);
      } catch (err) {
        this._pushConnError(conn, err, 'decoder push failed');
      }
      this._armFrameTimer(conn);
    });

    socket.on('error', (err) => {
      conn.hadError = true;
      this._pushConnError(conn, err, 'socket error');
    });

    socket.on('timeout', () => {
      // an ACK that is still being prepared (ack.delayMs) is not idleness: wait for it
      if (conn.busy > 0) return;
      decoder.flush('idle');
      socket.end();
      conn.endTimer = setTimeout(() => socket.destroy(), END_GRACE_MS);
    });

    socket.on('close', (hadError) => {
      conn.closed = true;
      if (conn.endTimer) clearTimeout(conn.endTimer);
      if (conn.frameTimer) clearTimeout(conn.frameTimer);
      decoder.flush('close');
      this._sockets.delete(socket);
      const tc = now();
      this._push({
        type: 'conn.close',
        connId,
        summary: `Connection closed after ${conn.messages} message(s)`,
        data: {
          durationMs: round3(tc.mono - conn.openedMono),
          bytesIn: conn.bytesIn,
          bytesOut: conn.bytesOut,
          messages: conn.messages,
          hadError: Boolean(hadError) || conn.hadError,
        },
      });
      this.emit('status', this.status());
    });

    this._applyIdleTimeout(conn);
  }

  // Without this a gateway that sends a wrong suffix on a persistent connection is invisible
  // until it disconnects: the bytes just sit in the decoder waiting for a suffix that never comes.
  _armFrameTimer(conn) {
    if (conn.frameTimer) clearTimeout(conn.frameTimer);
    conn.frameTimer = null;
    const ms = Number(this._config.frameTimeoutMs) || 0;
    if (ms <= 0 || conn.closed || conn.decoder.pending().length === 0) return;
    conn.frameTimer = setTimeout(() => {
      conn.frameTimer = null;
      if (!conn.closed) conn.decoder.flush('timeout');
    }, ms);
  }

  _applyIdleTimeout(conn) {
    const ms = Number(this._config.idleTimeoutMs) || 0;
    conn.socket.setTimeout(ms > 0 ? ms : 0);
  }

  async _handleFrame(conn, f) {
    const cfg = this._config;
    const connId = conn.id;
    const raw = f.raw;
    const framing = analyzeFraming(raw, this._active);
    const text = this._safeDecode(f.payload);
    // Wrong prefix (e.g. 00 instead of 0B) leaves stray leading bytes in the payload. Keep them
    // in `text` (that is what arrived) but parse and ACK the message from its MSH segment so the
    // ACK still carries the right control id.
    const stray = framing.prefixOk ? null : /^[^A-Za-z0-9]{1,16}(?=MSH)/.exec(text);
    const parseText = stray ? text.slice(stray[0].length) : text;

    let summary = null;
    let parseError;
    try {
      summary = this._deps.parse(parseText);
      if (summary === undefined) summary = null;
    } catch (err) {
      summary = null;
      parseError = err && err.message ? err.message : String(err);
    }
    if (summary === null && parseError === undefined) parseError = 'Message could not be parsed';

    const controlId = summary && summary.controlId ? String(summary.controlId) : null;
    const label = describeMessage(summary, controlId);
    const receiveMs = round3(f.completedMono - f.startedMono);
    const framingOk = framing.prefixOk && framing.suffixOk;
    // optional deps.encoding.check(payload, msh18, usedEncoding) -> string[] (MSH-18 vs bytes vs config)
    let encodingWarnings = [];
    if (typeof this._deps.encoding.check === 'function') {
      try {
        encodingWarnings = this._deps.encoding.check(f.payload, summary ? summary.characterSet : null, cfg.encoding) || [];
      } catch (err) {
        encodingWarnings = [`Encoding check failed: ${err && err.message ? err.message : err}`];
      }
    }

    conn.messages += 1;
    this._stats.messages += 1;
    this._stats.lastMessageTs = f.completedTs;
    if (!framingOk) this._stats.framingErrors += 1;
    if (summary === null) this._stats.parseErrors += 1;

    const msgData = {
      raw: { hex: bufferToHex(raw, ''), length: raw.length },
      text,
      encoding: cfg.encoding,
      framing,
      summary,
      timing: { firstByteTs: f.startedTs, lastByteTs: f.completedTs, receiveMs, bytes: raw.length },
    };
    if (stray) {
      msgData.strayLeadingBytes = stray[0].length;
      this._stats.garbageBytes += stray[0].length;
    }
    if (encodingWarnings.length) msgData.encodingWarnings = encodingWarnings;
    if (summary === null) msgData.parseError = parseError;

    const msgEvent = this._push({
      type: 'msg.in',
      connId,
      direction: 'in',
      level: framingOk && summary !== null && encodingWarnings.length === 0 ? 'info' : 'warn',
      latencyMs: receiveMs,
      summary: `Received ${label} (${raw.length} bytes)${framingOk ? '' : ', framing mismatch'}${summary === null ? ', unparseable' : ''}${encodingWarnings.length ? ', encoding mismatch' : ''}`,
      data: msgData,
    });
    this.emit('message', { event: msgEvent });

    if (cfg.ack.mode === 'none') {
      this._stats.acksSkipped += 1;
      this._push({
        type: 'ack.skipped',
        connId,
        summary: `ACK skipped for ${controlId || 'unknown control id'} (mode none)`,
        data: { inReplyTo: controlId, reason: 'mode none' },
      });
      if (!cfg.keepConnection) conn.socket.end();
      return;
    }

    let ackText = null;
    try {
      ackText = this._deps.ackBuilder({ text: parseText, raw, summary, config: deepClone(cfg) });
    } catch (err) {
      this._stats.acksSkipped += 1;
      this._push({
        type: 'ack.skipped',
        connId,
        level: 'error',
        summary: `ACK builder failed for ${controlId || 'unknown control id'}: ${err.message}`,
        data: { inReplyTo: controlId, reason: `ack builder failed: ${err.message}` },
      });
      if (!cfg.keepConnection) conn.socket.end();
      return;
    }
    if (typeof ackText !== 'string' || ackText.length === 0) {
      this._stats.acksSkipped += 1;
      this._push({
        type: 'ack.skipped',
        connId,
        level: 'warn',
        summary: `ACK skipped for ${controlId || 'unknown control id'} (builder returned no ACK)`,
        data: { inReplyTo: controlId, reason: 'ack builder returned null' },
      });
      if (!cfg.keepConnection) conn.socket.end();
      return;
    }

    const delayMs = Math.max(0, Number(cfg.ack.delayMs) || 0);
    if (delayMs > 0) await sleep(delayMs);

    const socket = conn.socket;
    if (conn.closed || socket.destroyed) {
      this._stats.acksSkipped += 1;
      this._push({
        type: 'ack.skipped',
        connId,
        level: 'warn',
        summary: `ACK not sent for ${controlId || 'unknown control id'}: connection already closed`,
        data: { inReplyTo: controlId, reason: 'connection closed before ACK' },
      });
      return;
    }

    let ackBuf;
    const ackFraming = this._ackFraming || this._active;
    try {
      ackBuf = frameBytes(this._deps.encoding.encode(ackText, cfg.encoding), ackFraming);
    } catch (err) {
      this._stats.acksSkipped += 1;
      this._push({
        type: 'ack.skipped',
        connId,
        level: 'error',
        summary: `ACK encoding failed for ${controlId || 'unknown control id'}: ${err.message}`,
        data: { inReplyTo: controlId, reason: `ack encoding failed: ${err.message}` },
      });
      return;
    }

    await new Promise((resolve) => {
      socket.write(ackBuf, (err) => {
        const t = now();
        const processingMs = round3(t.mono - f.completedMono);
        if (err) {
          conn.hadError = true;
          this._pushConnError(conn, err, `ACK write failed after ${processingMs} ms`);
          resolve();
          return;
        }
        conn.bytesOut += ackBuf.length;
        this._stats.bytesOut += ackBuf.length;
        if (this._config.logBytes) {
          this._push({
            type: 'bytes.out',
            connId,
            direction: 'out',
            summary: `${ackBuf.length} byte(s) sent`,
            data: { length: ackBuf.length, previewHex: bufferToHex(ackBuf.subarray(0, PREVIEW_BYTES), '') },
          });
        }
        let ackSummary = null;
        try {
          ackSummary = this._deps.parse(ackText);
          if (ackSummary === undefined) ackSummary = null;
        } catch {
          ackSummary = null;
        }
        const ackAnalysis = analyzeFraming(ackBuf, ackFraming);
        const ackData = {
          raw: { hex: bufferToHex(ackBuf, ''), length: ackBuf.length },
          text: ackText,
          encoding: cfg.encoding,
          framing: ackAnalysis,
          summary: ackSummary,
          mode: cfg.ack.mode,
          delayMs,
          processingMs,
          inReplyTo: controlId,
        };
        if (ackSummary === null) ackData.parseError = 'ACK could not be parsed';
        this._push({
          type: 'ack.out',
          connId,
          direction: 'out',
          latencyMs: processingMs,
          summary: `Sent ACK ${cfg.ack.mode} for ${controlId || 'unknown control id'} in ${processingMs} ms`,
          data: ackData,
        });
        this._recordProcessing(processingMs);
        resolve();
      });
    });

    if (!this._config.keepConnection) {
      socket.end();
      conn.endTimer = setTimeout(() => socket.destroy(), END_GRACE_MS);
    }
  }

  _recordProcessing(ms) {
    const s = this._stats;
    s.acksSent += 1;
    s.processingCount += 1;
    s.processingSum += ms;
    s.minProcessingMs = s.minProcessingMs === null ? ms : Math.min(s.minProcessingMs, ms);
    s.maxProcessingMs = s.maxProcessingMs === null ? ms : Math.max(s.maxProcessingMs, ms);
    this.emit('status', this.status());
  }

  _pushConnError(conn, err, context) {
    const code = err && err.code ? err.code : null;
    const message = err && err.message ? err.message : String(err);
    this._push({
      type: 'conn.error',
      connId: conn.id,
      level: 'error',
      summary: `${context}: ${message}`,
      data: { code, message },
    });
  }

  _safeDecode(bytes) {
    try {
      const text = this._deps.encoding.decode(bytes, this._config.encoding);
      return typeof text === 'string' ? text : String(text);
    } catch {
      return Buffer.from(bytes).toString('latin1');
    }
  }
}

// ---------------------------------------------------------------------------------------------

function normalizeDeps(deps) {
  if (!deps || typeof deps !== 'object' || !deps.events || typeof deps.events.push !== 'function') {
    throw new TypeError('MllpListener requires deps.events (EventStore)');
  }
  const encoding = deps.encoding && typeof deps.encoding.encode === 'function' && typeof deps.encoding.decode === 'function'
    ? deps.encoding
    : FALLBACK_ENCODING;
  return {
    events: deps.events,
    ackBuilder: typeof deps.ackBuilder === 'function' ? deps.ackBuilder : () => null,
    parse: typeof deps.parse === 'function' ? deps.parse : () => null,
    encoding,
  };
}

function mergeConfig(base, partial) {
  const src = partial && typeof partial === 'object' ? partial : {};
  const merged = { ...base, ...stripUndefined(src) };
  merged.ack = { ...(base.ack || DEFAULT_LISTENER_CONFIG.ack), ...stripUndefined(src.ack && typeof src.ack === 'object' ? src.ack : {}) };
  return merged;
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Validates a full config; throws Error with a readable message. Returns compiled framing. */
function validateConfig(cfg) {
  if (typeof cfg.id !== 'string' || cfg.id.trim() === '') throw new Error('Listener id must be a non-empty string');
  if (typeof cfg.host !== 'string' || cfg.host.trim() === '') throw new Error('Listener host must be a non-empty string');
  const port = Number(cfg.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid listener port: ${cfg.port}`);
  if (typeof cfg.encoding !== 'string' || cfg.encoding.trim() === '') throw new Error('Listener encoding must be a non-empty string');
  const prefix = parseHexOption(cfg.prefixHex, 'prefixHex');
  const suffix = parseHexOption(cfg.suffixHex, 'suffixHex');
  if (!cfg.ack || typeof cfg.ack !== 'object') throw new Error('Listener ack config must be an object');
  if (!ACK_MODES.has(cfg.ack.mode)) throw new Error(`Invalid ack.mode: ${cfg.ack.mode} (expected AA, AE, AR, none or custom)`);
  const delay = Number(cfg.ack.delayMs);
  if (!Number.isFinite(delay) || delay < 0) throw new Error(`Invalid ack.delayMs: ${cfg.ack.delayMs}`);
  if (cfg.ack.prefixHex != null) parseHexOption(cfg.ack.prefixHex, 'ack.prefixHex');
  if (cfg.ack.suffixHex != null) parseHexOption(cfg.ack.suffixHex, 'ack.suffixHex');
  if (cfg.ack.mode === 'custom' && (typeof cfg.ack.template !== 'string' || cfg.ack.template.trim() === '')) {
    throw new Error('ack.mode custom requires a non-empty ack.template');
  }
  const idle = Number(cfg.idleTimeoutMs);
  if (!Number.isFinite(idle) || idle < 0) throw new Error(`Invalid idleTimeoutMs: ${cfg.idleTimeoutMs}`);
  const frameTimeout = Number(cfg.frameTimeoutMs);
  if (!Number.isFinite(frameTimeout) || frameTimeout < 0) throw new Error(`Invalid frameTimeoutMs: ${cfg.frameTimeoutMs}`);
  const maxBytes = Number(cfg.maxMessageBytes);
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error(`Invalid maxMessageBytes: ${cfg.maxMessageBytes}`);
  return { prefix, suffix, prefixHex: bufferToHex(prefix, ''), suffixHex: bufferToHex(suffix, '') };
}

function parseHexOption(value, name) {
  if (value == null) return Buffer.alloc(0);
  try {
    return hexToBuffer(String(value));
  } catch (err) {
    throw new Error(`Invalid ${name}: ${err.message}`);
  }
}

function resolveAckFraming(cfg, inbound) {
  return {
    prefix: cfg.ack.prefixHex != null ? hexToBuffer(String(cfg.ack.prefixHex)) : inbound.prefix,
    suffix: cfg.ack.suffixHex != null ? hexToBuffer(String(cfg.ack.suffixHex)) : inbound.suffix,
  };
}

function sameValue(key, a, b) {
  if (key === 'prefixHex' || key === 'suffixHex') {
    try {
      return normalizeHex(a == null ? '' : String(a)) === normalizeHex(b == null ? '' : String(b));
    } catch {
      return a === b;
    }
  }
  if (key === 'port') return Number(a) === Number(b);
  return a === b;
}

function describeMessage(summary, controlId) {
  if (!summary) return 'unparseable message';
  const type = [summary.messageType, summary.triggerEvent].filter((x) => x).join('^') || 'message';
  return controlId ? `${type} ${controlId}` : type;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
