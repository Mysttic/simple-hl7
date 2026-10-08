// Message / event inspector: header summary, framing badges, type-specific details and the tabs
// Czytelny / Drzewo / Hex. Also exports renderTimingsBar() reused by the sender panel.

import { parseMessage } from '/lib/parser.js';
import { fieldName, segmentName, MESSAGE_TYPES } from '/lib/dictionary.js';
import { renderHl7, renderLegend } from './highlight.js';
import { renderHexView } from './hexview.js';
import {
  el, clear, badge, kv, formatDateTime, formatMs, formatBytes, latencyClass, summaryPl, typeLabel, typeClass,
  isMessageEvent, hexOrNone, spacedHex, messageTypeOf, controlGlyph, controlName, safeJson, stringify,
  encodingFromMsh18, ENCODING_LABELS, ACK_CODE_LABELS, statusLabel, phaseLabel, levelLabel, reasonLabel, DATA_LABELS, messagePl, variantPl, separatorPl, inputEl, selectEl,
  checkboxEl, formField,
} from './format.js';

const TABS = [
  { id: 'readable', label: 'Czytelny', needs: 'text', title: 'Segmenty z kolorowaniem składni' },
  { id: 'tree', label: 'Drzewo', needs: 'text', title: 'Segmenty, pola, komponenty z nazwami ze słownika' },
  { id: 'hex', label: 'Hex', needs: 'hex', title: 'Zrzut bajtów ramki z zaznaczonym prefiksem i sufiksem' },
];

const MAX_TEXT_CHARS = 300000;

function numOrNull(v) {
  return Number.isFinite(v) ? v : null;
}

/** Horizontal bar: connect / send / first byte / rest of ACK, scaled to the total, with ms labels. */
export function renderTimingsBar(timing, settings) {
  const t = timing || {};
  const c = numOrNull(t.connectMs);
  const s = numOrNull(t.sendMs);
  const fb = numOrNull(t.firstByteMs);
  const a = numOrNull(t.ackMs);
  const rest = a !== null ? (fb !== null ? Math.max(0, a - fb) : a) : null;
  const segs = [
    { key: 'connect', label: 'Połączenie', ms: c, hint: 'start -> połączono (TCP)' },
    { key: 'send', label: 'Wysyłka', ms: s, hint: 'połączono -> bufor wysłany' },
    { key: 'firstbyte', label: 'Pierwszy bajt', ms: fb, hint: 'wysłano -> pierwszy bajt odpowiedzi' },
    { key: 'ack', label: 'Reszta ACK', ms: rest, hint: 'pierwszy bajt -> kompletna ramka ACK' },
  ].filter((x) => x.ms !== null);
  const wrap = el('div', { class: 'timings' });
  if (!segs.length) {
    wrap.append(el('div', { class: 'dim' }, 'Brak danych o czasach.'));
    return wrap;
  }
  const sum = segs.reduce((acc, x) => acc + x.ms, 0);
  const total = sum > 0 ? sum : 1;
  const bar = el('div', { class: 'tbar', title: `Razem ${formatMs(numOrNull(t.totalMs) ?? sum)}` });
  for (const x of segs) {
    const share = x.ms / total;
    bar.append(el('div', {
      class: `tbar-seg tbar-${x.key}`,
      style: { flexGrow: String(Math.max(x.ms, total * 0.008)) },
      title: `${x.label}: ${formatMs(x.ms)} (${x.hint})`,
    }, share > 0.14 ? formatMs(x.ms) : ''));
  }
  const legend = el('div', { class: 'tbar-legend' });
  for (const x of segs) {
    legend.append(el('span', { class: `tbar-item tbar-${x.key}`, title: x.hint }, el('span', { class: 'tbar-swatch' }), `${x.label} ${formatMs(x.ms)}`));
  }
  legend.append(el('span', { class: 'tbar-item tbar-total' }, `Razem ${formatMs(numOrNull(t.totalMs) ?? sum)}`));
  if (a !== null) legend.append(badge(`ACK ${formatMs(a)}`, `lat ${latencyClass(a, settings)}`, 'Czas odpowiedzi: wysłano -> kompletny ACK'));
  wrap.append(bar, legend);
  return wrap;
}

/** Framing badges: prefix / suffix ok or mismatch, segment separator, trailing CR, non-ASCII, control chars, variant, encoding hint. */
export function renderFramingBadges(framing, opts = {}) {
  const wrap = el('div', { class: 'insp-badges' });
  if (!framing || typeof framing !== 'object') return wrap;
  const pExp = framing.prefixHexExpected || '';
  const pAct = framing.prefixHexActual || '';
  const sExp = framing.suffixHexExpected || '';
  const sAct = framing.suffixHexActual || '';

  if (framing.prefixOk !== false) {
    wrap.append(badge(`Prefix OK ${pExp ? spacedHex(pExp) : '(brak)'}`, 'fr ok',
      pExp ? `Oczekiwany prefix ${spacedHex(pExp)} obecny na początku ramki` : `Nie oczekiwano prefiksu; pierwszy bajt: ${hexOrNone(pAct)}`));
  } else {
    wrap.append(badge(`Prefix: oczekiwano ${hexOrNone(pExp)}, otrzymano ${hexOrNone(pAct)}`, 'fr bad', 'Niezgodny prefix ramki MLLP'));
  }
  if (framing.suffixOk !== false) {
    wrap.append(badge(`Suffix OK ${sExp ? spacedHex(sExp) : '(brak)'}`, 'fr ok',
      sExp ? `Oczekiwany suffix ${spacedHex(sExp)} obecny na końcu ramki` : `Nie oczekiwano sufiksu; ostatni bajt: ${hexOrNone(sAct)}`));
  } else {
    wrap.append(badge(`Suffix: oczekiwano ${hexOrNone(sExp)}, otrzymano ${hexOrNone(sAct)}`, 'fr bad', 'Niezgodny suffix ramki MLLP'));
  }
  const sep = framing.segmentSeparator;
  if (sep) {
    const sepTitle = {
      CR: 'Segmenty rozdzielone CR (0D), zgodnie z HL7',
      LF: 'Segmenty rozdzielone LF (0A) zamiast CR',
      CRLF: 'Segmenty rozdzielone CRLF (0D 0A) zamiast CR',
      mixed: 'Mieszane separatory segmentów',
      none: 'Brak separatorów segmentów (jeden segment lub pusty payload)',
    }[sep] || 'Separator segmentów';
    wrap.append(badge(`Separator ${separatorPl(sep)}`, `fr ${sep === 'CR' ? 'ok' : sep === 'none' ? 'dim' : 'warn'}`, sepTitle));
  }
  if (framing.trailingSeparator === true) wrap.append(badge('Końcowy CR OK', 'fr ok', 'Payload kończy się separatorem segmentu przed sufiksem (zgodnie z MLLP)'));
  else if (framing.trailingSeparator === false) wrap.append(badge('Brak końcowego CR', 'fr warn', 'MLLP oczekuje CR po ostatnim segmencie, przed sufiksem'));
  if (Number.isFinite(framing.nonAsciiCount) && framing.nonAsciiCount > 0) {
    wrap.append(badge(`Non-ASCII: ${framing.nonAsciiCount}`, 'fr info', 'Liczba bajtów >= 0x80 (znaki narodowe, interpretacja zależy od kodowania)'));
  }
  if (Array.isArray(framing.controlChars) && framing.controlChars.length) {
    wrap.append(badge(`Znaki sterujące: ${framing.controlChars.length}`, 'fr warn',
      framing.controlChars.map((c) => `offset ${c.offset}: ${c.hex}`).join(', ')));
  }
  if (framing.knownVariant) wrap.append(badge(`Wariant: ${variantPl(framing.knownVariant)}`, 'fr dim', 'Rozpoznany wariant ramkowania'));
  const declared = encodingFromMsh18(opts.characterSet);
  if (opts.characterSet && declared && opts.encoding && declared !== opts.encoding) {
    wrap.append(badge(`Kodowanie: MSH-18 ${opts.characterSet} vs ${opts.encoding}`, 'fr warn',
      `Wiadomość deklaruje ${opts.characterSet} (${declared}), a zdekodowano jako ${opts.encoding}`));
  } else if (opts.characterSet && !declared) {
    wrap.append(badge(`MSH-18: ${opts.characterSet}`, 'fr dim', 'Nieznana wartość MSH-18, nie zweryfikowano kodowania'));
  }
  return wrap;
}

/** Assertions table (nazwa, oczekiwano, otrzymano, wynik) shared with the scenarios panel. */
export function renderAssertions(assertions) {
  if (!Array.isArray(assertions) || !assertions.length) return el('div', { class: 'dim' }, 'Brak asercji.');
  const table = el('table', { class: 'assert-table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Nazwa'), el('th', {}, 'Oczekiwano'), el('th', {}, 'Otrzymano'), el('th', {}, 'Wynik'))));
  const tbody = el('tbody');
  for (const a of assertions) {
    const ok = !!(a && a.ok);
    tbody.append(el('tr', { class: ok ? 'ok' : 'bad' },
      el('td', {}, String((a && a.name) ?? '')),
      el('td', { class: 'mono' }, stringify(a ? a.expected : undefined)),
      el('td', { class: 'mono' }, stringify(a ? a.actual : undefined)),
      el('td', {}, badge(ok ? 'OK' : 'BŁĄD', ok ? 'ok' : 'bad'))));
  }
  table.append(tbody);
  return table;
}


function valueWithGlyphs(value) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  if (!/[\u0000-\u001f\u007f]/.test(s)) return s;
  const frag = document.createDocumentFragment();
  const re = /[\u0000-\u001f\u007f]/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) frag.append(s.slice(last, m.index));
    const code = m[0].charCodeAt(0);
    frag.append(el('span', { class: 'tk-ctrl', title: controlName(code) }, controlGlyph(code)));
    last = re.lastIndex;
  }
  if (last < s.length) frag.append(s.slice(last));
  return frag;
}

export function createInspector({ root, ctx }) {
  let current = null;
  let activeTab = 'readable';
  let showEmptyFields = false;

  const header = el('div', { class: 'insp-header' });
  const tabsBar = el('div', { class: 'insp-tabs', role: 'tablist' });
  const content = el('div', { class: 'insp-content' });
  const empty = el('div', { class: 'insp-empty' },
    el('div', { class: 'insp-empty-icon' }, '⌕'),
    el('div', {}, 'Wybierz zdarzenie na osi czasu, aby zobaczyć szczegóły.'),
    el('div', { class: 'dim' }, 'Strzałki góra / dół zmieniają zaznaczenie.'));
  root.append(header, tabsBar, content, empty);
  header.hidden = true;
  tabsBar.hidden = true;
  content.hidden = true;

  // ---- data accessors -----------------------------------------------------------

  function textOf(ev) {
    if (!ev || !ev.data) return null;
    if (isMessageEvent(ev)) return ev.data.text;
    if ((ev.type === 'frame.garbage' || ev.type === 'frame.incomplete') && typeof ev.data.text === 'string') return ev.data.text;
    return null;
  }

  function hexOf(ev) {
    if (!ev || !ev.data) return null;
    const d = ev.data;
    if (isMessageEvent(ev)) return d.raw && d.raw.hex ? d.raw.hex : null;
    if (ev.type === 'frame.garbage' || ev.type === 'frame.incomplete') return d.hex || null;
    if (ev.type === 'ack.timeout') return d.partialHex || null;
    if (ev.type === 'bytes.in' || ev.type === 'bytes.out') return d.previewHex || null;
    return null;
  }

  function framingOf(ev) {
    if (!ev || !ev.data) return null;
    return ev.data.framing && typeof ev.data.framing === 'object' ? ev.data.framing : null;
  }

  function hexNote(ev) {
    if (!ev) return null;
    if (ev.type === 'bytes.in' || ev.type === 'bytes.out') return `Podgląd: pierwsze bajty z ${formatBytes(ev.data && ev.data.length)} (pełne dane tylko w zdarzeniu msg.*).`;
    if (ev.type === 'ack.timeout') return 'Bajty odebrane przed upływem timeoutu (bez kompletnej ramki ACK).';
    if (ev.type === 'frame.garbage') return 'Bajty, które przyszły od bramki, gdy nie czekaliśmy na żadną odpowiedź.';
    if (ev.type === 'frame.incomplete') return 'Bajty, które czekały na sufiks; zgłoszone po zamknięciu połączenia, po timeoucie ramki albo po bezczynności.';
    return null;
  }

  function btn(label, onClick, title = null, cls = 'btn btn-sm') {
    return el('button', { class: cls, type: 'button', title, onClick }, label);
  }

  // ---- header ----------------------------------------------------------------------

  function renderPairLink(ev) {
    const pair = ctx.getPair(ev.id);
    if (pair) {
      const lat = Number.isFinite(pair.latencyMs) ? ` (${formatMs(pair.latencyMs)})` : pair.type === 'ack.timeout' ? ' (timeout)' : '';
      return el('div', { class: 'insp-pair' },
        el('span', { class: 'dim' }, pair.type.startsWith('msg.') ? 'W odpowiedzi na: ' : 'Odpowiedź: '),
        el('a', { href: '#', class: 'link', onClick: (e) => { e.preventDefault(); ctx.selectEvent(pair.id); } },
          badge(pair.type, typeClass(pair.type)), ` #${pair.id}${lat}`));
    }
    if (ev.type === 'msg.in' || ev.type === 'msg.out') {
      return el('div', { class: 'insp-pair dim' }, ev.type === 'msg.in' ? 'Brak powiązanego ACK wychodzącego.' : 'Brak powiązanego ACK przychodzącego (jeszcze lub timeout bez identyfikatora).');
    }
    return null;
  }

  function renderMessageHeader(ev) {
    const d = ev.data;
    const s = d.summary;
    const grid = el('div', { class: 'insp-grid' });
    if (s) {
      const type = messageTypeOf(s);
      const desc = (type && MESSAGE_TYPES && MESSAGE_TYPES[type]) || s.description || '';
      grid.append(kv('Typ (MSH-9)', [
        el('b', { class: 'mono' }, type || '?'),
        desc ? el('span', { class: 'dim' }, ` ${desc}`) : null,
        s.messageStructure && s.messageStructure !== type ? el('span', { class: 'dim mono' }, ` [${s.messageStructure}]`) : null,
      ]));
      grid.append(kv('Control ID (MSH-10)', s.controlId || '(brak)', { mono: true }));
      grid.append(kv('Nadawca (MSH-3 / MSH-4)', `${s.sendingApplication || '?'} / ${s.sendingFacility || '?'}`, { mono: true }));
      grid.append(kv('Odbiorca (MSH-5 / MSH-6)', `${s.receivingApplication || '?'} / ${s.receivingFacility || '?'}`, { mono: true }));
      grid.append(kv('Wersja / tryb (MSH-12 / MSH-11)', `${s.version || '?'} / ${s.processingId || '?'}`, { mono: true }));
      grid.append(kv('Czas wiadomości (MSH-7)', s.timestamp || '(brak)', { mono: true }));
      grid.append(kv('Kodowanie', [
        el('span', { class: 'mono' }, d.encoding || '?'),
        ENCODING_LABELS[d.encoding] ? el('span', { class: 'dim' }, ` ${ENCODING_LABELS[d.encoding]}`) : null,
        el('span', { class: 'dim' }, s.characterSet ? `, MSH-18: ${s.characterSet}` : ', MSH-18 puste'),
      ]));
      grid.append(kv('Segmenty', `${(s.segmentNames || []).join(' ')} (${s.segmentCount ?? (s.segmentNames || []).length})`, { mono: true }));
    } else {
      grid.append(kv('Parsowanie', el('span', { class: 'text-error' }, `nie powiodło się: ${d.parseError || 'nieznany błąd'}`)));
      grid.append(kv('Kodowanie', d.encoding || '?', { mono: true }));
    }
    grid.append(kv('Rozmiar', `${formatBytes(d.raw && d.raw.length)} (ramka z prefiksem i sufiksem), ${(d.text || '').length} znaków`));

    const parts = [grid, renderFramingBadges(d.framing, { encoding: d.encoding, characterSet: s && s.characterSet })];
    const warnings = []
      .concat(Array.isArray(d.framing && d.framing.warnings) ? d.framing.warnings : [])
      .concat(Array.isArray(d.encodingWarnings) ? d.encodingWarnings : [])
      .concat(Array.isArray(d.warnings) ? d.warnings : []);
    if (warnings.length) parts.push(el('ul', { class: 'insp-warnings' }, ...warnings.map((w) => el('li', {}, messagePl(w)))));
    const pair = renderPairLink(ev);
    if (pair) parts.push(pair);
    const specific = renderTypeSpecific(ev);
    if (specific) parts.push(specific);
    return el('div', { class: 'insp-message' }, ...parts);
  }

  function renderAckValidation(v) {
    const wrap = el('div', { class: 'insp-section' }, el('h4', {}, 'Walidacja ACK'));
    if (!v) {
      wrap.append(el('div', { class: 'dim' }, 'Brak danych walidacji.'));
      return wrap;
    }
    const grid = el('div', { class: 'insp-grid' });
    const code = v.msa1 || '?';
    grid.append(kv('MSA-1', [badge(code, v.accepted ? 'ok' : 'bad'), el('span', { class: 'dim' }, ` ${ACK_CODE_LABELS[code] || 'nieznany kod'}`)]));
    grid.append(kv('MSA-2 vs wysłany MSH-10', [el('span', { class: 'mono' }, v.msa2 || '(brak)'), ' ', badge(v.controlIdMatches ? 'zgodny' : 'NIEZGODNY', v.controlIdMatches ? 'ok' : 'bad')]));
    grid.append(kv('MSA-3 (tekst)', v.msa3 || '(brak)', { mono: true }));
    grid.append(kv('Ramkowanie ACK', badge(v.framingOk ? 'OK' : 'BŁĄD', v.framingOk ? 'ok' : 'bad')));
    wrap.append(grid);
    if (Array.isArray(v.problems) && v.problems.length) {
      wrap.append(el('ul', { class: 'insp-problems' }, ...v.problems.map((p) => el('li', {}, messagePl(p)))));
    } else {
      wrap.append(el('div', { class: 'text-ok' }, 'Brak problemów z ACK.'));
    }
    return wrap;
  }

  function renderTypeSpecific(ev) {
    const d = ev.data || {};
    switch (ev.type) {
      case 'ack.in':
        return el('div', {}, renderAckValidation(d.validation),
          el('div', { class: 'insp-section' }, el('h4', {}, 'Czasy'), renderTimingsBar(d.timing, ctx.settings), renderTimingTable(d.timing)));
      case 'ack.out':
        return el('div', { class: 'insp-section' }, el('h4', {}, 'Szczegóły ACK'), el('div', { class: 'insp-grid' },
          kv('Tryb ACK', d.mode || '?', { mono: true }),
          kv('Opóźnienie skonfigurowane', formatMs(d.delayMs || 0)),
          kv('Czas przetwarzania', badge(formatMs(d.processingMs), `lat ${latencyClass(d.processingMs, ctx.settings)}`, 'Od kompletnej ramki wejściowej do zapisania ACK do gniazda')),
          kv('W odpowiedzi na (MSA-2)', d.inReplyTo || '(brak)', { mono: true })));
      case 'msg.in': {
        const t = d.timing || {};
        return el('div', { class: 'insp-section' }, el('h4', {}, 'Odbiór'), el('div', { class: 'insp-grid' },
          kv('Czas odbioru ramki', badge(formatMs(t.receiveMs ?? ev.latencyMs), `lat ${latencyClass(t.receiveMs ?? ev.latencyMs, ctx.settings)}`, 'Od pierwszego bajtu do kompletnej ramki')),
          kv('Pierwszy bajt', t.firstByteTs ? formatDateTime(t.firstByteTs, ctx.settings.utc) : '?', { mono: true, title: t.firstByteTs || null }),
          kv('Ostatni bajt', t.lastByteTs ? formatDateTime(t.lastByteTs, ctx.settings.utc) : '?', { mono: true, title: t.lastByteTs || null }),
          kv('Bajty', formatBytes(t.bytes ?? (d.raw && d.raw.length)))));
      }
      case 'msg.out':
        return el('div', { class: 'insp-section' }, el('h4', {}, 'Wysyłka'), el('div', { class: 'insp-grid' },
          kv('Próba', String(d.attempt ?? 1)),
          kv('Numer powtórzenia', String((d.repeatIndex ?? 0) + 1))));
      default:
        return null;
    }
  }

  function renderTimingTable(t) {
    const rows = [
      ['tsStart', 'Start'], ['tsConnected', 'Połączono'], ['tsSent', 'Wysłano'], ['tsFirstByte', 'Pierwszy bajt'], ['tsAck', 'ACK kompletny'],
    ];
    const table = el('table', { class: 'kv-table' });
    const tt = t || {};
    let any = false;
    for (const [key, label] of rows) {
      if (!tt[key]) continue;
      any = true;
      table.append(el('tr', {}, el('td', { class: 'dim' }, label), el('td', { class: 'mono', title: tt[key] }, formatDateTime(tt[key], ctx.settings.utc))));
    }
    const msRows = [['connectMs', 'connectMs'], ['sendMs', 'sendMs'], ['firstByteMs', 'firstByteMs'], ['ackMs', 'ackMs'], ['totalMs', 'totalMs']];
    for (const [key, label] of msRows) {
      if (!Number.isFinite(tt[key])) continue;
      any = true;
      table.append(el('tr', {}, el('td', { class: 'dim mono' }, label), el('td', { class: 'mono' }, `${tt[key].toFixed(3)} ms`)));
    }
    return any ? table : el('div', { class: 'dim' }, 'Brak znaczników czasu.');
  }

  function formatDataValue(key, value) {
    if (value === null || value === undefined) return el('span', { class: 'dim' }, 'null');
    if (typeof value === 'boolean') return badge(value ? 'tak' : 'nie', value ? 'ok' : 'dim');
    if (typeof value === 'number') {
      if (/Ms$/.test(key)) return formatMs(value);
      if (/^(bytes|length|bytesIn|bytesOut|partialLength|totalBytesOnConn|garbageBytes)$/i.test(key)) return `${formatBytes(value)} (${value})`;
      return String(value);
    }
    if (typeof value === 'string') {
      if (/hex$/i.test(key)) {
        const sp = spacedHex(value);
        return el('span', { class: 'mono', title: sp.length > 200 ? sp : null }, sp.length > 200 ? `${sp.slice(0, 200)} ...` : (sp || '(puste)'));
      }
      if (/Ts$/.test(key) || /^ts$/.test(key)) return el('span', { class: 'mono', title: value }, formatDateTime(value, ctx.settings.utc));
      if (key === 'reason') return ({ close: 'zamknięcie połączenia', idle: 'bezczynność', timeout: 'timeout', 'mode none': 'tryb ACK: none' })[value] || value;
      if (key === 'phase') return phaseLabel(value);
      if (key === 'status') return badge(statusLabel(value), value === 'passed' ? 'ok' : value === 'skipped' ? 'dim' : 'bad');
      return el('span', { class: 'mono wrap' }, value.length > 500 ? `${value.slice(0, 500)} ...` : value);
    }
    if (Array.isArray(value)) return el('span', { class: 'mono wrap' }, value.length ? stringify(value).slice(0, 500) : '[]');
    if (typeof value === 'object') {
      const s = stringify(value);
      return el('span', { class: 'mono wrap', title: s.length > 300 ? s.slice(0, 2000) : null }, s.length > 300 ? `${s.slice(0, 300)} ...` : s);
    }
    return String(value);
  }

  function renderGenericDetails(ev) {
    const d = ev.data && typeof ev.data === 'object' ? ev.data : {};
    const wrap = el('div', { class: 'insp-generic' });
    const grid = el('div', { class: 'insp-grid' });
    const skip = new Set(['framing', 'assertions', 'hex', 'partialHex', 'previewHex', 'text']);
    for (const [key, value] of Object.entries(d)) {
      if (skip.has(key)) continue;
      if (key === 'ack' && value && typeof value === 'object') {
        grid.append(kv('ACK', `${value.mode || 'AA'}${value.delayMs ? `, opóźnienie ${formatMs(value.delayMs)}` : ''}${value.template ? ', własny szablon' : ''}`, { mono: true }));
        continue;
      }
      if (key === 'web' && value && typeof value === 'object') {
        grid.append(kv('Serwer WWW', `${value.host}:${value.port}`, { mono: true }));
        continue;
      }
      if (value === '' || value === null || value === undefined) continue;
      const label = DATA_LABELS[key] || key;
      if (key === 'stepIndex' && Number.isFinite(value)) {
        grid.append(kv(label, String(value + 1)));
        continue;
      }
      if (key === 'reason') {
        grid.append(kv(label, reasonLabel(value)));
        continue;
      }
      if (key === 'phase') {
        grid.append(kv(label, phaseLabel(value)));
        continue;
      }
      grid.append(kv(label, formatDataValue(key, value), { mono: typeof value === 'string' && !/Ts$/.test(key) }));
    }
    if (Number.isFinite(ev.latencyMs)) {
      grid.append(kv('Czas odpowiedzi', badge(formatMs(ev.latencyMs), `lat ${latencyClass(ev.latencyMs, ctx.settings)}`)));
    }
    wrap.append(grid);
    if (d.framing) wrap.append(renderFramingBadges(d.framing));
    if (Array.isArray(d.framing && d.framing.warnings) && d.framing.warnings.length) {
      wrap.append(el('ul', { class: 'insp-warnings' }, ...d.framing.warnings.map((w) => el('li', {}, messagePl(w)))));
    }
    if (Array.isArray(d.assertions)) wrap.append(el('div', { class: 'insp-section' }, el('h4', {}, 'Asercje'), renderAssertions(d.assertions)));
    const note = hexNote(ev);
    if (note && hexOf(ev)) wrap.append(el('div', { class: 'dim small' }, note));
    const pair = renderPairLink(ev);
    if (pair && ev.type !== 'msg.in' && ev.type !== 'msg.out') wrap.append(pair);
    return wrap;
  }

  function renderActions(ev) {
    const bar = el('div', { class: 'insp-actions' });
    const text = textOf(ev);
    const hex = hexOf(ev);
    if (text) bar.append(btn('Kopiuj tekst', () => ctx.copy(text, 'Tekst HL7'), 'Skopiuj treść HL7 do schowka (separatory segmentów jak w zdarzeniu)'));
    if (hex) bar.append(btn('Kopiuj hex', () => ctx.copy(spacedHex(hex), 'Hex'), 'Skopiuj bajty ramki jako hex'));
    if (text && isMessageEvent(ev)) bar.append(btn('Wyślij ponownie', () => ctx.resend(text, ev), 'Załaduj tę wiadomość do formularza nadawcy', 'btn btn-sm btn-primary'));
    if (ev.type === 'msg.in' && text) bar.append(btn('Podgląd ACK', () => openAckPreview(ev), 'Wygeneruj ACK dla tej wiadomości (bez wysyłania)'));
    bar.append(btn('Kopiuj JSON', () => ctx.copy(safeJson(ev), 'JSON zdarzenia'), 'Skopiuj pełne zdarzenie jako JSON'));
    return bar;
  }

  function renderHeader(ev) {
    clear(header);
    const utc = ctx.settings.utc;
    const title = el('div', { class: 'insp-title' },
      badge(ev.type, typeClass(ev.type), typeLabel(ev.type)),
      el('span', { class: 'insp-title-text' }, typeLabel(ev.type)),
      el('span', { class: 'insp-id mono dim', title: 'Identyfikator zdarzenia' }, `#${ev.id}`),
      ev.level && ev.level !== 'info' ? badge(levelLabel(ev.level), `lvl-badge lvl-${ev.level}`) : null,
    );
    const meta = el('div', { class: 'insp-meta mono' },
      el('span', { title: `${ev.ts} (mono ${Number.isFinite(ev.mono) ? ev.mono.toFixed(3) : '?'} ms)` }, formatDateTime(ev.ts, utc)),
      el('span', { class: 'sep' }, '·'),
      el('span', { title: 'Źródło: punkt końcowy' }, `${ev.source || '?'}: ${ev.endpointId || '?'}`),
      ev.connId ? [el('span', { class: 'sep' }, '·'), el('span', { title: 'Identyfikator połączenia TCP' }, ev.connId)] : null,
      ev.direction ? [el('span', { class: 'sep' }, '·'), el('span', { class: `dir-${ev.direction}` }, ev.direction === 'in' ? '← przychodzące' : '→ wychodzące')] : null,
    );
    header.append(title, meta, el('div', { class: 'insp-summary' }, summaryPl(ev)));
    header.append(isMessageEvent(ev) ? renderMessageHeader(ev) : renderGenericDetails(ev));
    header.append(renderActions(ev));
  }

  // ---- tabs --------------------------------------------------------------------------

  function availableTabs(ev) {
    const hasText = !!textOf(ev);
    const hasHex = !!hexOf(ev);
    return TABS.filter((t) => !t.needs || (t.needs === 'text' ? hasText : hasHex));
  }

  function renderTabs(ev) {
    clear(tabsBar);
    const tabs = availableTabs(ev);
    // events without message text or bytes (connections, timeouts) have no tabs: header only
    tabsBar.hidden = tabs.length === 0;
    if (!tabs.length) return;
    if (!tabs.some((t) => t.id === activeTab)) activeTab = tabs[0].id;
    for (const t of tabs) {
      tabsBar.append(el('button', {
        class: `tab ${t.id === activeTab ? 'active' : ''}`.trim(),
        type: 'button',
        role: 'tab',
        'aria-selected': String(t.id === activeTab),
        title: t.title,
        onClick: () => {
          activeTab = t.id;
          renderTabs(ev);
          renderContent(ev);
        },
      }, t.label));
    }
  }

  function renderTree(text) {
    let msg;
    try {
      msg = parseMessage(text);
    } catch (err) {
      return el('div', { class: 'insp-error' }, `Nie udało się sparsować wiadomości: ${err && err.message ? err.message : err}`);
    }
    const segments = Array.isArray(msg && msg.segments) ? msg.segments : [];
    const wrap = el('div', { class: 'tree' });
    const cb = checkboxEl(showEmptyFields);
    cb.addEventListener('change', () => {
      showEmptyFields = cb.checked;
      renderContent(current);
    });
    const toolbar = el('div', { class: 'tree-toolbar' },
      el('label', { class: 'check-inline' }, cb, ' Pokaż puste pola'),
      el('button', { class: 'btn btn-xs', type: 'button', onClick: () => wrap.querySelectorAll('details').forEach((d) => { d.open = true; }) }, 'Rozwiń'),
      el('button', { class: 'btn btn-xs', type: 'button', onClick: () => wrap.querySelectorAll('details').forEach((d) => { d.open = false; }) }, 'Zwiń'),
      el('span', { class: 'dim mono' }, `${segments.length} segmentów`),
    );
    wrap.append(toolbar);
    if (Array.isArray(msg.warnings) && msg.warnings.length) {
      wrap.append(el('ul', { class: 'insp-warnings' }, ...msg.warnings.map((w) => el('li', {}, messagePl(w)))));
    }
    const totals = new Map();
    for (const seg of segments) totals.set(seg.name, (totals.get(seg.name) || 0) + 1);
    const occ = new Map();
    for (const seg of segments) {
      const name = seg.name || '???';
      const n = (occ.get(name) || 0) + 1;
      occ.set(name, n);
      const prefix = (totals.get(seg.name) || 1) > 1 ? `${name}[${n}]` : name;
      const fields = Array.isArray(seg.fields) ? seg.fields : [];
      const det = el('details', { open: true, class: 'tree-seg' });
      det.append(el('summary', {},
        el('span', { class: 'tk-segname' }, prefix),
        ' ',
        el('span', { class: 'dim' }, name === '???' ? 'nierozpoznany segment' : segmentName(name)),
        ' ',
        el('span', { class: 'dim mono small' }, `${Math.max(0, fields.length - 1)} pól`)));
      const table = el('table', { class: 'tree-table' });
      for (let i = 1; i < fields.length; i++) {
        const f = fields[i];
        if (!f) continue;
        const value = typeof f.value === 'string' ? f.value : String(f.value ?? '');
        if (!showEmptyFields && value === '') continue;
        const path = `${prefix}-${i}`;
        let fname = '';
        try {
          fname = fieldName(name, i) || '';
        } catch (err) {
          fname = '';
        }
        if (fname === `${name}-${i}`) fname = '';
        table.append(treeRow(path, fname, value, 0, 'field'));
        const reps = Array.isArray(f.repetitions) ? f.repetitions : [];
        if (reps.length > 1) {
          reps.forEach((rep, ri) => {
            const rv = typeof rep.value === 'string' ? rep.value : String(rep.value ?? '');
            if (!showEmptyFields && rv === '') return;
            table.append(treeRow(`${prefix}-${i}(${ri + 1})`, `powtórzenie ${ri + 1}`, rv, 1, 'rep'));
            appendComponents(table, `${prefix}-${i}(${ri + 1})`, rep, 2);
          });
        } else if (reps.length === 1) {
          appendComponents(table, path, reps[0], 1);
        }
      }
      if (!table.children.length) table.append(el('tr', {}, el('td', { class: 'dim', colspan: '3' }, 'Wszystkie pola puste.')));
      det.append(table);
      wrap.append(det);
    }
    if (!segments.length) wrap.append(el('div', { class: 'dim' }, 'Brak segmentów.'));
    return wrap;
  }

  function appendComponents(table, base, rep, depth) {
    const comps = Array.isArray(rep && rep.components) ? rep.components : [];
    const hasSubs = comps.some((c) => Array.isArray(c && c.subcomponents) && c.subcomponents.length > 1);
    if (comps.length <= 1 && !hasSubs) return;
    comps.forEach((comp, ci) => {
      const v = typeof comp.value === 'string' ? comp.value : String((comp && comp.value) ?? '');
      if (!showEmptyFields && v === '') return;
      table.append(treeRow(`${base}.${ci + 1}`, '', v, depth, 'comp'));
      const subs = Array.isArray(comp && comp.subcomponents) ? comp.subcomponents : [];
      if (subs.length > 1) {
        subs.forEach((s, si) => {
          const sv = typeof s === 'string' ? s : String(s ?? '');
          if (!showEmptyFields && sv === '') return;
          table.append(treeRow(`${base}.${ci + 1}.${si + 1}`, '', sv, depth + 1, 'sub'));
        });
      }
    });
  }

  function treeRow(path, name, value, depth, kind) {
    return el('tr', { class: `tree-row tree-${kind}` },
      el('td', { class: 'tree-path mono', style: { paddingLeft: `${8 + depth * 14}px` } }, path),
      el('td', { class: 'tree-name' }, name),
      el('td', { class: 'tree-value mono', title: value.length > 120 ? value : null }, valueWithGlyphs(value)));
  }

  function renderContent(ev) {
    clear(content);
    if (!ev) return;
    const text = textOf(ev);
    const hex = hexOf(ev);
    if (!availableTabs(ev).length) return;
    try {
      switch (activeTab) {
        case 'readable':
          content.append(el('div', { class: 'tab-readable' }, renderLegend(), renderHl7(text, { maxChars: MAX_TEXT_CHARS })));
          break;
        case 'tree':
          content.append(renderTree(text));
          break;
        case 'hex': {
          const note = hexNote(ev);
          content.append(el('div', { class: 'tab-hex' }, note ? el('div', { class: 'dim small' }, note) : null, renderHexView(hex, framingOf(ev))));
          break;
        }
        default:
          break;
      }
    } catch (err) {
      content.append(el('div', { class: 'insp-error' }, `Błąd renderowania zakładki: ${err && err.message ? err.message : err}`));
    }
  }

  // ---- ACK preview modal ---------------------------------------------------------------

  function openAckPreview(ev) {
    const text = textOf(ev);
    if (!text) return;
    const ctrl = ev.data && ev.data.summary && ev.data.summary.controlId ? ev.data.summary.controlId : `#${ev.id}`;
    const codeSel = selectEl(Object.entries(ACK_CODE_LABELS).map(([k, v]) => [k, `${k}: ${v}`]), 'AA');
    const textMsg = inputEl({ placeholder: 'np. Message accepted' });
    const errorCode = inputEl({ placeholder: 'np. 207 (tylko AE / AR)' });
    const template = el('textarea', { rows: '3', spellcheck: 'false', placeholder: 'Pusty = standardowy ACK. Placeholdery: {{controlId}}, {{now}}, {{field:MSH-10}}' });
    const result = el('div', { class: 'ack-preview-result' });
    const body = el('div', { class: 'ack-preview' },
      el('div', { class: 'form-grid cols-3' },
        formField('Kod MSA-1', codeSel),
        formField('Tekst MSA-3', textMsg),
        formField('Kod błędu (segment ERR)', errorCode)),
      formField('Własny szablon ACK (opcjonalnie)', template, 'Te same placeholdery co w szablonie ACK serwera, np. {{field:MSH-10}} wstawia pole z odebranej wiadomości.'),
      result,
    );
    let ackText = '';
    async function generate() {
      clear(result);
      result.append(el('div', { class: 'dim' }, 'Generowanie...'));
      try {
        const res = await ctx.api.ackPreview({
          text,
          code: codeSel.value,
          textMessage: textMsg.value,
          errorCode: errorCode.value.trim() || null,
          template: template.value.trim() || null,
        });
        ackText = res && typeof res.ack === 'string' ? res.ack : '';
        clear(result);
        result.append(renderHl7(ackText));
      } catch (err) {
        clear(result);
        result.append(el('div', { class: 'text-error' }, `Błąd: ${err && err.message ? err.message : err}`));
      }
    }
    codeSel.addEventListener('change', generate);
    ctx.openModal({
      title: `Podgląd ACK dla ${ctrl}`,
      body,
      wide: true,
      actions: [
        { label: 'Generuj', onClick: () => generate(), primary: true },
        { label: 'Kopiuj ACK', onClick: () => ctx.copy(ackText, 'ACK') },
        { label: 'Załaduj do nadawcy', onClick: (close) => { if (ackText) { ctx.resend(ackText); close(); } } },
        { label: 'Zamknij', onClick: (close) => close() },
      ],
    });
    generate();
  }

  // ---- public ------------------------------------------------------------------------------

  function show(ev) {
    if (!ev || typeof ev !== 'object') {
      clearAll();
      return;
    }
    current = ev;
    empty.hidden = true;
    header.hidden = false;
    tabsBar.hidden = false;
    content.hidden = false;
    try {
      renderHeader(ev);
      renderTabs(ev);
      renderContent(ev);
    } catch (err) {
      clear(content);
      content.append(el('div', { class: 'insp-error' }, `Błąd inspektora: ${err && err.message ? err.message : err}`));
    }
    root.scrollTop = 0;
  }

  function clearAll() {
    current = null;
    clear(header);
    clear(tabsBar);
    clear(content);
    header.hidden = true;
    tabsBar.hidden = true;
    content.hidden = true;
    empty.hidden = false;
  }

  function refresh() {
    if (current) show(current);
  }

  return {
    show,
    clear: clearAll,
    refresh,
    current: () => current,
    setTab: (id) => {
      if (TABS.some((t) => t.id === id)) {
        activeTab = id;
        refresh();
      }
    },
  };
}
