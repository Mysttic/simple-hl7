// HL7 v2 message parser. Browser-safe ESM: no node imports, no Buffer, no process.
// Pure string processing, never throws on malformed input (parseMessage).

import { describeMessageType } from './dictionary.js';

export const DEFAULT_DELIMITERS = Object.freeze({
  field: '|',
  component: '^',
  repetition: '~',
  escape: '\\',
  subcomponent: '&'
});

const SEGMENT_NAME_RE = /^[A-Z][A-Z0-9]{2}$/;
const PATH_RE = /^\s*([A-Za-z?][A-Za-z0-9?]{2})(?:\[(\d+)\])?(?:-(\d+)(?:\((\d+)\))?(?:\.(\d+)(?:\.(\d+))?)?)?\s*$/;
const DELIMITER_KEYS = ['field', 'component', 'repetition', 'escape', 'subcomponent'];

// ---------------------------------------------------------------------------
// Splitting helpers (shared with tokenize.js)
// ---------------------------------------------------------------------------

function toText(input) {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'object' && typeof input.text === 'string') return input.text;
  return String(input);
}

// Detect which segment separator(s) the text uses.
export function detectSegmentSeparator(text) {
  let crlf = 0;
  let cr = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (code === 10) {
      lf++;
    }
  }
  const kinds = (crlf ? 1 : 0) + (cr ? 1 : 0) + (lf ? 1 : 0);
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  if (crlf) return 'CRLF';
  if (cr) return 'CR';
  return 'LF';
}

// Split text into segment lines with exact positions. Trailing empty lines are dropped.
// Returns [{ raw, start, end, separatorAfter: 'CR'|'LF'|'CRLF'|null }]
export function splitSegments(text) {
  const lines = [];
  const re = /\r\n|\r|\n/g;
  let pos = 0;
  for (;;) {
    const m = re.exec(text);
    const end = m ? m.index : text.length;
    const raw = text.slice(pos, end);
    let separatorAfter = null;
    if (m) separatorAfter = m[0] === '\r\n' ? 'CRLF' : m[0] === '\r' ? 'CR' : 'LF';
    lines.push({ raw, start: pos, end, separatorAfter });
    if (!m) break;
    pos = m.index + m[0].length;
  }
  while (lines.length && lines[lines.length - 1].raw === '') lines.pop();
  return lines;
}

// Strip MLLP framing bytes that may have leaked into the text (leading VT, trailing FS).
function stripFraming(text, warnings) {
  let out = text;
  if (out.charCodeAt(0) === 0xfeff) {
    out = out.slice(1);
    warnings.push('Leading byte order mark (U+FEFF) found in text and ignored');
  }
  if (out.charCodeAt(0) === 0x0b) {
    out = out.slice(1);
    warnings.push('Leading MLLP start byte (0x0B) found in text and ignored');
  }
  const fs = out.indexOf('\x1c');
  if (fs >= 0 && /^[\x1c\r\n]*$/.test(out.slice(fs))) {
    out = out.slice(0, fs);
    warnings.push('Trailing MLLP end byte (0x1C) found in text and ignored');
  }
  return out;
}

function isUsableDelimiter(ch) {
  if (typeof ch !== 'string' || ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  if (code === 13 || code === 10) return false;
  if (code <= 0x20 || code === 0x7f) return false;
  return !/[A-Za-z0-9]/.test(ch);
}

function pickOverrides(overrides) {
  const out = {};
  if (!overrides || typeof overrides !== 'object') return out;
  for (const key of DELIMITER_KEYS) {
    if (isUsableDelimiter(overrides[key])) out[key] = overrides[key];
  }
  return out;
}

// Detect delimiters from the MSH segment (same rule for parser and tokenizer).
// Returns { delimiters, warnings, mshLine }
export function detectDelimiters(text, overrides = null) {
  const warnings = [];
  const d = { ...DEFAULT_DELIMITERS };
  const src = toText(text);
  const lines = splitSegments(src);
  const msh = lines.find((l) => l.raw.startsWith('MSH'));
  if (!msh) {
    warnings.push('No MSH segment found, using default delimiters');
  } else if (msh.raw.length < 4) {
    warnings.push('MSH segment is truncated, using default delimiters');
  } else {
    const field = msh.raw[3];
    if (!isUsableDelimiter(field)) {
      warnings.push(`Invalid field separator "${field}" in MSH-1, using "|"`);
    } else {
      d.field = field;
    }
    let encEnd = msh.raw.indexOf(d.field, 4);
    if (encEnd < 0) encEnd = msh.raw.length;
    const enc = msh.raw.slice(4, encEnd);
    const names = ['component', 'repetition', 'escape', 'subcomponent'];
    if (enc.length < 4) {
      warnings.push(`MSH-2 encoding characters "${enc}" are incomplete, missing ones default to ^~\\&`);
    }
    names.forEach((name, i) => {
      const ch = enc[i];
      if (ch === undefined) return;
      if (!isUsableDelimiter(ch)) {
        warnings.push(`Invalid ${name} separator "${ch}" in MSH-2, using "${DEFAULT_DELIMITERS[name]}"`);
        return;
      }
      d[name] = ch;
    });
  }
  Object.assign(d, pickOverrides(overrides));
  // all delimiters must be distinct
  const seen = new Map();
  for (const key of DELIMITER_KEYS) {
    const ch = d[key];
    if (seen.has(ch)) {
      warnings.push(`Delimiter conflict: ${key} and ${seen.get(ch)} are both "${ch}", using default "${DEFAULT_DELIMITERS[key]}" for ${key}`);
      d[key] = DEFAULT_DELIMITERS[key];
    }
    seen.set(d[key], key);
  }
  return { delimiters: d, warnings, mshLine: msh ? msh.raw : null };
}

// ---------------------------------------------------------------------------
// Field structure
// ---------------------------------------------------------------------------

function parseField(value, d) {
  const text = value == null ? '' : String(value);
  const repetitions = text.split(d.repetition).map((rv) => ({
    value: rv,
    components: rv.split(d.component).map((cv) => ({
      value: cv,
      subcomponents: cv.split(d.subcomponent)
    }))
  }));
  return { value: text, repetitions };
}

// A field that is never split (segment name, MSH-1, MSH-2).
function simpleField(value) {
  const text = value == null ? '' : String(value);
  return {
    value: text,
    repetitions: [{ value: text, components: [{ value: text, subcomponents: [text] }] }]
  };
}

function previewLine(raw) {
  const s = raw.length > 40 ? `${raw.slice(0, 40)}...` : raw;
  return s.replace(/[\x00-\x1f\x7f]/g, (ch) => `<${ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}>`);
}

function parseSegmentLine(raw, index, d, warnings) {
  if (raw.startsWith('MSH')) {
    const fields = [simpleField('MSH')];
    if (raw.length < 4) {
      warnings.push(`MSH segment at line ${index + 1} is truncated`);
      return { name: 'MSH', index, raw, fields };
    }
    const sep = raw[3];
    fields.push(simpleField(sep));
    const parts = raw.slice(4).split(d.field);
    fields.push(simpleField(parts[0]));
    for (let i = 1; i < parts.length; i++) fields.push(parseField(parts[i], d));
    return { name: 'MSH', index, raw, fields };
  }
  const parts = raw.split(d.field);
  if (SEGMENT_NAME_RE.test(parts[0])) {
    const fields = [simpleField(parts[0])];
    for (let i = 1; i < parts.length; i++) fields.push(parseField(parts[i], d));
    return { name: parts[0], index, raw, fields };
  }
  if (raw === '') {
    warnings.push(`Line ${index + 1} is empty`);
  } else {
    warnings.push(`Line ${index + 1} does not start with a segment name: "${previewLine(raw)}"`);
  }
  const fields = [simpleField('???')];
  for (let i = 0; i < parts.length; i++) fields.push(parseField(parts[i], d));
  return { name: '???', index, raw, fields };
}

function buildRaw(segment, d) {
  const values = segment.fields.map((f) => f.value);
  if (segment.name === 'MSH') {
    if (values.length < 2) return 'MSH';
    const sep = values[1] || d.field;
    return `MSH${sep}${values.slice(2).join(d.field)}`;
  }
  if (segment.name === '???') return values.slice(1).join(d.field);
  return values.join(d.field);
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// Parse 'SEG[occ]-n(rep).c.s'. Returns null for invalid syntax or zero indices.
export function parsePath(path) {
  if (typeof path !== 'string') return null;
  const m = PATH_RE.exec(path);
  if (!m) return null;
  const toInt = (s) => (s === undefined ? null : parseInt(s, 10));
  const out = {
    segment: m[1].toUpperCase(),
    occurrence: toInt(m[2]) ?? 1,
    field: toInt(m[3]),
    repetition: toInt(m[4]),
    component: toInt(m[5]),
    subcomponent: toInt(m[6])
  };
  if (out.occurrence < 1) return null;
  if (out.repetition !== null && out.repetition < 1) return null;
  if (out.component !== null && out.component < 1) return null;
  if (out.subcomponent !== null && out.subcomponent < 1) return null;
  return out;
}

function getFromSegment(seg, p) {
  if (p.field === null) return seg.raw;
  const f = seg.fields[p.field];
  if (!f) return '';
  if (seg.name === 'MSH' && (p.field === 1 || p.field === 2)) return f.value;
  if (p.repetition === null && p.component === null) return f.value;
  const rep = f.repetitions[(p.repetition ?? 1) - 1];
  if (!rep) return '';
  if (p.component === null) return rep.value;
  const comp = rep.components[p.component - 1];
  if (!comp) return '';
  if (p.subcomponent === null) return comp.value;
  const sub = comp.subcomponents[p.subcomponent - 1];
  return sub === undefined ? '' : sub;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export class Message {
  constructor(segments, delimiters, warnings) {
    this.segments = segments;
    this.delimiters = delimiters;
    this.warnings = warnings;
  }

  getSegment(name, occurrence = 1) {
    if (typeof name !== 'string') return null;
    const wanted = name.toUpperCase();
    const occ = Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1;
    let seen = 0;
    for (const seg of this.segments) {
      if (seg.name === wanted) {
        seen++;
        if (seen === occ) return seg;
      }
    }
    return null;
  }

  getSegments(name) {
    if (typeof name !== 'string') return [];
    const wanted = name.toUpperCase();
    return this.segments.filter((s) => s.name === wanted);
  }

  get(path) {
    const p = parsePath(path);
    if (!p) return '';
    const seg = this.getSegment(p.segment, p.occurrence);
    if (!seg) return '';
    return getFromSegment(seg, p);
  }

  has(path) {
    const p = parsePath(path);
    if (!p) return false;
    const seg = this.getSegment(p.segment, p.occurrence);
    if (!seg) return false;
    if (p.field === null) return true;
    return seg.fields[p.field] !== undefined;
  }

  toJSON() {
    return {
      delimiters: { ...this.delimiters },
      warnings: this.warnings.slice(),
      segments: this.segments.map((seg) => ({
        name: seg.name,
        index: seg.index,
        raw: seg.raw,
        values: seg.fields.map((f) => f.value),
        fields: seg.fields.map((f) =>
          f.repetitions.map((r) => r.components.map((c) => c.subcomponents.slice()))
        )
      }))
    };
  }
}

export function isMessage(value) {
  return value instanceof Message
    || (value !== null && typeof value === 'object' && Array.isArray(value.segments) && typeof value.get === 'function');
}

// Parse HL7 text. opts.delimiters may override detected delimiters (partial object).
export function parseMessage(text, opts = {}) {
  const warnings = [];
  let src;
  try {
    src = toText(text);
  } catch {
    src = '';
  }
  if (typeof text !== 'string' && text != null) {
    warnings.push(`Input was ${Array.isArray(text) ? 'an array' : typeof text}, converted to string`);
  }
  src = stripFraming(src, warnings);
  const detected = detectDelimiters(src, opts && opts.delimiters);
  warnings.push(...detected.warnings);
  const d = detected.delimiters;
  const lines = splitSegments(src);
  const segments = lines.map((line, index) => parseSegmentLine(line.raw, index, d, warnings));
  if (segments.length && segments[0].name !== 'MSH' && segments.some((s) => s.name === 'MSH')) {
    warnings.push(`First segment is ${segments[0].name}, expected MSH`);
  }
  if (src.length === 0) warnings.push('Message is empty');
  const delimiters = { ...d, segment: detectSegmentSeparator(src) };
  return new Message(segments, delimiters, warnings);
}

export function summarize(message) {
  const msg = isMessage(message) ? message : parseMessage(message);
  const messageType = msg.get('MSH-9.1');
  const triggerEvent = msg.get('MSH-9.2');
  return {
    messageType,
    triggerEvent,
    messageStructure: msg.get('MSH-9.3'),
    controlId: msg.get('MSH-10'),
    sendingApplication: msg.get('MSH-3'),
    sendingFacility: msg.get('MSH-4'),
    receivingApplication: msg.get('MSH-5'),
    receivingFacility: msg.get('MSH-6'),
    timestamp: msg.get('MSH-7'),
    version: msg.get('MSH-12.1'),
    processingId: msg.get('MSH-11.1'),
    characterSet: msg.get('MSH-18'),
    segmentNames: msg.segments.map((s) => s.name),
    segmentCount: msg.segments.length,
    description: describeMessageType(messageType, triggerEvent)
  };
}

export function serialize(message, segmentSeparator = '\r') {
  const msg = isMessage(message) ? message : parseMessage(message);
  const sep = typeof segmentSeparator === 'string' ? segmentSeparator : '\r';
  if (!msg.segments.length) return '';
  return msg.segments.map((s) => s.raw).join(sep) + sep;
}

// Set a field/component/subcomponent. Pads missing fields. Keeps raw and value in sync.
export function setField(message, path, value) {
  if (!isMessage(message)) throw new Error('setField: first argument must be a parsed Message');
  const p = parsePath(path);
  if (!p || p.field === null) throw new Error(`setField: invalid field path "${path}"`);
  if (p.field === 0) throw new Error(`setField: cannot set segment name via "${path}"`);
  const seg = message.getSegment(p.segment, p.occurrence);
  if (!seg) throw new Error(`setField: segment ${p.segment}[${p.occurrence}] not found`);
  if (seg.name === 'MSH' && p.field <= 2) {
    throw new Error('setField: MSH-1 and MSH-2 are delimiters and cannot be set');
  }
  const d = message.delimiters;
  const text = value == null ? '' : String(value);
  if (seg.name === 'MSH' && seg.fields.length < 3) {
    seg.fields.length = 1;
    seg.fields.push(simpleField(d.field), simpleField(`${d.component}${d.repetition}${d.escape}${d.subcomponent}`));
  }
  while (seg.fields.length <= p.field) seg.fields.push(parseField('', d));
  const field = seg.fields[p.field];
  let newValue;
  if (p.repetition === null && p.component === null) {
    newValue = text;
  } else {
    const reps = field.repetitions.map((r) => r.value);
    const ri = (p.repetition ?? 1) - 1;
    while (reps.length <= ri) reps.push('');
    if (p.component === null) {
      reps[ri] = text;
    } else {
      const comps = reps[ri].split(d.component);
      const ci = p.component - 1;
      while (comps.length <= ci) comps.push('');
      if (p.subcomponent === null) {
        comps[ci] = text;
      } else {
        const subs = comps[ci].split(d.subcomponent);
        const si = p.subcomponent - 1;
        while (subs.length <= si) subs.push('');
        subs[si] = text;
        comps[ci] = subs.join(d.subcomponent);
      }
      reps[ri] = comps.join(d.component);
    }
    newValue = reps.join(d.repetition);
  }
  seg.fields[p.field] = parseField(newValue, d);
  seg.raw = buildRaw(seg, d);
}

// ---------------------------------------------------------------------------
// Escape sequences
// ---------------------------------------------------------------------------

function decodeHexEscape(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  if (bytes.every((b) => b < 0x80)) return String.fromCharCode(...bytes);
  if (typeof TextDecoder === 'function') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    } catch {
      // not valid UTF-8, fall through to single-byte interpretation
    }
  }
  return String.fromCharCode(...bytes);
}

function decodeEscape(code, d) {
  switch (code) {
    case 'F': return d.field;
    case 'S': return d.component;
    case 'T': return d.subcomponent;
    case 'R': return d.repetition;
    case 'E': return d.escape;
    case 'H': return '';
    case 'N': return '';
    case '.br': return '\n';
    case '.sp': return '\n';
    default:
      if (/^X(?:[0-9A-Fa-f]{2})+$/.test(code)) return decodeHexEscape(code.slice(1));
      return null;
  }
}

// Decode HL7 escape sequences. Unknown sequences are left untouched.
export function unescape(text, delimiters = null) {
  const src = text == null ? '' : String(text);
  const d = { ...DEFAULT_DELIMITERS, ...pickOverrides(delimiters) };
  const esc = d.escape;
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === esc) {
      const j = src.indexOf(esc, i + 1);
      if (j > i + 1) {
        const rep = decodeEscape(src.slice(i + 1, j), d);
        if (rep !== null) {
          out += rep;
          i = j + 1;
          continue;
        }
      }
    }
    out += src[i];
    i++;
  }
  return out;
}

// Encode delimiter characters (and line breaks) inside a value as escape sequences.
export function escape(text, delimiters = null) {
  const src = text == null ? '' : String(text);
  const d = { ...DEFAULT_DELIMITERS, ...pickOverrides(delimiters) };
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === d.escape) out += `${d.escape}E${d.escape}`;
    else if (ch === d.field) out += `${d.escape}F${d.escape}`;
    else if (ch === d.component) out += `${d.escape}S${d.escape}`;
    else if (ch === d.subcomponent) out += `${d.escape}T${d.escape}`;
    else if (ch === d.repetition) out += `${d.escape}R${d.escape}`;
    else if (ch === '\r') {
      out += `${d.escape}.br${d.escape}`;
      if (src[i + 1] === '\n') i++;
    } else if (ch === '\n') out += `${d.escape}.br${d.escape}`;
    else out += ch;
  }
  return out;
}
