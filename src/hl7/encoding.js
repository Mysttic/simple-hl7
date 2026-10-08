// Character encoding helpers (node only, uses iconv-lite). Encodes/decodes HL7 payloads,
// maps MSH-18 values to encodings and detects inconsistencies between declared, used and actual bytes.

import iconv from 'iconv-lite';
import { Buffer } from 'node:buffer';

export const ENCODINGS = ['utf8', 'cp1250', 'iso88592', 'latin1', 'windows1252', 'ascii'];

// Canonical encoding -> iconv-lite name
const ICONV_NAMES = {
  utf8: 'utf8',
  cp1250: 'win1250',
  iso88592: 'iso88592',
  latin1: 'latin1',
  windows1252: 'win1252',
  ascii: 'ascii'
};

// Canonical encoding -> value to put in MSH-18 (HL7 table 0211)
const MSH18_VALUES = {
  utf8: 'UNICODE UTF-8',
  cp1250: 'CP1250',
  iso88592: '8859/2',
  latin1: '8859/1',
  windows1252: 'CP1252',
  ascii: 'ASCII'
};

// Alias keys are lowercased with spaces, hyphens and underscores removed.
const ALIASES = {
  utf8: 'utf8',
  unicodeutf8: 'utf8',
  unicode: 'utf8',
  utf: 'utf8',
  cp1250: 'cp1250',
  win1250: 'cp1250',
  windows1250: 'cp1250',
  'ibm1250': 'cp1250',
  iso88592: 'iso88592',
  'iso8859/2': 'iso88592',
  '8859/2': 'iso88592',
  latin2: 'iso88592',
  l2: 'iso88592',
  latin1: 'latin1',
  iso88591: 'latin1',
  'iso8859/1': 'latin1',
  '8859/1': 'latin1',
  l1: 'latin1',
  windows1252: 'windows1252',
  win1252: 'windows1252',
  cp1252: 'windows1252',
  ascii: 'ascii',
  usascii: 'ascii',
  '646': 'ascii',
  iso646: 'ascii'
};

const SINGLE_BYTE = new Set(['cp1250', 'iso88592', 'latin1', 'windows1252', 'ascii']);

function aliasKey(name) {
  return String(name).trim().toLowerCase().replace(/[\s_-]+/g, '');
}

// Map any supported alias to a canonical ENCODINGS entry, or null when unknown.
export function normalizeEncoding(name) {
  if (typeof name !== 'string') return null;
  const key = aliasKey(name);
  if (!key) return null;
  return ALIASES[key] || null;
}

export function isSupportedEncoding(name) {
  return normalizeEncoding(name) !== null;
}

function requireEncoding(name) {
  const enc = normalizeEncoding(name);
  if (!enc) {
    const err = new Error(`Unsupported encoding: ${String(name)} (supported: ${ENCODINGS.join(', ')})`);
    err.code = 'E_ENCODING';
    throw err;
  }
  return enc;
}

export function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (Array.isArray(input)) return Buffer.from(input);
  if (typeof input === 'string') return Buffer.from(input, 'latin1');
  if (input === null || input === undefined) return Buffer.alloc(0);
  throw new TypeError('Expected a Buffer, Uint8Array, ArrayBuffer, byte array or string');
}

function encodeAscii(text) {
  const out = Buffer.alloc(text.length);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i);
    if (code > 0xffff) i++;
    out[n++] = code < 0x80 ? code : 0x3f;
  }
  return n === out.length ? out : out.subarray(0, n);
}

function decodeAscii(buf) {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    out += b < 0x80 ? String.fromCharCode(b) : '�';
  }
  return out;
}

// Encode text to bytes. Unmappable characters become '?' (iconv-lite default).
export function encode(text, encoding = 'utf8') {
  const enc = requireEncoding(encoding);
  const str = text === null || text === undefined ? '' : String(text);
  if (enc === 'ascii') return encodeAscii(str);
  return iconv.encode(str, ICONV_NAMES[enc]);
}

// Decode bytes to text. A UTF-8 BOM is kept (visible as U+FEFF) so framing defects stay visible.
export function decode(buf, encoding = 'utf8') {
  const enc = requireEncoding(encoding);
  const bytes = toBuffer(buf);
  if (enc === 'ascii') return decodeAscii(bytes);
  return iconv.decode(bytes, ICONV_NAMES[enc], { stripBOM: false });
}

// Map an MSH-18 value (first repetition) to a canonical encoding, or null.
export function encodingFromMsh18(value) {
  if (typeof value !== 'string') return null;
  const first = value.split('~').map((s) => s.trim()).find((s) => s !== '');
  if (!first) return null;
  return normalizeEncoding(first);
}

// Reverse mapping: canonical encoding -> MSH-18 value ('' when unknown).
export function msh18ForEncoding(encoding) {
  const enc = normalizeEncoding(encoding);
  return enc ? MSH18_VALUES[enc] : '';
}

// Scan bytes for UTF-8 structure: counts of bytes >= 0x80, valid multibyte sequences and invalid bytes.
export function analyzeUtf8(buf) {
  const bytes = toBuffer(buf);
  let highBytes = 0;
  let validMultibyte = 0;
  let invalidBytes = 0;
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    highBytes++;
    let need = 0;
    let min2 = 0x80;
    let max2 = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) min2 = 0xa0;
      if (b === 0xed) max2 = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      if (b === 0xf0) min2 = 0x90;
      if (b === 0xf4) max2 = 0x8f;
    } else {
      invalidBytes++;
      i++;
      continue;
    }
    let ok = i + need < len;
    if (ok) {
      const c1 = bytes[i + 1];
      if (c1 < min2 || c1 > max2) ok = false;
      for (let k = 2; ok && k <= need; k++) {
        const ck = bytes[i + k];
        if (ck < 0x80 || ck > 0xbf) ok = false;
      }
    }
    if (ok) {
      validMultibyte++;
      highBytes += need;
      i += need + 1;
    } else {
      invalidBytes++;
      i++;
    }
  }
  return { highBytes, validMultibyte, invalidBytes, length: len };
}

// Warnings (English) about mismatches between MSH-18, the configured encoding and the actual bytes.
export function checkEncodingConsistency(buf, declaredMsh18, usedEncoding) {
  const warnings = [];
  let bytes;
  try {
    bytes = toBuffer(buf);
  } catch (err) {
    return [`Cannot analyze payload bytes: ${err.message}`];
  }
  const declaredRaw = typeof declaredMsh18 === 'string' ? declaredMsh18.trim() : '';
  const declared = declaredRaw ? encodingFromMsh18(declaredRaw) : null;
  const usedRaw = typeof usedEncoding === 'string' ? usedEncoding.trim() : '';
  const used = usedRaw ? normalizeEncoding(usedRaw) : null;

  if (declaredRaw && !declared) warnings.push(`Unknown character set in MSH-18: "${declaredRaw}"`);
  if (usedRaw && !used) warnings.push(`Unknown encoding configured: "${usedRaw}"`);

  const stats = analyzeUtf8(bytes);
  if (stats.highBytes === 0) return warnings;

  const looksUtf8 = stats.validMultibyte > 0 && stats.invalidBytes === 0;
  const notUtf8 = stats.invalidBytes > 0;

  if (declared && used && declared !== used) {
    warnings.push(`MSH-18 declares ${declaredRaw} (${declared}) but payload was decoded as ${used}`);
  }
  if (declared === 'ascii') {
    warnings.push(`MSH-18 declares ASCII but payload contains ${stats.highBytes} non-ASCII bytes`);
  } else if (declared && SINGLE_BYTE.has(declared) && looksUtf8) {
    warnings.push(`MSH-18 declares ${declaredRaw} but payload contains ${stats.validMultibyte} valid UTF-8 multibyte sequences (looks like UTF-8)`);
  } else if (declared === 'utf8' && notUtf8) {
    warnings.push(`MSH-18 declares ${declaredRaw} but payload contains ${stats.invalidBytes} invalid UTF-8 bytes (looks like a single-byte encoding such as cp1250 or iso88592)`);
  }
  if (used === 'ascii') {
    warnings.push(`Decoded as ascii but payload contains ${stats.highBytes} non-ASCII bytes, they became replacement characters`);
  } else if (used === 'utf8' && notUtf8) {
    warnings.push(`Decoded as utf8 but payload contains ${stats.invalidBytes} invalid UTF-8 bytes, decoded text has replacement characters (probably cp1250 or iso88592)`);
  } else if (used && SINGLE_BYTE.has(used) && looksUtf8) {
    warnings.push(`Decoded as ${used} but payload looks like UTF-8 (${stats.validMultibyte} valid multibyte sequences), diacritics are probably garbled`);
  }
  return warnings;
}
