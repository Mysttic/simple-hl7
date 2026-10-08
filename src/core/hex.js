// Hex helpers shared by the MLLP transport, the event store and the REST layer.
// Hex strings are emitted uppercase without separators ("0B", "1C0D"); parsers are liberal
// and accept "0B", "0b", "0x0B", "0B 1C 0D", "0B,1C,0D", "0x1C 0x0D" and "0B:1C:0D".

const HEX_TOKEN_RE = /^[0-9A-Fa-f]*$/;
const SEPARATOR_RE = /[\s,:]+/;

/**
 * Parse a hex string into a Buffer. Empty string gives an empty Buffer.
 * Buffers / Uint8Arrays are copied and returned as-is (convenience for callers that
 * accept either form). Anything else throws `Invalid hex: ...`.
 */
export function hexToBuffer(str) {
  if (Buffer.isBuffer(str)) return Buffer.from(str);
  if (str instanceof Uint8Array) return Buffer.from(str);
  if (typeof str !== 'string') throw new Error(`Invalid hex: ${str}`);
  const tokens = str.trim().split(SEPARATOR_RE).filter((t) => t.length > 0);
  let digits = '';
  for (const token of tokens) {
    const clean = token.replace(/^0[xX]/, '');
    if (!HEX_TOKEN_RE.test(clean) || clean.length % 2 !== 0) {
      throw new Error(`Invalid hex: ${str}`);
    }
    digits += clean;
  }
  return Buffer.from(digits, 'hex');
}

/** Buffer -> "0B 1C 0D" (uppercase). sep '' gives "0B1C0D". */
export function bufferToHex(buf, sep = ' ') {
  const b = toBuffer(buf, 'bufferToHex');
  const hex = b.toString('hex').toUpperCase();
  if (sep === '' || hex.length === 0) return hex;
  const pairs = hex.match(/../g) || [];
  return pairs.join(String(sep));
}

/** Any accepted hex spelling -> canonical uppercase, no separators. Throws on invalid input. */
export function normalizeHex(str) {
  return bufferToHex(hexToBuffer(str), '');
}

/**
 * Build a hex dump model (no formatting, the UI renders it).
 * opts: { bytesPerLine = 16, prefixLen = 0, suffixLen = 0 }
 * Returns { lines: [{ offset, bytes: [{ offset, hex, ascii, cls }], hex, ascii }], length }
 * cls: 'prefix' (first prefixLen bytes), 'suffix' (last suffixLen bytes), 'ctrl' (0x00-0x1F, 0x7F),
 *      'nonascii' (>= 0x80), 'text' otherwise.
 */
export function hexdump(buf, opts = {}) {
  const b = toBuffer(buf, 'hexdump');
  const options = opts && typeof opts === 'object' ? opts : {};
  const bytesPerLine = clampInt(options.bytesPerLine, 16, 1, 4096);
  const prefixLen = clampInt(options.prefixLen, 0, 0, b.length);
  const suffixLen = clampInt(options.suffixLen, 0, 0, Math.max(0, b.length - prefixLen));
  const suffixStart = b.length - suffixLen;
  const lines = [];
  for (let offset = 0; offset < b.length; offset += bytesPerLine) {
    const end = Math.min(offset + bytesPerLine, b.length);
    const bytes = [];
    for (let i = offset; i < end; i += 1) {
      bytes.push(describeByte(b[i], i, prefixLen, suffixStart));
    }
    lines.push({
      offset,
      bytes,
      hex: bytes.map((x) => x.hex).join(' '),
      ascii: bytes.map((x) => x.ascii).join(''),
    });
  }
  return { lines, length: b.length };
}

/** Classify a single byte the same way hexdump does (exported for reuse by framing analysis). */
export function byteClass(value, offset, prefixLen = 0, suffixStart = Infinity) {
  if (offset < prefixLen) return 'prefix';
  if (offset >= suffixStart) return 'suffix';
  if (value < 0x20 || value === 0x7f) return 'ctrl';
  if (value >= 0x80) return 'nonascii';
  return 'text';
}

/** Printable ASCII as char, everything else as '.'. */
export function byteToAscii(value) {
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.';
}

function describeByte(value, offset, prefixLen, suffixStart) {
  return {
    offset,
    hex: value.toString(16).toUpperCase().padStart(2, '0'),
    ascii: byteToAscii(value),
    cls: byteClass(value, offset, prefixLen, suffixStart),
  };
}

function toBuffer(value, fnName) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value == null) return Buffer.alloc(0);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Array.isArray(value)) return Buffer.from(value);
  throw new TypeError(`${fnName} expects a Buffer, Uint8Array, string or byte array`);
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}
