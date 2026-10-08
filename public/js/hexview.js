// Hex dump renderer: client-side equivalent of core/hex.js hexdump(), working on the uppercase hex string
// from event data (data.raw.hex) plus the FramingAnalysis for prefix / suffix highlighting.

import { el, spacedHex, hexOrNone, controlName } from './format.js';

const DEFAULT_MAX_BYTES = 65536;

/** Convert a hex string (any separators, optional 0x) into a Uint8Array. Invalid nibbles are skipped. */
export function hexToBytes(hex) {
  const clean = String(hex === null || hex === undefined ? '' : hex).replace(/0x/gi, '').replace(/[^0-9A-Fa-f]/g, '');
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function byteClass(code) {
  if (code < 0x20 || code === 0x7f) return 'ctrl';
  if (code >= 0x80) return 'nonascii';
  return 'text';
}

export function asciiOf(code) {
  return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : '.';
}

/**
 * hexdump(bytes, { bytesPerLine = 16, prefixLen = 0, suffixLen = 0 })
 * -> { lines: [{ offset, bytes: [{ offset, hex, ascii, cls }] }], length }
 * cls: 'prefix' | 'suffix' | 'ctrl' | 'nonascii' | 'text' (same rules as core/hex.js)
 */
export function hexdump(bytes, opts = {}) {
  const bytesPerLine = Math.max(1, opts.bytesPerLine || 16);
  const prefixLen = Math.max(0, opts.prefixLen || 0);
  const suffixLen = Math.max(0, opts.suffixLen || 0);
  const length = bytes.length;
  const lines = [];
  for (let off = 0; off < length; off += bytesPerLine) {
    const line = { offset: off, bytes: [] };
    const end = Math.min(length, off + bytesPerLine);
    for (let i = off; i < end; i++) {
      const code = bytes[i];
      let cls;
      if (i < prefixLen) cls = 'prefix';
      else if (i >= length - suffixLen) cls = 'suffix';
      else cls = byteClass(code);
      line.bytes.push({ offset: i, hex: code.toString(16).toUpperCase().padStart(2, '0'), ascii: asciiOf(code), cls });
    }
    lines.push(line);
  }
  return { lines, length };
}

function framingLengths(framing, totalLength) {
  if (!framing) return { prefixLen: 0, suffixLen: 0, prefixOk: null, suffixOk: null };
  const expP = String(framing.prefixHexExpected || '').replace(/[^0-9A-Fa-f]/g, '');
  const expS = String(framing.suffixHexExpected || '').replace(/[^0-9A-Fa-f]/g, '');
  let prefixLen = expP.length / 2;
  let suffixLen = expS.length / 2;
  // When framing failed the raw buffer may be shorter than prefix + suffix; never overlap the two ranges.
  if (prefixLen + suffixLen > totalLength) {
    prefixLen = Math.min(prefixLen, totalLength);
    suffixLen = Math.max(0, totalLength - prefixLen);
  }
  return {
    prefixLen,
    suffixLen,
    prefixOk: expP ? framing.prefixOk !== false : null,
    suffixOk: expS ? framing.suffixOk !== false : null,
  };
}

function legendItem(cls, label, title) {
  return el('span', { class: 'hx-legend-item', title }, el('span', { class: `hx-swatch ${cls}` }), ' ', label);
}

/**
 * renderHexView(hex, framing, { bytesPerLine = 16, maxBytes = 65536, title })
 * Renders offset | hex | ascii columns. Prefix bytes are green when ok, red when mismatched; same for suffix.
 */
export function renderHexView(hex, framing = null, opts = {}) {
  const bytesPerLine = opts.bytesPerLine || 16;
  const maxBytes = Number.isFinite(opts.maxBytes) ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const all = hexToBytes(hex);
  const total = all.length;
  const shown = total > maxBytes ? all.subarray(0, maxBytes) : all;
  const fl = framingLengths(framing, total);
  const root = el('div', { class: 'hexview' });

  if (!total) {
    root.append(el('div', { class: 'hx-empty' }, 'Brak bajtów do wyświetlenia.'));
    return root;
  }

  // Legend / framing summary
  const legend = el('div', { class: 'hx-legend' });
  if (fl.prefixLen > 0 || (framing && framing.prefixHexExpected !== undefined)) {
    const ok = fl.prefixOk;
    legend.append(legendItem(
      `prefix ${ok === false ? 'bad' : 'ok'}`,
      ok === false
        ? `Prefix: oczekiwano ${hexOrNone(framing.prefixHexExpected)}, otrzymano ${hexOrNone(framing.prefixHexActual)}`
        : `Prefix ${hexOrNone(framing && framing.prefixHexExpected)}`,
      'Bajty prefiksu MLLP (początek ramki)',
    ));
  }
  if (fl.suffixLen > 0 || (framing && framing.suffixHexExpected !== undefined)) {
    const ok = fl.suffixOk;
    legend.append(legendItem(
      `suffix ${ok === false ? 'bad' : 'ok'}`,
      ok === false
        ? `Suffix: oczekiwano ${hexOrNone(framing.suffixHexExpected)}, otrzymano ${hexOrNone(framing.suffixHexActual)}`
        : `Suffix ${hexOrNone(framing && framing.suffixHexExpected)}`,
      'Bajty sufiksu MLLP (koniec ramki)',
    ));
  }
  legend.append(legendItem('ctrl', 'znak sterujący', 'Bajty 0x00-0x1F i 0x7F'));
  legend.append(legendItem('nonascii', 'poza ASCII', 'Bajty >= 0x80 (znaki narodowe, zależne od kodowania)'));
  legend.append(el('span', { class: 'hx-legend-total' }, `${total} B`));
  root.append(legend);

  const dump = hexdump(shown, {
    bytesPerLine,
    prefixLen: fl.prefixLen,
    // suffix is at the very end of the full buffer; when truncated it is not visible
    suffixLen: shown.length === total ? fl.suffixLen : 0,
  });

  const body = el('div', { class: 'hx-body' });
  const half = Math.floor(bytesPerLine / 2);
  for (const line of dump.lines) {
    const lineEl = el('div', { class: 'hx-line' });
    lineEl.append(el('span', { class: 'hx-off' }, line.offset.toString(16).toUpperCase().padStart(8, '0')));
    const hexCol = el('span', { class: 'hx-bytes' });
    const asciiCol = el('span', { class: 'hx-ascii' });
    line.bytes.forEach((b, i) => {
      let cls = `hx-b ${b.cls}`;
      if (b.cls === 'prefix') cls += fl.prefixOk === false ? ' bad' : ' ok';
      if (b.cls === 'suffix') cls += fl.suffixOk === false ? ' bad' : ' ok';
      const code = shown[b.offset];
      const title = `offset ${b.offset} (0x${b.offset.toString(16).toUpperCase()}): ${b.cls === 'ctrl' || code < 0x20 || code === 0x7f ? controlName(code) : `0x${b.hex}`}`;
      hexCol.append(el('span', { class: cls, 'data-o': b.offset, title }, b.hex));
      if (i < line.bytes.length - 1) hexCol.append(i === half - 1 ? '  ' : ' ');
      asciiCol.append(el('span', { class: cls, 'data-o': b.offset, title }, b.ascii));
    });
    // pad the last line so the ascii column stays aligned
    const missing = bytesPerLine - line.bytes.length;
    if (missing > 0) {
      let pad = '';
      for (let i = 0; i < missing; i++) pad += '   ';
      if (line.bytes.length <= half) pad += ' ';
      hexCol.append(pad);
    }
    lineEl.append(hexCol, el('span', { class: 'hx-gap' }, ' '), asciiCol);
    body.append(lineEl);
  }
  root.append(body);

  if (shown.length < total) {
    root.append(el('div', { class: 'hx-truncated' }, `Pokazano pierwsze ${shown.length} z ${total} bajtów.`));
  }

  // Hover: highlight the same byte in the hex and ascii columns.
  let lit = [];
  body.addEventListener('mouseover', (e) => {
    const target = e.target.closest ? e.target.closest('[data-o]') : null;
    if (!target) return;
    for (const n of lit) n.classList.remove('hl');
    lit = Array.from(body.querySelectorAll(`[data-o="${target.dataset.o}"]`));
    for (const n of lit) n.classList.add('hl');
  });
  body.addEventListener('mouseleave', () => {
    for (const n of lit) n.classList.remove('hl');
    lit = [];
  });

  return root;
}

/** Plain text hexdump (for copy to clipboard). */
export function hexdumpText(hex, bytesPerLine = 16) {
  const bytes = hexToBytes(hex);
  const dump = hexdump(bytes, { bytesPerLine });
  const out = [];
  for (const line of dump.lines) {
    const hexPart = line.bytes.map((b) => b.hex).join(' ').padEnd(bytesPerLine * 3 - 1, ' ');
    const ascii = line.bytes.map((b) => b.ascii).join('');
    out.push(`${line.offset.toString(16).toUpperCase().padStart(8, '0')}  ${hexPart}  ${ascii}`);
  }
  return out.join('\n');
}

export { spacedHex };
