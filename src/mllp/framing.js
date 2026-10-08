// MLLP framing: build frames, analyze the framing of received bytes and decode a TCP byte
// stream into frames. Prefix (start block) and suffix (end block) are arbitrary byte
// sequences, possibly empty, so non-standard gateways can be tested too.

import { EventEmitter } from 'node:events';
import { bufferToHex, hexToBuffer } from '../core/hex.js';
import { now } from '../core/events.js';

const CR = 0x0d;
const LF = 0x0a;
const EMPTY = Buffer.alloc(0);
const MAX_CONTROL_CHARS_LISTED = 20;
const DEFAULT_MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
const FLUSH_REASONS = new Set(['close', 'idle', 'timeout']);

/** prefix + payload + suffix. */
export function frame(payload, framing = {}) {
  const body = requireBytes(payload, 'payload');
  const prefix = toBytes(framing.prefix, 'prefix');
  const suffix = toBytes(framing.suffix, 'suffix');
  return Buffer.concat([prefix, body, suffix], prefix.length + body.length + suffix.length);
}

/**
 * Inspect a complete raw frame (or any byte blob) against the expected prefix / suffix.
 * Offsets in `controlChars` and in warnings are offsets into `raw`, so they line up with a
 * hex dump of the raw frame.
 */
export function analyzeFraming(raw, framing = {}) {
  const buf = requireBytes(raw, 'raw');
  const prefix = toBytes(framing.prefix, 'prefix');
  const suffix = toBytes(framing.suffix, 'suffix');

  const prefixHexExpected = bufferToHex(prefix, '');
  const suffixHexExpected = bufferToHex(suffix, '');
  const prefixOk = prefix.length === 0 ? true : startsWith(buf, prefix);
  const suffixOk = suffix.length === 0 ? true : endsWith(buf, suffix);
  const prefixHexActual = bufferToHex(buf.subarray(0, prefix.length || 1), '');
  const suffixHexActual = bufferToHex(buf.subarray(Math.max(0, buf.length - (suffix.length || 1))), '');

  const payloadStart = prefixOk ? Math.min(prefix.length, buf.length) : 0;
  let payloadEnd = suffixOk ? buf.length - suffix.length : buf.length;
  if (payloadEnd < payloadStart) payloadEnd = payloadStart;
  const payload = buf.subarray(payloadStart, payloadEnd);

  const segmentSeparator = detectSegmentSeparator(payload);
  const trailingSeparator = hasTrailingSeparator(payload, segmentSeparator);

  let nonAsciiCount = 0;
  let controlCharCount = 0;
  const controlChars = [];
  for (let i = 0; i < payload.length; i += 1) {
    const b = payload[i];
    if (b >= 0x80) {
      nonAsciiCount += 1;
    } else if ((b < 0x20 && b !== CR && b !== LF) || b === 0x7f) {
      controlCharCount += 1;
      if (controlChars.length < MAX_CONTROL_CHARS_LISTED) {
        controlChars.push({ offset: payloadStart + i, hex: hexByte(b) });
      }
    }
  }

  const warnings = [];
  if (!prefixOk) {
    warnings.push(`Prefix mismatch: expected ${prefixHexExpected}, got ${prefixHexActual || '<none>'}`);
    const at = buf.indexOf(prefix);
    if (at > 0) {
      warnings.push(`Expected prefix ${prefixHexExpected} found at offset ${at}: ${at} leading byte(s) before it`);
    }
  }
  if (!suffixOk) {
    warnings.push(`Suffix mismatch: expected ${suffixHexExpected}, got ${suffixHexActual || '<none>'}`);
    const at = buf.indexOf(suffix);
    if (at >= 0) {
      const trailing = buf.length - at - suffix.length;
      warnings.push(`Expected suffix ${suffixHexExpected} found at offset ${at}, followed by ${trailing} trailing byte(s)`);
    }
  }
  if (payload.length === 0) {
    warnings.push('Empty payload');
  } else {
    if (!startsWithText(payload, 'MSH')) {
      warnings.push(`Payload does not start with MSH (starts with ${bufferToHex(payload.subarray(0, 3), ' ')})`);
    }
    if (segmentSeparator === 'LF') warnings.push('Segments separated by LF instead of CR');
    else if (segmentSeparator === 'CRLF') warnings.push('Segments separated by CRLF instead of CR');
    else if (segmentSeparator === 'mixed') warnings.push('Mixed segment separators (CR, LF and CRLF)');
    else if (segmentSeparator === 'none') warnings.push('No segment separator found (single segment without trailing CR, or unknown format)');
    if (!trailingSeparator) {
      if (segmentSeparator === 'CR' || segmentSeparator === 'none') warnings.push('Missing trailing CR before suffix');
      else warnings.push('Missing trailing segment separator before suffix');
    }
    if (controlCharCount > 0) {
      const first = controlChars[0];
      warnings.push(`${controlCharCount} unexpected control character(s) inside payload (first at offset ${first.offset}: ${first.hex})`);
    }
    if (prefix.length > 0 && prefixOk) {
      const inner = payload.indexOf(prefix);
      if (inner !== -1) {
        warnings.push(`Prefix ${prefixHexExpected} occurs inside the payload at offset ${payloadStart + inner}: possibly two messages without a suffix between them`);
      }
    }
  }

  return {
    prefixHexExpected,
    suffixHexExpected,
    prefixHexActual,
    suffixHexActual,
    prefixOk,
    suffixOk,
    payloadStart,
    payloadEnd,
    payloadLength: payload.length,
    rawLength: buf.length,
    segmentSeparator,
    trailingSeparator,
    nonAsciiCount,
    controlCharCount,
    controlChars,
    knownVariant: detectVariant(buf),
    warnings,
  };
}

/**
 * Streaming decoder. Feed TCP chunks with push(); listen to 'frame', 'garbage', 'incomplete'
 * and 'error'. Timestamps come from core/events.now(), taken once per push().
 */
export class FrameDecoder extends EventEmitter {
  constructor({ prefix, suffix, maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES } = {}) {
    super();
    this.prefix = toBytes(prefix, 'prefix');
    this.suffix = toBytes(suffix, 'suffix');
    this.maxMessageBytes = positiveInt(maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES);
    this.framesDecoded = 0;
    this.lastError = null;
    this._pending = EMPTY;
    // arrival marks: { offset (into pending), mono, ts } of every chunk still (partially) pending
    this._marks = [];
  }

  /** Copy of the bytes received but not yet framed. */
  pending() {
    return Buffer.from(this._pending);
  }

  pendingLength() {
    return this._pending.length;
  }

  push(chunk) {
    const buf = requireBytes(chunk, 'chunk');
    if (buf.length === 0) return;
    const t = now();
    if (this.suffix.length === 0) {
      this._pushWithoutSuffix(buf, t);
      return;
    }

    const prevLen = this._pending.length;
    this._pending = prevLen === 0 ? buf : Buffer.concat([this._pending, buf], prevLen + buf.length);
    this._marks.push({ offset: prevLen, mono: t.mono, ts: t.ts });
    let searchFrom = Math.max(0, prevLen - (this.suffix.length - 1));

    for (;;) {
      if (this._pending.length === 0) break;
      const idx = this._pending.indexOf(this.suffix, searchFrom);
      if (idx === -1) break;

      const frameEnd = idx + this.suffix.length;
      const raw = this._pending.subarray(0, frameEnd);
      const started = this._marks[0] || { mono: t.mono, ts: t.ts };
      let prefixOk = true;
      let payload;
      if (this.prefix.length === 0) {
        payload = raw.subarray(0, idx);
      } else if (startsWith(raw, this.prefix)) {
        payload = raw.subarray(this.prefix.length, idx);
      } else {
        // wrong or missing prefix: still a frame, reported with prefixOk=false
        prefixOk = false;
        payload = raw.subarray(0, idx);
      }
      this._consume(frameEnd);
      this.framesDecoded += 1;
      this.emit('frame', {
        payload,
        raw,
        prefixOk,
        suffixOk: true,
        startedMono: started.mono,
        completedMono: t.mono,
        startedTs: started.ts,
        completedTs: t.ts,
      });
      searchFrom = 0;
    }

    if (this._pending.length > this.maxMessageBytes) {
      const length = this._pending.length;
      this._reset();
      this._fail(`Pending frame exceeds maxMessageBytes (${this.maxMessageBytes}): ${length} bytes dropped`, length);
    }
  }

  /** Emit pending bytes as 'incomplete' (if any) and clear the buffer. */
  flush(reason = 'close') {
    const why = FLUSH_REASONS.has(reason) ? reason : 'close';
    if (this._pending.length === 0) {
      this._marks = [];
      return;
    }
    const bytes = this._pending;
    const started = this._marks[0] || null;
    this._reset();
    this.emit('incomplete', {
      bytes,
      reason: why,
      startedMono: started ? started.mono : null,
      startedTs: started ? started.ts : null,
    });
  }

  _pushWithoutSuffix(buf, t) {
    // No suffix: every chunk is a frame (degenerate but allowed by the contract).
    const raw = buf;
    let prefixOk = true;
    let payload;
    if (this.prefix.length === 0) {
      payload = raw;
    } else if (startsWith(raw, this.prefix)) {
      payload = raw.subarray(this.prefix.length);
    } else {
      prefixOk = false;
      payload = raw;
    }
    if (raw.length > this.maxMessageBytes) {
      this._fail(`Frame exceeds maxMessageBytes (${this.maxMessageBytes}): ${raw.length} bytes dropped`, raw.length);
      return;
    }
    this.framesDecoded += 1;
    this.emit('frame', {
      payload,
      raw,
      prefixOk,
      suffixOk: true,
      startedMono: t.mono,
      completedMono: t.mono,
      startedTs: t.ts,
      completedTs: t.ts,
    });
  }

  _consume(count) {
    if (count >= this._pending.length) {
      this._reset();
      return;
    }
    this._pending = this._pending.subarray(count);
    const marks = this._marks;
    let keepFrom = 0;
    for (let i = 0; i < marks.length; i += 1) {
      marks[i].offset -= count;
      if (marks[i].offset <= 0) keepFrom = i;
    }
    this._marks = marks.slice(keepFrom);
    if (this._marks.length > 0) this._marks[0].offset = 0;
  }

  _reset() {
    this._pending = EMPTY;
    this._marks = [];
  }

  _fail(message, length) {
    const err = new Error(message);
    err.code = 'E_MAX_SIZE';
    err.length = length;
    this.lastError = err;
    // an 'error' without listeners would throw and take the process down
    if (this.listenerCount('error') > 0) this.emit('error', err);
  }
}

// ---------------------------------------------------------------------------------------------

function detectSegmentSeparator(payload) {
  let cr = 0;
  let lf = 0;
  let crlf = 0;
  for (let i = 0; i < payload.length; i += 1) {
    const b = payload[i];
    if (b === CR) {
      if (payload[i + 1] === LF) {
        crlf += 1;
        i += 1;
      } else {
        cr += 1;
      }
    } else if (b === LF) {
      lf += 1;
    }
  }
  const kinds = (cr ? 1 : 0) + (lf ? 1 : 0) + (crlf ? 1 : 0);
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  if (cr) return 'CR';
  if (lf) return 'LF';
  return 'CRLF';
}

function hasTrailingSeparator(payload, separator) {
  const n = payload.length;
  if (n === 0) return false;
  const last = payload[n - 1];
  switch (separator) {
    case 'CR': return last === CR;
    case 'LF': return last === LF;
    case 'CRLF': return n >= 2 && payload[n - 2] === CR && last === LF;
    case 'mixed': return last === CR || last === LF;
    default: return false;
  }
}

/** Heuristic name of the framing variant actually present in the raw bytes (independent of config). */
function detectVariant(raw) {
  if (raw.length === 0) return null;
  const ends = (...bytes) => {
    if (raw.length < bytes.length) return false;
    const base = raw.length - bytes.length;
    for (let i = 0; i < bytes.length; i += 1) {
      if (raw[base + i] !== bytes[i]) return false;
    }
    return true;
  };
  const startsMsh = startsWithText(raw, 'MSH');
  if (raw[0] === 0x0b) {
    if (ends(0x1c, 0x0d, 0x0a)) return 'MLLP with extra LF (0B / 1C 0D 0A)';
    if (ends(0x1c, 0x0d)) return 'MLLP standard (0B / 1C 0D)';
    if (ends(0x1c)) return 'MLLP without trailing CR (0B / 1C)';
    if (ends(0x0d, 0x0a)) return 'prefix 0B, suffix 0D 0A (CRLF, no FS)';
    if (ends(0x0d)) return 'prefix 0B, no suffix (ends with CR)';
    return 'prefix 0B, unknown suffix';
  }
  if (raw[0] === 0x02 && ends(0x03)) return 'STX / ETX (02 / 03)';
  if (ends(0x1c, 0x0d)) return 'suffix 1C 0D only (no prefix)';
  if (ends(0x1c)) return 'suffix 1C only';
  if (ends(0x0d, 0x0a)) return 'suffix 0D 0A (CRLF, no FS)';
  if (startsMsh) return 'no framing';
  return null;
}

function startsWith(buf, prefix) {
  if (prefix.length === 0) return true;
  if (buf.length < prefix.length) return false;
  return buf.subarray(0, prefix.length).equals(prefix);
}

function endsWith(buf, suffix) {
  if (suffix.length === 0) return true;
  if (buf.length < suffix.length) return false;
  return buf.subarray(buf.length - suffix.length).equals(suffix);
}

function startsWithText(buf, text) {
  if (buf.length < text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (buf[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function hexByte(b) {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

function requireBytes(value, name) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${name} must be a Buffer`);
}

/** prefix / suffix option: Buffer, Uint8Array, hex string, or null/undefined (= no bytes). */
function toBytes(value, name) {
  if (value == null) return EMPTY;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return hexToBuffer(value);
  throw new TypeError(`${name} must be a Buffer or hex string`);
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.trunc(n);
}
