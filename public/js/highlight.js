// Renders HL7 text as coloured spans using the shared tokenizer (/lib/tokenize.js).
// Two modes:
//   - inspector mode: one block per segment, control chars shown as glyphs, segment separators as dim glyphs,
//     tooltips with field number and dictionary name
//   - mirror mode (sender editor): output text is identical to the input (same chars, one block per line),
//     so the coloured layer lines up exactly with a transparent textarea placed on top

import { tokenize } from '/lib/tokenize.js';
import { fieldName, segmentName } from '/lib/dictionary.js';
import { el, controlGlyph, controlName } from './format.js';

const DEFAULT_DELIMS = { field: '|', component: '^', repetition: '~', escape: '\\', subcomponent: '&' };
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const SEP_GLYPH = { CR: '␍', LF: '␊', CRLF: '␍␊' };
const ESCAPE_TITLES = {
  F: 'separator pola',
  S: 'separator komponentu',
  T: 'separator podkomponentu',
  R: 'separator powtórzenia',
  E: 'znak escape',
  '.br': 'podział wiersza',
  H: 'początek wyróżnienia',
  N: 'koniec wyróżnienia',
};

/** Delimiters from MSH-1/MSH-2 when non-default, otherwise null (tokenize then uses its own detection). */
export function detectDelimiters(text) {
  if (typeof text !== 'string' || text.length < 8 || !text.startsWith('MSH')) return null;
  const d = {
    field: text[3],
    component: text[4],
    repetition: text[5],
    escape: text[6],
    subcomponent: text[7],
  };
  const isDefault = Object.keys(DEFAULT_DELIMS).every((k) => d[k] === DEFAULT_DELIMS[k]);
  return isDefault ? null : d;
}

/** Split text into lines keeping the separator kind of each line: [{ line, sep: 'CR'|'LF'|'CRLF'|null }]. */
export function splitLines(text) {
  const out = [];
  const re = /\r\n|\r|\n/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out.push({ line: text.slice(last, m.index), sep: m[0] === '\r\n' ? 'CRLF' : m[0] === '\r' ? 'CR' : 'LF' });
    last = m.index + m[0].length;
  }
  out.push({ line: text.slice(last), sep: null });
  return out;
}

function plainToken(line) {
  return [{ type: 'text', text: line, fieldIndex: 0, repIndex: 0, componentIndex: 0, subIndex: 0 }];
}

/** Tokenize a single line (no segment separators inside). Falls back to one plain token on any problem. */
export function tokensForLine(line, delims = null) {
  if (!line) return [];
  try {
    const result = tokenize(line, delims);
    const segments = result && Array.isArray(result.segments) ? result.segments : null;
    if (!segments || !segments.length) return plainToken(line);
    const tokens = segments.length === 1 ? segments[0].tokens : segments.flatMap((s) => s.tokens || []);
    if (!Array.isArray(tokens) || !tokens.length) return plainToken(line);
    // Safety: the concatenated token text must reproduce the line exactly, otherwise the mirror would misalign.
    let total = 0;
    for (const tk of tokens) total += tk && typeof tk.text === 'string' ? tk.text.length : 0;
    if (total !== line.length) return plainToken(line);
    return tokens;
  } catch (err) {
    return plainToken(line);
  }
}

function escapeTitle(text) {
  const inner = String(text).slice(1, -1);
  if (ESCAPE_TITLES[inner]) return `Sekwencja escape: ${ESCAPE_TITLES[inner]}`;
  if (/^X[0-9A-Fa-f]+$/.test(inner)) return `Sekwencja escape: bajty hex ${inner.slice(1).toUpperCase()}`;
  if (/^Z/.test(inner)) return `Sekwencja escape zdefiniowana lokalnie: ${text}`;
  return `Sekwencja escape ${text}`;
}

function renderToken(tk, mirror) {
  const type = tk && typeof tk.type === 'string' ? tk.type : 'text';
  const text = tk && typeof tk.text === 'string' ? tk.text : '';
  if (type === 'ctrl') {
    if (mirror) return el('span', { class: 'tk-ctrl' }, text);
    const code = text ? text.charCodeAt(0) : 0;
    return el('span', { class: 'tk-ctrl', title: `Znak sterujący ${controlName(code)}` }, tk.glyph || controlGlyph(code));
  }
  if (type === 'escape') {
    return el('span', { class: 'tk-escape', title: mirror ? null : escapeTitle(text) }, text);
  }
  switch (type) {
    case 'segname':
    case 'fieldsep':
    case 'compsep':
    case 'repsep':
    case 'subsep':
    case 'text':
      return el('span', { class: `tk-${type}` }, text);
    default:
      return el('span', { class: 'tk-text' }, text);
  }
}

function fieldTitle(segName, fi) {
  if (!segName || segName === '???') return null;
  if (fi === 0) {
    const sname = segmentName(segName);
    return sname ? `${segName}: ${sname}` : segName;
  }
  let name = '';
  try {
    name = fieldName(segName, fi) || '';
  } catch (err) {
    name = '';
  }
  return name && name !== `${segName}-${fi}` ? `${segName}-${fi} ${name}` : `${segName}-${fi}`;
}

function renderLine(line, sep, { mirror, tooltips, delims }) {
  const tokens = tokensForLine(line, delims);
  const segName = tokens.length && tokens[0].type === 'segname' ? tokens[0].text : (line ? line.slice(0, 3) : '');
  const lineEl = el('div', { class: 'hl7-line', 'data-seg': segName || null });
  if (!line) {
    // Zero-width space keeps an empty line box (textarea shows an empty line for "\n\n").
    lineEl.append(ZERO_WIDTH_SPACE);
  } else {
    let group = null;
    let groupIdx = null;
    for (const tk of tokens) {
      const fi = tk && Number.isFinite(tk.fieldIndex) ? tk.fieldIndex : 0;
      if (!group || fi !== groupIdx) {
        groupIdx = fi;
        group = el('span', { class: `hl7-field ${fi % 2 === 0 ? 'even' : 'odd'}`, 'data-f': fi });
        if (tooltips) {
          const title = fieldTitle(segName, fi);
          if (title) group.title = title;
        }
        lineEl.append(group);
      }
      group.append(renderToken(tk, mirror));
    }
  }
  if (!mirror && sep) {
    lineEl.append(el('span', {
      class: `hl7-sep sep-${sep.toLowerCase()}`,
      title: sep === 'CR' ? 'Separator segmentu: CR (0D), zgodny z HL7' : `Separator segmentu: ${sep} (HL7 wymaga CR)`,
    }, SEP_GLYPH[sep]));
  }
  return lineEl;
}

/**
 * Render HL7 text into a coloured block.
 * opts: { mirror = false, tooltips = !mirror, maxChars = 300000 }
 */
export function renderHl7(text, opts = {}) {
  const mirror = !!opts.mirror;
  const tooltips = opts.tooltips === undefined ? !mirror : !!opts.tooltips;
  const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : 300000;
  const original = typeof text === 'string' ? text : String(text === null || text === undefined ? '' : text);
  let value = original;
  let truncated = false;
  if (value.length > maxChars) {
    value = value.slice(0, maxChars);
    truncated = true;
  }
  const root = el('div', { class: mirror ? 'hl7 hl7-mirror' : 'hl7' });
  const delims = detectDelimiters(value);
  const lines = splitLines(value);
  if (!mirror && lines.length > 1 && lines[lines.length - 1].line === '') lines.pop();
  for (const entry of lines) {
    root.append(renderLine(entry.line, entry.sep, { mirror, tooltips, delims }));
  }
  if (!mirror) {
    const last = lines[lines.length - 1];
    if (last && last.line && !last.sep && !truncated) {
      root.lastChild.append(el('span', {
        class: 'hl7-sep missing',
        title: 'Brak końcowego separatora segmentu (CR) na końcu wiadomości',
      }, '␍'));
    }
    if (truncated) {
      root.append(el('div', { class: 'hl7-truncated' }, `Pokazano pierwsze ${maxChars} znaków z ${original.length}.`));
    }
  }
  return root;
}

/** Small legend explaining the token colours (inspector). */
export function renderLegend() {
  const items = [
    ['tk-segname', 'MSH', 'nazwa segmentu'],
    ['tk-fieldsep', '|', 'pole'],
    ['tk-compsep', '^', 'komponent'],
    ['tk-repsep', '~', 'powtórzenie'],
    ['tk-subsep', '&', 'podkomponent'],
    ['tk-escape', '\\F\\', 'escape'],
    ['tk-ctrl', '␋', 'znak sterujący'],
    ['hl7-sep', '␍', 'separator segmentu'],
  ];
  const legend = el('div', { class: 'hl7-legend' });
  for (const [cls, sample, label] of items) {
    legend.append(el('span', { class: 'legend-item' }, el('span', { class: `legend-sample ${cls}` }, sample), ' ', label));
  }
  return legend;
}
