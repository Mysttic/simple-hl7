// HL7 v2 tokenizer for syntax colouring. Browser-safe ESM.
// Every character of a segment line belongs to exactly one token; tokens carry absolute
// start/end offsets into the input text so the UI can colour character by character.

import { detectDelimiters, splitSegments } from './parser.js';

const SEGMENT_NAME_RE = /^[A-Z][A-Z0-9]{2}$/;
const DELIMITER_KEYS = ['field', 'component', 'repetition', 'escape', 'subcomponent'];
const BOM = 0xfeff;
const LEADING_JUNK_RE = new RegExp("^[\x00-\x1f\x7f" + String.fromCharCode(BOM) + "]+");

// Glyph for a control character (U+2400 block, DEL -> U+2421, byte order mark -> 'BOM').
export function controlGlyph(code) {
  if (code === 0x7f) return String.fromCharCode(0x2421);
  if (code >= 0 && code < 0x20) return String.fromCharCode(0x2400 + code);
  if (code === BOM) return 'BOM';
  return '';
}

export function isControlCode(code) {
  return (code >= 0 && code < 0x20) || code === 0x7f;
}

// Characters rendered as 'ctrl' tokens: control codes plus a stray byte order mark.
function isCtrlToken(code) {
  return isControlCode(code) || code === BOM;
}

function leadingControlCount(line) {
  let n = 0;
  while (n < line.length && isCtrlToken(line.charCodeAt(n))) n++;
  return n;
}

function isEscapeBody(body, d) {
  if (!body || !/^[A-Za-z.]/.test(body)) return false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (isCtrlToken(body.charCodeAt(i))) return false;
    if (ch === d.field || ch === d.component || ch === d.repetition || ch === d.subcomponent || ch === d.escape) {
      return false;
    }
  }
  return true;
}

function tokenizeLine(line, lineStart, name, lead, d) {
  const tokens = [];
  let fieldIndex = 0;
  let repIndex = 0;
  let componentIndex = 0;
  let subIndex = 0;
  let i = 0;

  const push = (type, start, end, extra) => {
    const token = {
      type,
      text: line.slice(start, end),
      fieldIndex,
      repIndex,
      componentIndex,
      subIndex,
      start: lineStart + start,
      end: lineStart + end
    };
    if (extra) Object.assign(token, extra);
    tokens.push(token);
  };

  // Stray control characters before the segment name (e.g. MLLP start byte left in the text).
  for (let k = 0; k < lead; k++) {
    const code = line.charCodeAt(k);
    push('ctrl', k, k + 1, { glyph: controlGlyph(code), code });
  }
  i = lead;

  if (name === 'MSH') {
    push('segname', i, i + 3);
    i += 3;
    fieldIndex = 1;
    repIndex = 1;
    componentIndex = 1;
    subIndex = 1;
    if (i < line.length) {
      push('fieldsep', i, i + 1);
      i++;
      let encEnd = line.indexOf(d.field, i);
      if (encEnd < 0) encEnd = line.length;
      fieldIndex = 2;
      if (encEnd > i) push('text', i, encEnd);
      i = encEnd;
    }
  } else if (name !== '???') {
    push('segname', i, i + 3);
    i += 3;
    repIndex = 1;
    componentIndex = 1;
    subIndex = 1;
  } else {
    fieldIndex = 1;
    repIndex = 1;
    componentIndex = 1;
    subIndex = 1;
  }

  let textStart = -1;
  const flushText = (end) => {
    if (textStart >= 0 && end > textStart) push('text', textStart, end);
    textStart = -1;
  };

  while (i < line.length) {
    const ch = line[i];
    if (ch === d.field) {
      flushText(i);
      fieldIndex++;
      repIndex = 1;
      componentIndex = 1;
      subIndex = 1;
      push('fieldsep', i, i + 1);
      i++;
      continue;
    }
    if (ch === d.repetition) {
      flushText(i);
      repIndex++;
      componentIndex = 1;
      subIndex = 1;
      push('repsep', i, i + 1);
      i++;
      continue;
    }
    if (ch === d.component) {
      flushText(i);
      componentIndex++;
      subIndex = 1;
      push('compsep', i, i + 1);
      i++;
      continue;
    }
    if (ch === d.subcomponent) {
      flushText(i);
      subIndex++;
      push('subsep', i, i + 1);
      i++;
      continue;
    }
    if (ch === d.escape) {
      const j = line.indexOf(d.escape, i + 1);
      if (j > i + 1 && isEscapeBody(line.slice(i + 1, j), d)) {
        flushText(i);
        push('escape', i, j + 1);
        i = j + 1;
        continue;
      }
    }
    const code = line.charCodeAt(i);
    if (isCtrlToken(code)) {
      flushText(i);
      push('ctrl', i, i + 1, { glyph: controlGlyph(code), code });
      i++;
      continue;
    }
    if (textStart < 0) textStart = i;
    i++;
  }
  flushText(line.length);
  return tokens;
}

function pickDelimiters(delimiters) {
  const out = {};
  if (!delimiters || typeof delimiters !== 'object') return out;
  for (const key of DELIMITER_KEYS) {
    const v = delimiters[key];
    if (typeof v === 'string' && v.length === 1) out[key] = v;
  }
  return out;
}

// Tokenize HL7 text. delimiters: optional partial override { field, component, repetition, escape, subcomponent }.
export function tokenize(text, delimiters = null) {
  const src = text == null ? '' : String(text);
  const overrides = pickDelimiters(delimiters);
  const d = detectDelimiters(src.replace(LEADING_JUNK_RE, ''), overrides).delimiters;
  const lines = splitSegments(src);
  const segments = lines.map((line, index) => {
    const lead = leadingControlCount(line.raw);
    const body = line.raw.slice(lead);
    let name = '???';
    if (body.startsWith('MSH')) {
      name = 'MSH';
    } else {
      const sepAt = body.indexOf(d.field);
      const head = sepAt < 0 ? body : body.slice(0, sepAt);
      if (SEGMENT_NAME_RE.test(head)) name = head;
    }
    return {
      name,
      index,
      raw: line.raw,
      start: line.start,
      end: line.end,
      separatorAfter: line.separatorAfter,
      tokens: tokenizeLine(line.raw, line.start, name, lead, d)
    };
  });
  return { segments, delimiters: { ...d } };
}

// Convenience for tests and the UI: rebuild the segment text from tokens.
export function joinTokens(segment) {
  return segment.tokens.map((t) => t.text).join('');
}
