// MLLP sender: connects, writes a framed HL7 message, waits for the ACK frame and validates
// it. All latencies (connect, send, first byte, ack, total) come from the monotonic clock.
// Network and protocol failures never throw: they produce ok=false results and error events.
// Only invalid input (bad hex, empty message, bad port) throws.
// This module does not import src/hl7 statically; template rendering and control id
// generation come from deps (renderTemplate / generateControlId) or, when absent, from a lazy
// import of ../hl7/templates.js that degrades gracefully if the module is unavailable.

import net from 'node:net';
import { bufferToHex, hexToBuffer } from '../core/hex.js';
import { now } from '../core/events.js';
import { FrameDecoder, analyzeFraming, frame as frameBytes } from './framing.js';

export const DEFAULT_SEND_REQUEST = {
  id: 'sender',
  host: '127.0.0.1',
  port: 2575,
  prefixHex: '0B',
  suffixHex: '1C0D',
  encoding: 'utf8',
  message: '',
  normalizeSegmentSeparator: true,
  autoControlId: false,
  renderTemplate: true,
  connectTimeoutMs: 5000,
  ackTimeoutMs: 5000,
  expectAck: true,
  ackPrefixHex: null,
  ackSuffixHex: null,
  repeat: 1,
  intervalMs: 0,
  keepAlive: false,
  logBytes: true,
};

const PREVIEW_BYTES = 32;
const PARTIAL_CAP_BYTES = 1024 * 1024;
const CLOSE_GRACE_MS = 1000;
const SEGMENT_SPLIT_RE = /\r\n|\r|\n/;
const SEGMENT_SPLIT_KEEP_RE = /(\r\n|\r|\n)/;

const FALLBACK_ENCODING = {
  encode: (text) => Buffer.from(String(text), 'utf8'),
  decode: (buf) => Buffer.from(buf).toString('utf8'),
};

const connCounters = new Map();
let localIdCounter = 0;
let templatesPromise = null;

// ---------------------------------------------------------------------------------------------
// public API

/** Send ONE message over a new connection (or over deps.connection). */
export async function sendMessage(req, deps = {}) {
  const d = normalizeDeps(deps);
  const merged = mergeRequest(req);
  const meta = metaFromRequest(merged);
  if (d.connection) {
    return d.connection.send(merged, meta);
  }
  const conn = new MllpSenderConnection({
    id: merged.id,
    host: merged.host,
    port: merged.port,
    connectTimeoutMs: merged.connectTimeoutMs,
    logBytes: merged.logBytes,
  }, d);
  try {
    return await conn.send(merged, meta);
  } finally {
    await conn.close();
  }
}

/** repeat / intervalMs / keepAlive; template and control id are rendered per message. */
export async function sendMany(req, deps = {}) {
  const d = normalizeDeps(deps);
  const merged = mergeRequest(req);
  const repeat = clampInt(merged.repeat, 1, 1, 1000000);
  const intervalMs = Math.max(0, Number(merged.intervalMs) || 0);
  const results = [];
  let conn = null;
  if (merged.keepAlive && !d.connection) {
    conn = new MllpSenderConnection({
      id: merged.id,
      host: merged.host,
      port: merged.port,
      connectTimeoutMs: merged.connectTimeoutMs,
      logBytes: merged.logBytes,
    }, d);
  }
  try {
    for (let i = 0; i < repeat; i += 1) {
      const single = { ...merged, repeat: 1, repeatIndex: i, repeatTotal: repeat, attempt: 1 };
      const result = conn
        ? await conn.send(single, metaFromRequest(single))
        : await sendMessage(single, d);
      results.push(result);
      if (i < repeat - 1 && intervalMs > 0) await sleep(intervalMs);
    }
  } finally {
    if (conn) await conn.close();
  }
  return { results, summary: summarizeResults(results) };
}

export class MllpSenderConnection {
  constructor({ id = 'sender', host = '127.0.0.1', port = 2575, connectTimeoutMs = 5000, logBytes = true } = {}, deps = {}) {
    this.id = typeof id === 'string' && id !== '' ? id : 'sender';
    this.host = host;
    this.port = port;
    this.connectTimeoutMs = positiveNumber(connectTimeoutMs, 5000);
    this.logBytes = Boolean(logBytes);
    this._deps = normalizeDeps(deps);
    this._socket = null;
    this._connId = null;
    this._connected = false;
    this._connecting = null;
    this._chain = Promise.resolve();
    this._active = null;
    this._stats = { bytesIn: 0, bytesOut: 0, messages: 0, openedMono: null, hadError: false };
  }

  get connected() {
    return this._connected && this._socket !== null && !this._socket.destroyed;
  }

  get connId() {
    return this._connId;
  }

  /** Resolves { connectMs } when connected; rejects after pushing sender.connect / sender.error. */
  connect() {
    if (this.connected) return Promise.resolve({ connectMs: 0, reused: true, eventIds: [] });
    if (this._connecting) return this._connecting;

    this._connecting = new Promise((resolve, reject) => {
      let invalid = null;
      if (typeof this.host !== 'string' || this.host.trim() === '') invalid = new Error('Host is required');
      const port = Number(this.port);
      if (!invalid && (!Number.isInteger(port) || port < 1 || port > 65535)) invalid = new Error(`Invalid port: ${this.port}`);
      if (invalid) {
        reject(invalid);
        return;
      }

      const connId = nextConnId(this.id);
      this._connId = connId;
      const stats = { bytesIn: 0, bytesOut: 0, messages: 0, openedMono: null, hadError: false };
      this._stats = stats;
      const t0 = now();
      let settled = false;
      let wasConnected = false;
      const socket = net.connect({ host: this.host, port });
      this._socket = socket;
      socket.setNoDelay(true);

      const timer = setTimeout(() => {
        if (settled) return;
        const err = new Error(`Connect timeout after ${this.connectTimeoutMs} ms`);
        err.code = 'ETIMEDOUT';
        socket.destroy(err);
      }, this.connectTimeoutMs);

      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const t1 = now();
        const connectMs = round3(t1.mono - t0.mono);
        this._connected = true;
        wasConnected = true;
        stats.openedMono = t1.mono;
        const e1 = this._push({
          type: 'sender.connect',
          latencyMs: connectMs,
          summary: `Connected to ${this.host}:${port} in ${connectMs} ms`,
          data: { host: this.host, port, ok: true, connectMs, error: null },
        });
        const e2 = this._push({
          type: 'conn.open',
          connId,
          summary: `Connection to ${this.host}:${port} open (local port ${socket.localPort})`,
          data: { remoteAddress: socket.remoteAddress || null, remotePort: socket.remotePort || null, localPort: socket.localPort || null },
        });
        resolve({
          connectMs,
          reused: false,
          tsStart: t0.ts,
          startMono: t0.mono,
          tsConnected: t1.ts,
          connectedMono: t1.mono,
          eventIds: [e1.id, e2.id],
        });
      });

      socket.on('data', (chunk) => this._onData(chunk));

      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const t1 = now();
          const connectMs = round3(t1.mono - t0.mono);
          const message = err && err.message ? err.message : String(err);
          const code = err && err.code ? err.code : null;
          const e1 = this._push({
            type: 'sender.connect',
            level: 'error',
            summary: `Connect to ${this.host}:${port} failed after ${connectMs} ms: ${message}`,
            data: { host: this.host, port, ok: false, connectMs, error: message },
          });
          const e2 = this._push({
            type: 'sender.error',
            level: 'error',
            summary: `Connect failed: ${message}`,
            data: { code, message, phase: 'connect' },
          });
          const failure = err instanceof Error ? err : new Error(message);
          failure.phase = 'connect';
          failure.eventIds = [e1.id, e2.id];
          reject(failure);
          return;
        }
        stats.hadError = true;
        this._push({
          type: 'conn.error',
          connId,
          level: 'error',
          summary: `Connection error: ${err && err.message ? err.message : err}`,
          data: { code: err && err.code ? err.code : null, message: err && err.message ? err.message : String(err) },
        });
        if (this._active) this._active.onError(err);
      });

      socket.on('close', (hadError) => {
        clearTimeout(timer);
        if (wasConnected) {
          const t = now();
          this._push({
            type: 'conn.close',
            connId,
            summary: `Connection closed after ${stats.messages} message(s)`,
            data: {
              durationMs: stats.openedMono != null ? round3(t.mono - stats.openedMono) : null,
              bytesIn: stats.bytesIn,
              bytesOut: stats.bytesOut,
              messages: stats.messages,
              hadError: Boolean(hadError) || stats.hadError,
            },
          });
        }
        if (this._socket === socket || this._socket === null) {
          this._connected = false;
          this._socket = null;
          if (this._active) this._active.onClose(Boolean(hadError));
        }
      });
    }).finally(() => {
      this._connecting = null;
    });
    return this._connecting;
  }

  /** Same semantics as sendMessage, reusing the socket. Calls are serialised. */
  send(req, meta = {}) {
    const run = this._chain.then(() => this._doSend(req, meta));
    this._chain = run.catch(() => {});
    return run;
  }

  close() {
    const socket = this._socket;
    if (!socket) {
      this._connected = false;
      return Promise.resolve();
    }
    if (socket.destroyed) {
      this._socket = null;
      this._connected = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => socket.destroy(), CLOSE_GRACE_MS);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.end();
    });
  }

  // ---------------------------------------------------------------------------------------------

  _push(partial) {
    return this._deps.events.push({
      source: 'sender',
      endpointId: this.id,
      connId: this._connId,
      direction: null,
      level: 'info',
      latencyMs: null,
      data: {},
      ...partial,
    });
  }

  _onData(chunk) {
    this._stats.bytesIn += chunk.length;
    if (this.logBytes) {
      const ev = this._push({
        type: 'bytes.in',
        direction: 'in',
        summary: `${chunk.length} byte(s) received`,
        data: { length: chunk.length, previewHex: bufferToHex(chunk.subarray(0, PREVIEW_BYTES), ''), totalBytesOnConn: this._stats.bytesIn },
      });
      if (this._active) this._active.eventIds.push(ev.id);
    }
    if (this._active) {
      this._active.onData(chunk);
      return;
    }
    this._push({
      type: 'frame.garbage',
      direction: 'in',
      level: 'warn',
      summary: `${chunk.length} unexpected byte(s) received while no message was pending`,
      data: { hex: bufferToHex(chunk, ''), length: chunk.length, text: chunk.toString('latin1') },
    });
  }

  async _doSend(req, meta) {
    const merged = mergeRequest({ ...req, host: this.host, port: this.port, id: this.id });
    // throws on invalid input (before touching the network)
    const prepared = await prepareMessage(merged, this._deps);
    const eventIds = [];
    const t0 = now();
    let connectMs = 0;
    let tsConnected = t0.ts;
    let connectedMono = t0.mono;

    if (!this.connected) {
      try {
        const c = await this.connect();
        connectMs = c.connectMs;
        tsConnected = c.tsConnected || t0.ts;
        connectedMono = c.connectedMono != null ? c.connectedMono : now().mono;
        if (Array.isArray(c.eventIds)) eventIds.push(...c.eventIds);
      } catch (err) {
        if (Array.isArray(err.eventIds)) eventIds.push(...err.eventIds);
        const tEnd = now();
        return buildResult({
          ok: false,
          error: err.message,
          errorPhase: 'connect',
          ack: null,
          prepared,
          eventIds,
          timings: {
            tsStart: t0.ts,
            tsConnected: null,
            tsSent: null,
            tsFirstByte: null,
            tsAck: null,
            connectMs: null,
            sendMs: null,
            firstByteMs: null,
            ackMs: null,
            totalMs: round3(tEnd.mono - t0.mono),
          },
        });
      }
    }

    return this._transmit(prepared, {
      t0,
      connectMs,
      tsConnected,
      connectedMono,
      eventIds,
      attempt: positiveInt(meta.attempt, 1),
      repeatIndex: nonNegativeInt(meta.repeatIndex, 0),
      repeatTotal: positiveInt(meta.repeatTotal, 1),
    });
  }

  _transmit(prepared, ctx) {
    return new Promise((resolve) => {
      const socket = this._socket;
      const r = prepared.req;
      const timings = {
        tsStart: ctx.t0.ts,
        tsConnected: ctx.tsConnected,
        tsSent: null,
        tsFirstByte: null,
        tsAck: null,
        connectMs: ctx.connectMs,
        sendMs: null,
        firstByteMs: null,
        ackMs: null,
        totalMs: null,
      };
      let finished = false;
      let sentMono = null;
      let ackTimer = null;
      let sendTimer = null;
      let received = Buffer.alloc(0);
      const early = [];
      const decoder = new FrameDecoder({ prefix: prepared.ackPrefix, suffix: prepared.ackSuffix });

      const finish = (outcome) => {
        if (finished) return;
        finished = true;
        if (ackTimer) clearTimeout(ackTimer);
        if (sendTimer) clearTimeout(sendTimer);
        this._active = null;
        decoder.removeAllListeners();
        const tEnd = now();
        timings.totalMs = round3(tEnd.mono - ctx.t0.mono);
        resolve(buildResult({ ...outcome, prepared, eventIds: ctx.eventIds, timings }));
      };

      const fail = (phase, err, code) => {
        const message = err && err.message ? err.message : String(err);
        const ev = this._push({
          type: 'sender.error',
          level: 'error',
          summary: `Send failed during ${phase}: ${message}`,
          data: { code: code || (err && err.code) || null, message, phase },
        });
        ctx.eventIds.push(ev.id);
        finish({ ok: false, error: message, errorPhase: phase, ack: null });
      };

      const processData = (chunk) => {
        if (timings.firstByteMs === null) {
          const t = now();
          timings.tsFirstByte = t.ts;
          timings.firstByteMs = round3(t.mono - sentMono);
        }
        if (received.length < PARTIAL_CAP_BYTES) {
          received = Buffer.concat([received, chunk.subarray(0, PARTIAL_CAP_BYTES - received.length)]);
        }
        decoder.push(chunk);
      };

      decoder.on('frame', (f) => {
        if (finished) return;
        const framing = analyzeFraming(f.raw, prepared.ackFraming);
        const text = safeDecode(this._deps.encoding, f.payload, r.encoding);
        const { summary, parseError } = safeParse(this._deps.parse, text);
        const validation = validateAck(text, framing, prepared.controlId, summary);
        timings.tsAck = f.completedTs;
        timings.ackMs = round3(f.completedMono - sentMono);
        const tNow = now();
        const ackData = {
          raw: { hex: bufferToHex(f.raw, ''), length: f.raw.length },
          text,
          encoding: r.encoding,
          framing,
          summary,
          validation,
          timing: {
            connectMs: timings.connectMs,
            sendMs: timings.sendMs,
            firstByteMs: timings.firstByteMs,
            ackMs: timings.ackMs,
            totalMs: round3(tNow.mono - ctx.t0.mono),
          },
        };
        if (summary === null) ackData.parseError = parseError;
        const ev = this._push({
          type: 'ack.in',
          direction: 'in',
          level: validation.problems.length ? 'warn' : 'info',
          latencyMs: timings.ackMs,
          summary: `ACK ${validation.msa1 || '?'} for ${prepared.controlId || 'unknown control id'} in ${timings.ackMs} ms${validation.problems.length ? ` (${validation.problems.length} problem(s))` : ''}`,
          data: ackData,
        });
        ctx.eventIds.push(ev.id);
        finish({
          ok: true,
          error: null,
          errorPhase: null,
          ack: { raw: ackData.raw, text, framing, summary, validation },
        });
      });
      decoder.on('error', (err) => {
        if (finished) return;
        fail('ack', err);
      });

      this._active = {
        eventIds: ctx.eventIds,
        onData: (chunk) => {
          if (finished) return;
          if (sentMono === null) {
            // response arrived before our write callback: process it once the write is confirmed
            early.push(chunk);
            return;
          }
          processData(chunk);
        },
        onClose: () => {
          if (finished) return;
          const phase = sentMono === null ? 'send' : 'ack';
          if (phase === 'ack' && received.length > 0) {
            // The gateway answered but the frame never completed (typically a wrong suffix) and
            // then closed the socket. Report the bytes with a framing analysis instead of dropping them.
            const framing = analyzeFraming(received, prepared.ackFraming);
            const ev = this._push({
              type: 'frame.incomplete',
              direction: 'in',
              level: 'warn',
              summary: `${received.length} byte(s) of ACK without suffix flushed on close (suffix expected ${framing.suffixHexExpected || 'none'}, got ${framing.suffixHexActual || 'none'})`,
              data: {
                hex: bufferToHex(received, ''),
                length: received.length,
                text: safeDecode(this._deps.encoding, received, r.encoding),
                framing,
                reason: 'close',
              },
            });
            ctx.eventIds.push(ev.id);
            fail('ack', new Error(`Connection closed after ${received.length} byte(s) of an incomplete ACK (suffix expected ${framing.suffixHexExpected || 'none'}, got ${framing.suffixHexActual || 'none'})`), 'ECONNCLOSED');
            return;
          }
          fail(phase, new Error(`Connection closed before ${phase === 'send' ? 'the message was sent' : 'an ACK was received'}`), 'ECONNCLOSED');
        },
        onError: (err) => {
          if (finished) return;
          fail(sentMono === null ? 'send' : 'ack', err);
        },
      };

      if (!socket || socket.destroyed) {
        fail('send', new Error('Socket is not connected'), 'ENOTCONN');
        return;
      }

      const framed = prepared.framed;
      // A peer that accepts the connection but never reads can stall the write forever
      // (full TCP window). Bound the send phase with the ACK timeout.
      sendTimer = setTimeout(() => {
        if (finished || sentMono !== null) return;
        fail('send', new Error(`Write not flushed within ${r.ackTimeoutMs} ms (peer is not reading)`), 'ESENDTIMEOUT');
        try { socket.destroy(); } catch { /* already gone */ }
      }, r.ackTimeoutMs);
      socket.write(framed, (err) => {
        if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
        if (finished) return;
        if (err) {
          fail('send', err);
          return;
        }
        const t = now();
        sentMono = t.mono;
        timings.tsSent = t.ts;
        timings.sendMs = round3(t.mono - ctx.connectedMono);
        this._stats.bytesOut += framed.length;
        this._stats.messages += 1;
        if (this.logBytes) {
          const evb = this._push({
            type: 'bytes.out',
            direction: 'out',
            summary: `${framed.length} byte(s) sent`,
            data: { length: framed.length, previewHex: bufferToHex(framed.subarray(0, PREVIEW_BYTES), '') },
          });
          ctx.eventIds.push(evb.id);
        }
        const { summary, parseError } = safeParse(this._deps.parse, prepared.text);
        const outData = {
          raw: { hex: bufferToHex(framed, ''), length: framed.length },
          text: prepared.text,
          encoding: r.encoding,
          framing: analyzeFraming(framed, prepared.framing),
          summary,
          attempt: ctx.attempt,
          repeatIndex: ctx.repeatIndex,
          repeatTotal: ctx.repeatTotal,
        };
        if (summary === null) outData.parseError = parseError;
        const evm = this._push({
          type: 'msg.out',
          direction: 'out',
          latencyMs: null,
          summary: `Sent ${describeMessage(summary, prepared.controlId)} (${framed.length} bytes)${ctx.repeatTotal > 1 ? ` [${ctx.repeatIndex + 1}/${ctx.repeatTotal}]` : ''}`,
          data: outData,
        });
        ctx.eventIds.push(evm.id);

        if (!r.expectAck) {
          finish({ ok: true, error: null, errorPhase: null, ack: null });
          return;
        }

        ackTimer = setTimeout(() => {
          if (finished) return;
          const partialLength = received.length;
          const ev = this._push({
            type: 'ack.timeout',
            level: 'error',
            summary: `No ACK within ${r.ackTimeoutMs} ms for ${prepared.controlId || 'unknown control id'}${partialLength ? ` (${partialLength} partial byte(s) received, suffix expected ${prepared.ackFraming.suffixHex || 'none'})` : ''}`,
            data: {
              ackTimeoutMs: r.ackTimeoutMs,
              partialHex: bufferToHex(received, ''),
              partialLength,
              partialText: partialLength ? safeDecode(this._deps.encoding, received, r.encoding) : '',
              framing: partialLength ? analyzeFraming(received, prepared.ackFraming) : null,
              controlId: prepared.controlId,
            },
          });
          ctx.eventIds.push(ev.id);
          finish({ ok: false, error: `ACK timeout after ${r.ackTimeoutMs} ms`, errorPhase: 'ack', ack: null });
        }, r.ackTimeoutMs);

        if (early.length) {
          const chunks = early.splice(0, early.length);
          for (const chunk of chunks) {
            if (finished) break;
            processData(chunk);
          }
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------------------------
// request preparation

function mergeRequest(req) {
  const src = req && typeof req === 'object' ? req : {};
  const out = { ...DEFAULT_SEND_REQUEST };
  for (const [k, v] of Object.entries(src)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function metaFromRequest(req) {
  return {
    attempt: positiveInt(req.attempt, 1),
    repeatIndex: nonNegativeInt(req.repeatIndex, 0),
    repeatTotal: positiveInt(req.repeatTotal, positiveInt(req.repeat, 1)),
  };
}

/**
 * Validates the request and produces the bytes to send. Throws Error on invalid input.
 * Returns { req, text, controlId, payload, framed, prefix, suffix, ackPrefix, ackSuffix,
 *           framing, ackFraming, warnings }.
 */
async function prepareMessage(req, deps) {
  const r = { ...req };
  if (typeof r.message !== 'string' || r.message.trim() === '') throw new Error('Message is empty');
  if (typeof r.host !== 'string' || r.host.trim() === '') throw new Error('Host is required');
  const port = Number(r.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${r.port}`);
  r.port = port;
  if (typeof r.encoding !== 'string' || r.encoding.trim() === '') r.encoding = 'utf8';
  r.connectTimeoutMs = positiveNumber(r.connectTimeoutMs, 5000);
  r.ackTimeoutMs = positiveNumber(r.ackTimeoutMs, 5000);
  r.expectAck = r.expectAck !== false;

  const prefix = parseHex(r.prefixHex, 'prefixHex');
  const suffix = parseHex(r.suffixHex, 'suffixHex');
  const ackPrefix = r.ackPrefixHex == null ? prefix : parseHex(r.ackPrefixHex, 'ackPrefixHex');
  const ackSuffix = r.ackSuffixHex == null ? suffix : parseHex(r.ackSuffixHex, 'ackSuffixHex');

  const warnings = [];
  let text = r.message;
  let newControlId;
  if (r.autoControlId) {
    const gen = await resolveGenerator(deps);
    newControlId = gen();
  }
  if (r.renderTemplate) {
    const render = await resolveRenderer(deps);
    if (render) {
      try {
        const ctx = { vars: r.vars && typeof r.vars === 'object' ? r.vars : {} };
        if (newControlId !== undefined) ctx.controlId = newControlId;
        const rendered = render(text, ctx);
        if (typeof rendered === 'string') text = rendered;
      } catch (err) {
        warnings.push(`Template rendering failed: ${err.message}`);
      }
    } else {
      warnings.push('Template rendering unavailable (templates module not loaded), message sent as-is');
    }
  }
  if (r.normalizeSegmentSeparator) {
    text = text.replace(/\r\n|\r|\n/g, '\r');
    if (!text.endsWith('\r')) text += '\r';
  }
  if (newControlId !== undefined) {
    const replaced = setMshField(text, 10, newControlId);
    if (replaced === null) warnings.push('autoControlId: MSH segment not found, control id not replaced');
    else text = replaced;
  }
  const controlId = getMshField(text, 10) || null;
  if (!findSegment(text, 'MSH')) warnings.push('Message has no MSH segment');

  let payload;
  try {
    payload = deps.encoding.encode(text, r.encoding);
    if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload);
  } catch (err) {
    throw new Error(`Cannot encode message with ${r.encoding}: ${err.message}`);
  }
  const framed = frameBytes(payload, { prefix, suffix });
  return {
    req: r,
    text,
    controlId,
    payload,
    framed,
    prefix,
    suffix,
    ackPrefix,
    ackSuffix,
    framing: { prefix, suffix, prefixHex: bufferToHex(prefix, ''), suffixHex: bufferToHex(suffix, '') },
    ackFraming: { prefix: ackPrefix, suffix: ackSuffix, prefixHex: bufferToHex(ackPrefix, ''), suffixHex: bufferToHex(ackSuffix, '') },
    warnings,
  };
}

function parseHex(value, name) {
  if (value == null) return Buffer.alloc(0);
  try {
    return hexToBuffer(String(value));
  } catch (err) {
    throw new Error(`Invalid ${name}: ${err.message}`);
  }
}

async function loadTemplates() {
  if (!templatesPromise) {
    templatesPromise = import('../hl7/templates.js').catch(() => null);
  }
  return templatesPromise;
}

async function resolveRenderer(deps) {
  if (typeof deps.renderTemplate === 'function') return deps.renderTemplate;
  const mod = await loadTemplates();
  return mod && typeof mod.renderTemplate === 'function' ? mod.renderTemplate : null;
}

async function resolveGenerator(deps) {
  if (typeof deps.generateControlId === 'function') return deps.generateControlId;
  const mod = await loadTemplates();
  return mod && typeof mod.generateControlId === 'function' ? mod.generateControlId : localControlId;
}

/** Fallback control id: YYYYMMDDHHmmssSSS + 3 digit counter (20 chars). */
function localControlId() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
  localIdCounter = (localIdCounter + 1) % 1000;
  return `${stamp}${p(localIdCounter, 3)}`;
}

// ---------------------------------------------------------------------------------------------
// tiny HL7 helpers (MSH / MSA field access without the full parser)

function findSegment(text, name) {
  if (typeof text !== 'string') return null;
  const segments = text.split(SEGMENT_SPLIT_RE);
  return segments.find((s) => s.startsWith(name) && (s.length === 3 || !/[A-Z0-9]/.test(s[3]))) || null;
}

function fieldSeparator(text) {
  const msh = findSegment(text, 'MSH');
  return msh && msh.length >= 4 ? msh[3] : '|';
}

/** MSH-n for n >= 2 (MSH-1 is the separator itself). '' when absent. */
function getMshField(text, n) {
  const msh = findSegment(text, 'MSH');
  if (!msh || msh.length < 4) return '';
  const parts = msh.split(msh[3]);
  const value = parts[n - 1];
  return value === undefined ? '' : value;
}

/** Returns the message with MSH-n replaced, or null when no MSH segment exists. */
function setMshField(text, n, value) {
  const pieces = text.split(SEGMENT_SPLIT_KEEP_RE);
  for (let i = 0; i < pieces.length; i += 2) {
    const seg = pieces[i];
    if (seg.startsWith('MSH') && seg.length >= 4) {
      const fs = seg[3];
      const parts = seg.split(fs);
      while (parts.length < n) parts.push('');
      parts[n - 1] = value;
      pieces[i] = parts.join(fs);
      return pieces.join('');
    }
  }
  return null;
}

function msaFields(text) {
  const msa = findSegment(text, 'MSA');
  if (!msa) return null;
  const fs = fieldSeparator(text);
  const parts = msa.split(fs);
  const pick = (i) => (parts[i] === undefined || parts[i] === '' ? null : parts[i]);
  return { msa1: pick(1), msa2: pick(2), msa3: pick(3) };
}

function messageTypeOf(text) {
  const msh9 = getMshField(text, 9);
  if (!msh9) return null;
  const enc = getMshField(text, 2);
  const comp = enc && enc.length > 0 ? enc[0] : '^';
  return msh9.split(comp)[0] || null;
}

function validateAck(text, framing, controlId, summary) {
  const problems = [];
  const hasMsh = Boolean(findSegment(text, 'MSH'));
  const msa = msaFields(text);
  const msa1 = msa ? msa.msa1 : null;
  const msa2 = msa ? msa.msa2 : null;
  const msa3 = msa ? msa.msa3 : null;
  const accepted = msa1 === 'AA' || msa1 === 'CA';
  const controlIdMatches = controlId !== null && msa2 !== null && msa2 === controlId;
  const framingOk = Boolean(framing.prefixOk && framing.suffixOk);

  if (!hasMsh) problems.push('No MSH segment in ACK');
  if (!msa) {
    problems.push('No MSA segment in ACK');
  } else {
    if (!accepted) {
      problems.push(`MSA-1 is ${msa1 === null ? 'empty' : msa1}, expected AA or CA${msa3 ? ` (MSA-3: ${msa3})` : ''}`);
    }
    if (!controlIdMatches) {
      problems.push(`MSA-2 ${msa2 === null ? 'empty' : msa2} does not match sent MSH-10 ${controlId === null ? 'empty' : controlId}`);
    }
  }
  const type = messageTypeOf(text);
  if (hasMsh && type && type !== 'ACK') problems.push(`ACK message type is ${type}, expected ACK`);
  if (!framing.prefixOk) {
    problems.push(`ACK prefix mismatch: expected ${framing.prefixHexExpected || 'none'}, got ${framing.prefixHexActual || 'none'}`);
  }
  if (!framing.suffixOk) {
    problems.push(`ACK suffix mismatch: expected ${framing.suffixHexExpected || 'none'}, got ${framing.suffixHexActual || 'none'}`);
  }
  if (summary === null && hasMsh) problems.push('ACK could not be parsed');
  return { msa1, msa2, msa3, controlIdMatches, accepted, framingOk, problems };
}

// ---------------------------------------------------------------------------------------------
// misc

function normalizeDeps(deps) {
  if (!deps || typeof deps !== 'object' || !deps.events || typeof deps.events.push !== 'function') {
    throw new TypeError('sender requires deps.events (EventStore)');
  }
  const encoding = deps.encoding && typeof deps.encoding.encode === 'function' && typeof deps.encoding.decode === 'function'
    ? deps.encoding
    : FALLBACK_ENCODING;
  return {
    events: deps.events,
    encoding,
    parse: typeof deps.parse === 'function' ? deps.parse : () => null,
    connection: deps.connection instanceof MllpSenderConnection ? deps.connection : null,
    renderTemplate: typeof deps.renderTemplate === 'function' ? deps.renderTemplate : null,
    generateControlId: typeof deps.generateControlId === 'function' ? deps.generateControlId : null,
  };
}

function buildResult({ ok, error, errorPhase, ack, prepared, eventIds, timings }) {
  return {
    ok,
    error,
    errorPhase,
    controlId: prepared.controlId,
    sentText: prepared.text,
    sentHex: bufferToHex(prepared.framed, ''),
    timings,
    ack,
    eventIds: Array.from(new Set(eventIds)),
    warnings: prepared.warnings,
  };
}

function summarizeResults(results) {
  const ackTimes = results.map((r) => (r.timings ? r.timings.ackMs : null)).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  const okCount = results.filter((r) => r.ok).length;
  const n = ackTimes.length;
  return {
    count: results.length,
    ok: okCount,
    failed: results.length - okCount,
    minAckMs: n ? ackTimes[0] : null,
    avgAckMs: n ? round3(ackTimes.reduce((a, b) => a + b, 0) / n) : null,
    maxAckMs: n ? ackTimes[n - 1] : null,
    p95AckMs: n ? ackTimes[Math.max(0, Math.ceil(0.95 * n) - 1)] : null,
  };
}

function safeDecode(encoding, bytes, name) {
  try {
    const text = encoding.decode(bytes, name);
    return typeof text === 'string' ? text : String(text);
  } catch {
    return Buffer.from(bytes).toString('latin1');
  }
}

function safeParse(parse, text) {
  try {
    const summary = parse(text);
    if (summary === null || summary === undefined) return { summary: null, parseError: 'Message could not be parsed' };
    return { summary, parseError: undefined };
  } catch (err) {
    return { summary: null, parseError: err && err.message ? err.message : String(err) };
  }
}

function describeMessage(summary, controlId) {
  if (!summary) return controlId ? `message ${controlId}` : 'message';
  const type = [summary.messageType, summary.triggerEvent].filter((x) => x).join('^') || 'message';
  return controlId ? `${type} ${controlId}` : type;
}

function nextConnId(id) {
  const n = (connCounters.get(id) || 0) + 1;
  connCounters.set(id, n);
  return `${id}#${n}`;
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

function nonNegativeInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
