// Live event table: filtering, autoscroll with pause, selection, related-row highlighting and
// request -> reply chain markers (msg.in -> ack.out, msg.out -> ack.in / ack.timeout).
// Keeps at most MAX_ROWS events in memory and in the DOM (oldest dropped first).

import {
  el, clear, badge, formatTime, formatDelta, formatMs, formatBytes, latencyClass, summaryPl, typeLabel, typeClass,
  controlIdsOf, bytesOf, directionArrow, connCounter, EVENT_TYPES, debounce,
} from './format.js';

const MAX_ROWS = 2000;
const MAX_OPEN_REQUESTS = 300;
const CHAIN_WALK_LIMIT = 80;
const MAX_RELATED_HIGHLIGHT = 500;

const COLUMNS = [
  { key: 'chain', label: '', width: 16, title: 'Łańcuch wiadomość -> ACK' },
  { key: 'time', label: 'Czas', width: 100, title: 'Czas zdarzenia (pełny ISO po najechaniu)' },
  { key: 'delta', label: 'Δ', width: 78, title: 'Odstęp od poprzedniego widocznego wiersza' },
  { key: 'endpoint', label: 'Punkt', width: 126, title: 'Nasłuch / nadawca / scenariusz i numer połączenia' },
  { key: 'dir', label: '', width: 26, title: 'Kierunek' },
  { key: 'type', label: 'Typ', width: 124, title: 'Typ zdarzenia' },
  { key: 'summary', label: 'Opis', width: null, title: null },
  { key: 'latency', label: 'Czas odp.', width: 88, title: 'Czas odpowiedzi / przetwarzania (ms)' },
  { key: 'bytes', label: 'Bajty', width: 72, title: 'Rozmiar' },
];

const LEVEL_OPTIONS = [['', 'Wszystkie poziomy'], ['info', 'Info'], ['warn', 'Ostrzeżenia'], ['error', 'Błędy']];

function pluralNowe(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return 'nowe';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'nowe';
  return 'nowych';
}

export function createTimeline({ root, filtersRoot, ctx }) {
  const events = [];
  const byId = new Map();
  const rows = new Map();
  const byConn = new Map();
  const byCtrl = new Map();
  const pairs = new Map();
  const openRequests = [];
  const typeCounts = new Map();
  const endpoints = new Set();
  // scenario events carry the run id as endpointId: run id -> { name, ts } from scenario.start
  const runs = new Map();
  const searchCache = new WeakMap();
  const filters = { types: null, endpoint: '', text: '', level: '' };

  let selectedId = null;
  let pausedManual = false;
  let pausedAuto = false;
  let newSincePause = 0;
  let lastVisible = null;
  let programmaticScrollUntil = 0;
  let hoverTr = null;
  let hoverLit = [];
  let countsScheduled = false;
  let endpointsDirty = true;
  let selectHandler = () => {};
  let countsHandler = () => {};
  let pauseHandler = () => {};

  // ---- DOM --------------------------------------------------------------------

  const scroller = el('div', { class: 'timeline-scroll', tabindex: '0', 'aria-label': 'Oś czasu zdarzeń' });
  const table = el('table', { class: 'timeline' });
  const colgroup = el('colgroup');
  for (const c of COLUMNS) colgroup.append(el('col', { class: `col-${c.key}`, style: c.width ? { width: `${c.width}px` } : null }));
  const thead = el('thead', {}, el('tr', {}, ...COLUMNS.map((c) => el('th', { class: `c-${c.key}`, title: c.title }, c.label))));
  const tbody = el('tbody');
  table.append(colgroup, thead, tbody);
  scroller.append(table);
  const emptyEl = el('div', { class: 'timeline-empty' }, 'Brak zdarzeń. Oczekiwanie na ruch MLLP...');
  const pill = el('button', { class: 'new-pill', type: 'button', hidden: true, title: 'Przewiń do najnowszych zdarzeń (End)' });
  root.append(scroller, emptyEl, pill);

  // ---- indices ------------------------------------------------------------------

  function indexAdd(map, key, id) {
    if (!key) return;
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(id);
  }

  function indexRemove(map, key, id) {
    if (!key) return;
    const set = map.get(key);
    if (!set) return;
    set.delete(id);
    if (!set.size) map.delete(key);
  }

  function registerPair(reqId, replyId) {
    pairs.set(reqId, replyId);
    pairs.set(replyId, reqId);
  }

  function matchReply(ev) {
    let wantType;
    let ctrl;
    const d = ev.data || {};
    switch (ev.type) {
      case 'ack.out':
      case 'ack.skipped':
        wantType = 'msg.in';
        ctrl = d.inReplyTo;
        break;
      case 'ack.in':
        wantType = 'msg.out';
        ctrl = d.validation ? d.validation.msa2 : null;
        break;
      case 'ack.timeout':
        wantType = 'msg.out';
        ctrl = d.controlId;
        break;
      default:
        return null;
    }
    const ctrlStr = ctrl ? String(ctrl) : null;
    let idx = -1;
    if (ctrlStr) {
      for (let i = openRequests.length - 1; i >= 0; i--) {
        const r = openRequests[i];
        if (r.type !== wantType || r.ctrl !== ctrlStr) continue;
        if (ev.connId && r.connId && r.connId !== ev.connId) continue;
        idx = i;
        break;
      }
    }
    if (idx < 0 && ev.connId) {
      for (let i = openRequests.length - 1; i >= 0; i--) {
        const r = openRequests[i];
        if (r.type === wantType && r.connId === ev.connId) {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) return null;
    const [req] = openRequests.splice(idx, 1);
    return req.id;
  }

  function trackRequest(ev) {
    if (ev.type !== 'msg.in' && ev.type !== 'msg.out') return;
    const summary = ev.data && ev.data.summary;
    openRequests.push({
      id: ev.id,
      type: ev.type,
      connId: ev.connId || null,
      ctrl: summary && summary.controlId ? String(summary.controlId) : null,
    });
    if (openRequests.length > MAX_OPEN_REQUESTS) openRequests.shift();
  }

  function ingest(ev) {
    if (!ev || typeof ev !== 'object' || !Number.isFinite(ev.id)) return false;
    if (byId.has(ev.id)) return false;
    events.push(ev);
    byId.set(ev.id, ev);
    typeCounts.set(ev.type, (typeCounts.get(ev.type) || 0) + 1);
    if (ev.endpointId && !endpoints.has(ev.endpointId)) {
      endpoints.add(ev.endpointId);
      endpointsDirty = true;
    }
    if (ev.source === 'scenario' && ev.endpointId) {
      const name = ev.type === 'scenario.start' && ev.data && typeof ev.data.name === 'string' ? ev.data.name : null;
      const known = runs.get(ev.endpointId);
      if (!known || (name && !known.name)) {
        runs.set(ev.endpointId, { name: name || (known && known.name) || null, ts: (known && known.ts) || ev.ts });
        endpointsDirty = true;
      }
    }
    if (ev.connId) indexAdd(byConn, ev.connId, ev.id);
    for (const c of controlIdsOf(ev)) indexAdd(byCtrl, c, ev.id);
    const reqId = matchReply(ev);
    if (reqId !== null) registerPair(reqId, ev.id);
    trackRequest(ev);
    return true;
  }

  function evict() {
    while (events.length > MAX_ROWS) {
      const old = events.shift();
      byId.delete(old.id);
      typeCounts.set(old.type, Math.max(0, (typeCounts.get(old.type) || 1) - 1));
      if (old.connId) indexRemove(byConn, old.connId, old.id);
      for (const c of controlIdsOf(old)) indexRemove(byCtrl, c, old.id);
      const partner = pairs.get(old.id);
      if (partner !== undefined) {
        pairs.delete(old.id);
        pairs.delete(partner);
      }
      const reqIdx = openRequests.findIndex((r) => r.id === old.id);
      if (reqIdx >= 0) openRequests.splice(reqIdx, 1);
      const tr = rows.get(old.id);
      if (tr) {
        if (isPaused()) {
          const h = tr.offsetHeight;
          tr.remove();
          scroller.scrollTop = Math.max(0, scroller.scrollTop - h);
        } else {
          tr.remove();
        }
        rows.delete(old.id);
      }
      if (selectedId === old.id) selectedId = null;
    }
  }

  // ---- filtering ----------------------------------------------------------------

  function searchText(ev) {
    let s = searchCache.get(ev);
    if (s !== undefined) return s;
    const d = ev.data || {};
    const parts = [ev.type, ev.endpointId, ev.connId, ev.summary, summaryPl(ev), ev.level, `#${ev.id}`, ...controlIdsOf(ev)];
    if (typeof d.text === 'string') parts.push(d.text.slice(0, 4096));
    if (typeof d.message === 'string') parts.push(d.message);
    if (typeof d.error === 'string') parts.push(d.error);
    if (typeof d.name === 'string') parts.push(d.name);
    if (typeof d.code === 'string') parts.push(d.code);
    if (d.remoteAddress) parts.push(`${d.remoteAddress}:${d.remotePort}`);
    if (d.host) parts.push(`${d.host}:${d.port}`);
    s = parts.filter((p) => p !== null && p !== undefined && p !== '').join(' ').toLowerCase();
    searchCache.set(ev, s);
    return s;
  }

  function matches(ev) {
    if (!ctx.settings.showBytes && (ev.type === 'bytes.in' || ev.type === 'bytes.out')) return false;
    if (filters.types && !filters.types.has(ev.type)) return false;
    if (filters.endpoint && ev.endpointId !== filters.endpoint) return false;
    if (filters.level && ev.level !== filters.level) return false;
    if (filters.text && !searchText(ev).includes(filters.text)) return false;
    return true;
  }

  // ---- rows ---------------------------------------------------------------------

  function deltaBetween(prev, ev) {
    if (!prev) return null;
    if (Number.isFinite(prev.mono) && Number.isFinite(ev.mono)) {
      const d = ev.mono - prev.mono;
      return d >= 0 ? d : null;
    }
    if (Number.isFinite(prev.tsMs) && Number.isFinite(ev.tsMs)) {
      const d = ev.tsMs - prev.tsMs;
      return d >= 0 ? d : null;
    }
    return null;
  }

  function latencyTitle(ev) {
    switch (ev.type) {
      case 'ack.out': return 'Czas przetwarzania: od kompletnej ramki do wysłania ACK';
      case 'ack.in': return 'Czas odpowiedzi: od wysłania wiadomości do kompletnej ramki ACK';
      case 'msg.in': return 'Czas odbioru: od pierwszego bajtu do kompletnej ramki';
      case 'sender.connect': return 'Czas nawiązania połączenia TCP';
      default: return 'Czas';
    }
  }

  function latencyCell(ev) {
    const td = el('td', { class: 'c-latency' });
    if (ev.type === 'ack.timeout') {
      td.append(badge('timeout', 'lat lat-bad', `Brak ACK po ${formatMs(ev.data && ev.data.ackTimeoutMs)}`));
      return td;
    }
    if (Number.isFinite(ev.latencyMs)) {
      td.append(badge(formatMs(ev.latencyMs), `lat ${latencyClass(ev.latencyMs, ctx.settings)}`, latencyTitle(ev)));
    }
    return td;
  }

  function renderRow(ev, prev) {
    const summary = summaryPl(ev);
    const dir = ev.direction;
    const bytes = bytesOf(ev);
    const deltaMs = deltaBetween(prev, ev);
    const tr = el('tr', { class: `ev lvl-${ev.level || 'info'}`, 'data-id': String(ev.id) });
    tr.append(
      el('td', { class: 'c-chain' }, el('span', { class: 'chain-mark' })),
      el('td', { class: 'c-time', title: `${ev.ts}  (zdarzenie #${ev.id})` }, formatTime(ev.ts, ctx.settings.utc)),
      el('td', { class: 'c-delta', title: deltaMs !== null ? `Odstęp od poprzedniego widocznego wiersza: ${formatMs(deltaMs)}` : null }, formatDelta(deltaMs)),
      el('td', { class: 'c-endpoint', title: ev.connId ? `Połączenie ${ev.connId}` : (ev.endpointId || '') },
        endpointLabel(ev.endpointId),
        ev.connId ? el('span', { class: 'conn-counter' }, connCounter(ev.connId)) : null),
      el('td', { class: `c-dir ${dir ? `dir-${dir}` : ''}`.trim(), title: dir === 'in' ? 'Przychodzące' : dir === 'out' ? 'Wychodzące' : null }, directionArrow(ev)),
      el('td', { class: 'c-type' }, badge(ev.type, typeClass(ev.type), typeLabel(ev.type))),
      el('td', { class: 'c-summary', title: summary }, summary),
      latencyCell(ev),
      el('td', { class: 'c-bytes', title: bytes !== null ? `${bytes} B` : null }, formatBytes(bytes)),
    );
    if (ev.id === selectedId) tr.classList.add('selected');
    return tr;
  }

  function chainInfo(reqEv, replyEv) {
    const dirClass = reqEv && reqEv.type === 'msg.out' ? 'chain-out' : 'chain-in';
    let bad = false;
    if (replyEv) {
      if (replyEv.type === 'ack.timeout') bad = true;
      else if (replyEv.type === 'ack.in' && replyEv.data && replyEv.data.validation && replyEv.data.validation.accepted === false) bad = true;
      else if (replyEv.type === 'ack.skipped') bad = true;
    }
    return { dirClass, bad };
  }

  function applyChain(reqId, replyId) {
    const a = rows.get(reqId);
    const b = rows.get(replyId);
    if (!a || !b) return;
    const { dirClass, bad } = chainInfo(byId.get(reqId), byId.get(replyId));
    a.classList.add('chain-start', dirClass);
    b.classList.add('chain-end', dirClass);
    if (bad) {
      a.classList.add('chain-bad');
      b.classList.add('chain-bad');
    }
    let n = a.nextElementSibling;
    let steps = 0;
    while (n && n !== b && steps < CHAIN_WALK_LIMIT) {
      if (!n.classList.contains('chain-start') && !n.classList.contains('chain-end')) n.classList.add('chain-mid', dirClass);
      n = n.nextElementSibling;
      steps += 1;
    }
    if (n !== b) {
      a.classList.add('chain-far');
      b.classList.add('chain-far');
    }
  }

  function appendRow(ev) {
    const tr = renderRow(ev, lastVisible);
    tbody.append(tr);
    rows.set(ev.id, tr);
    lastVisible = ev;
    const partner = pairs.get(ev.id);
    if (partner !== undefined) applyChain(Math.min(ev.id, partner), Math.max(ev.id, partner));
    emptyEl.hidden = true;
  }

  function rerender() {
    clear(tbody);
    rows.clear();
    const frag = document.createDocumentFragment();
    let prev = null;
    for (const ev of events) {
      if (!matches(ev)) continue;
      const tr = renderRow(ev, prev);
      frag.append(tr);
      rows.set(ev.id, tr);
      prev = ev;
    }
    lastVisible = prev;
    tbody.append(frag);
    for (const [a, b] of pairs) if (a < b) applyChain(a, b);
    emptyEl.hidden = rows.size > 0;
    if (!isPaused()) scrollToBottom();
    scheduleCounts();
  }

  function reset() {
    events.length = 0;
    byId.clear();
    rows.clear();
    byConn.clear();
    byCtrl.clear();
    pairs.clear();
    openRequests.length = 0;
    typeCounts.clear();
    endpoints.clear();
    runs.clear();
    endpointsDirty = true;
    lastVisible = null;
    selectedId = null;
    newSincePause = 0;
    pausedAuto = false;
    clearHover();
    clear(tbody);
    emptyEl.hidden = false;
    updatePill();
  }

  // ---- scrolling / pause --------------------------------------------------------

  function isPaused() {
    return pausedManual || pausedAuto;
  }

  function notifyPause() {
    try {
      pauseHandler({ manual: pausedManual, auto: pausedAuto, paused: isPaused(), pending: newSincePause });
    } catch (err) {
      console.error(err);
    }
  }

  function scrollToBottom() {
    programmaticScrollUntil = performance.now() + 200;
    scroller.scrollTop = scroller.scrollHeight;
  }

  function nearBottom() {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  }

  function updatePill() {
    if (isPaused() && newSincePause > 0) {
      pill.hidden = false;
      pill.textContent = `${newSincePause} ${pluralNowe(newSincePause)} ↓`;
    } else {
      pill.hidden = true;
    }
  }

  scroller.addEventListener('scroll', () => {
    if (performance.now() < programmaticScrollUntil) return;
    if (nearBottom()) {
      if (pausedAuto) {
        pausedAuto = false;
        newSincePause = 0;
        updatePill();
        notifyPause();
      }
    } else if (!pausedManual && !pausedAuto) {
      pausedAuto = true;
      updatePill();
      notifyPause();
    }
  }, { passive: true });

  function resume() {
    pausedAuto = false;
    pausedManual = false;
    newSincePause = 0;
    updatePill();
    scrollToBottom();
    notifyPause();
  }

  function setPaused(manual) {
    pausedManual = !!manual;
    if (!manual) {
      pausedAuto = false;
      newSincePause = 0;
      scrollToBottom();
    }
    updatePill();
    notifyPause();
  }

  pill.addEventListener('click', resume);

  // ---- selection ------------------------------------------------------------------

  function revealRow(tr) {
    programmaticScrollUntil = performance.now() + 200;
    const headH = thead.offsetHeight;
    const top = tr.offsetTop;
    const bottom = top + tr.offsetHeight;
    const viewTop = scroller.scrollTop + headH;
    const viewBottom = scroller.scrollTop + scroller.clientHeight;
    if (top < viewTop) scroller.scrollTop = Math.max(0, top - headH - 4);
    else if (bottom > viewBottom) scroller.scrollTop = bottom - scroller.clientHeight + 4;
  }

  function select(id, opts = {}) {
    const scroll = opts.scroll !== false;
    const emit = opts.emit !== false;
    if (selectedId !== null) {
      const prevTr = rows.get(selectedId);
      if (prevTr) prevTr.classList.remove('selected');
    }
    selectedId = Number.isFinite(id) ? id : null;
    const ev = selectedId !== null ? byId.get(selectedId) || null : null;
    const tr = selectedId !== null ? rows.get(selectedId) : null;
    if (tr) {
      tr.classList.add('selected');
      if (scroll) revealRow(tr);
    }
    if (emit) {
      try {
        selectHandler(ev, selectedId);
      } catch (err) {
        console.error(err);
      }
    }
    return ev;
  }

  function moveSelection(step) {
    const list = tbody.children;
    if (!list.length) return;
    let idx = -1;
    if (selectedId !== null) {
      const tr = rows.get(selectedId);
      if (tr) idx = Array.prototype.indexOf.call(list, tr);
    }
    let next;
    if (idx < 0) next = step > 0 ? 0 : list.length - 1;
    else next = Math.min(list.length - 1, Math.max(0, idx + step));
    select(Number(list[next].dataset.id), { scroll: true });
  }

  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest ? e.target.closest('tr.ev') : null;
    if (!tr) return;
    select(Number(tr.dataset.id), { scroll: false });
  });

  // ---- hover: related rows --------------------------------------------------------

  function relatedIds(ev) {
    const ids = new Set();
    if (ev.connId) for (const id of byConn.get(ev.connId) || []) ids.add(id);
    for (const c of controlIdsOf(ev)) for (const id of byCtrl.get(c) || []) ids.add(id);
    const partner = pairs.get(ev.id);
    if (partner !== undefined) ids.add(partner);
    ids.delete(ev.id);
    return ids;
  }

  function clearHover() {
    for (const r of hoverLit) r.classList.remove('related');
    hoverLit = [];
    hoverTr = null;
  }

  tbody.addEventListener('mouseover', (e) => {
    const tr = e.target.closest ? e.target.closest('tr.ev') : null;
    if (!tr || tr === hoverTr) return;
    clearHover();
    hoverTr = tr;
    const ev = byId.get(Number(tr.dataset.id));
    if (!ev) return;
    let n = 0;
    for (const id of relatedIds(ev)) {
      const r = rows.get(id);
      if (!r) continue;
      r.classList.add('related');
      hoverLit.push(r);
      n += 1;
      if (n >= MAX_RELATED_HIGHLIGHT) break;
    }
  });
  tbody.addEventListener('mouseleave', clearHover);

  // ---- filter bar -------------------------------------------------------------------

  const typeChecks = new Map();
  const typeCountEls = new Map();
  const ddBtn = el('button', { class: 'btn btn-sm dd-toggle', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Filtruj po typie zdarzenia' }, 'Typy: wszystkie');
  const ddMenu = el('div', { class: 'dd-menu', hidden: true });
  const ddList = el('div', { class: 'dd-list' });
  const endpointSel = el('select', { class: 'filter-endpoint', title: 'Filtruj po punkcie końcowym (nasłuch, nadawca, scenariusz)' });
  const textInput = el('input', { type: 'search', class: 'filter-text', placeholder: 'Szukaj: control id, tekst HL7, adres, opis...', title: 'Szukaj w opisie, treści HL7 i identyfikatorach', spellcheck: 'false', autocomplete: 'off' });
  const levelSel = el('select', { class: 'filter-level', title: 'Filtruj po poziomie' });
  const resetBtn = el('button', { class: 'btn btn-sm', type: 'button', title: 'Wyczyść wszystkie filtry' }, 'Wyczyść filtry');
  const summaryEl = el('span', { class: 'filter-summary mono' });

  function allTypes() {
    const set = new Set(EVENT_TYPES);
    for (const t of typeCounts.keys()) set.add(t);
    return [...set];
  }

  function ensureTypeItems() {
    for (const type of allTypes()) {
      if (typeChecks.has(type)) continue;
      const cb = el('input', { type: 'checkbox', checked: !filters.types || filters.types.has(type) });
      const countEl = el('span', { class: 'dd-count mono' }, '0');
      const item = el('label', { class: 'dd-item' }, cb, badge(type, typeClass(type), typeLabel(type)), el('span', { class: 'dd-label' }, typeLabel(type)), countEl);
      cb.addEventListener('change', () => {
        if (!filters.types) filters.types = new Set(allTypes());
        if (cb.checked) filters.types.add(type);
        else filters.types.delete(type);
        if (filters.types.size === typeChecks.size) filters.types = null;
        syncTypeUi();
        rerender();
      });
      typeChecks.set(type, cb);
      typeCountEls.set(type, countEl);
      ddList.append(item);
    }
  }

  function syncTypeUi() {
    for (const [type, cb] of typeChecks) cb.checked = !filters.types || filters.types.has(type);
    ddBtn.textContent = filters.types ? `Typy: ${filters.types.size} z ${typeChecks.size}` : 'Typy: wszystkie';
    ddBtn.classList.toggle('active', !!filters.types);
  }

  function setAllTypes(on) {
    filters.types = on ? null : new Set();
    syncTypeUi();
    rerender();
  }

  function onlyGroup(types) {
    filters.types = new Set(types);
    syncTypeUi();
    rerender();
  }

  function buildFilters() {
    if (!filtersRoot) return;
    const dd = el('div', { class: 'dd' });
    const tools = el('div', { class: 'dd-tools' },
      el('button', { class: 'btn btn-xs', type: 'button', onClick: () => setAllTypes(true) }, 'Wszystkie'),
      el('button', { class: 'btn btn-xs', type: 'button', onClick: () => setAllTypes(false) }, 'Żadne'),
      el('button', { class: 'btn btn-xs', type: 'button', title: 'Tylko wiadomości i ACK', onClick: () => onlyGroup(['msg.in', 'ack.out', 'msg.out', 'ack.in', 'ack.timeout', 'ack.skipped']) }, 'Wiadomości'),
      el('button', { class: 'btn btn-xs', type: 'button', title: 'Tylko błędy ramkowania i połączeń', onClick: () => onlyGroup(['frame.garbage', 'frame.incomplete', 'conn.error', 'listener.error', 'sender.error', 'ack.timeout', 'system.error']) }, 'Problemy'),
    );
    ddMenu.append(tools, ddList);
    dd.append(ddBtn, ddMenu);
    ddBtn.addEventListener('click', () => {
      const open = ddMenu.hidden;
      ddMenu.hidden = !open;
      ddBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!ddMenu.hidden && !dd.contains(e.target)) {
        ddMenu.hidden = true;
        ddBtn.setAttribute('aria-expanded', 'false');
      }
    });
    ddMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ddMenu.hidden = true;
        ddBtn.setAttribute('aria-expanded', 'false');
        ddBtn.focus();
        e.stopPropagation();
      }
    });

    for (const [val, label] of LEVEL_OPTIONS) levelSel.append(el('option', { value: val }, label));
    levelSel.addEventListener('change', () => {
      filters.level = levelSel.value;
      levelSel.classList.toggle('active', !!filters.level);
      rerender();
    });

    endpointSel.addEventListener('change', () => {
      filters.endpoint = endpointSel.value;
      endpointSel.classList.toggle('active', !!filters.endpoint);
      rerender();
    });

    const applyText = debounce(() => {
      filters.text = textInput.value.trim().toLowerCase();
      textInput.classList.toggle('active', !!filters.text);
      rerender();
    }, 150);
    textInput.addEventListener('input', applyText);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        textInput.value = '';
        applyText();
      }
    });

    resetBtn.addEventListener('click', () => {
      filters.types = null;
      filters.endpoint = '';
      filters.text = '';
      filters.level = '';
      textInput.value = '';
      levelSel.value = '';
      syncTypeUi();
      rebuildEndpointOptions();
      levelSel.classList.remove('active');
      endpointSel.classList.remove('active');
      textInput.classList.remove('active');
      rerender();
    });

    filtersRoot.append(
      el('div', { class: 'filter-group' }, dd),
      el('div', { class: 'filter-group' }, endpointSel),
      el('div', { class: 'filter-group filter-grow' }, textInput),
      el('div', { class: 'filter-group' }, levelSel),
      el('div', { class: 'filter-group' }, resetBtn),
      el('div', { class: 'filter-group filter-right' }, summaryEl),
    );
    ensureTypeItems();
    syncTypeUi();
    rebuildEndpointOptions();
  }

  /** The scenario name for a run id, the id itself for listeners, the sender and the system. */
  function endpointLabel(id) {
    const run = runs.get(id);
    return run ? run.name || 'scenariusz' : id || '';
  }

  function rebuildEndpointOptions() {
    const current = filters.endpoint;
    clear(endpointSel);
    endpointSel.append(el('option', { value: '' }, 'Wszystkie punkty'));
    const list = [...endpoints];
    if (current && !endpoints.has(current)) list.push(current);
    // runs of the same scenario differ by their start time; they come after the fixed endpoints
    const label = (ep) => (runs.has(ep) ? `${endpointLabel(ep)}, ${formatTime(runs.get(ep).ts, ctx.settings.utc)}` : String(ep));
    list.sort((a, b) => (runs.has(a) - runs.has(b)) || label(a).localeCompare(label(b), 'pl'));
    for (const ep of list) endpointSel.append(el('option', { value: ep }, label(ep)));
    endpointSel.value = current || '';
    endpointsDirty = false;
  }

  function updateCounts() {
    countsScheduled = false;
    ensureTypeItems();
    for (const [type, countEl] of typeCountEls) {
      const n = typeCounts.get(type) || 0;
      countEl.textContent = String(n);
      countEl.parentElement.classList.toggle('zero', n === 0);
    }
    if (endpointsDirty) rebuildEndpointOptions();
    summaryEl.textContent = `${rows.size} / ${events.length}`;
    summaryEl.title = `Widoczne wiersze / zdarzenia w pamięci przeglądarki (max ${MAX_ROWS})`;
    try {
      countsHandler({ visible: rows.size, total: events.length, max: MAX_ROWS });
    } catch (err) {
      console.error(err);
    }
  }

  function scheduleCounts() {
    if (countsScheduled) return;
    countsScheduled = true;
    requestAnimationFrame(updateCounts);
  }

  buildFilters();

  // ---- public API -------------------------------------------------------------------

  function add(ev) {
    if (!ingest(ev)) return false;
    evict();
    if (matches(ev)) {
      appendRow(ev);
      if (isPaused()) {
        newSincePause += 1;
        updatePill();
        notifyPause();
      } else {
        scrollToBottom();
      }
    }
    scheduleCounts();
    return true;
  }

  function rebuild(list) {
    reset();
    const sorted = Array.isArray(list) ? [...list].filter((e) => e && Number.isFinite(e.id)).sort((a, b) => a.id - b.id) : [];
    for (const ev of sorted) ingest(ev);
    evict();
    rebuildEndpointOptions();
    rerender();
  }

  /** Merge an additional batch (e.g. REST backfill of older events); keeps selection. */
  function merge(list) {
    if (!Array.isArray(list) || !list.length) return 0;
    let added = 0;
    for (const ev of list) if (ev && Number.isFinite(ev.id) && !byId.has(ev.id)) added += 1;
    if (!added) return 0;
    const keepSelected = selectedId;
    const combined = events.concat(list.filter((ev) => ev && Number.isFinite(ev.id) && !byId.has(ev.id)));
    const wasPaused = isPaused();
    rebuild(combined);
    if (keepSelected !== null && byId.has(keepSelected)) select(keepSelected, { scroll: !wasPaused, emit: false });
    return added;
  }

  function getFilters() {
    let types = filters.types ? [...filters.types] : null;
    if (!types && !ctx.settings.showBytes) types = allTypes().filter((t) => t !== 'bytes.in' && t !== 'bytes.out');
    return {
      types,
      endpointId: filters.endpoint || null,
      text: filters.text || null,
      level: filters.level || null,
    };
  }

  function setFilters(partial = {}) {
    if (partial.endpoint !== undefined) {
      filters.endpoint = partial.endpoint || '';
      if (filters.endpoint && !endpoints.has(filters.endpoint)) endpoints.add(filters.endpoint);
      rebuildEndpointOptions();
      endpointSel.classList.toggle('active', !!filters.endpoint);
    }
    if (partial.text !== undefined) {
      filters.text = String(partial.text || '').trim().toLowerCase();
      textInput.value = partial.text || '';
      textInput.classList.toggle('active', !!filters.text);
    }
    if (partial.level !== undefined) {
      filters.level = partial.level || '';
      levelSel.value = filters.level;
      levelSel.classList.toggle('active', !!filters.level);
    }
    if (partial.types !== undefined) {
      filters.types = partial.types ? new Set(partial.types) : null;
      syncTypeUi();
    }
    rerender();
  }

  function hasActiveFilters() {
    return !!(filters.types || filters.endpoint || filters.text || filters.level);
  }

  return {
    add,
    rebuild,
    merge,
    clear: () => {
      reset();
      rerender();
    },
    refresh: rerender,
    getEvent: (id) => byId.get(id) || null,
    getPair: (id) => (pairs.has(id) ? byId.get(pairs.get(id)) || null : null),
    getPairId: (id) => (pairs.has(id) ? pairs.get(id) : null),
    allEvents: () => events.slice(),
    select,
    deselect: () => select(null, { scroll: false }),
    getSelectedId: () => selectedId,
    moveSelection,
    setPaused,
    isPaused,
    isManuallyPaused: () => pausedManual,
    resume,
    getFilters,
    setFilters,
    hasActiveFilters,
    counts: () => ({ visible: rows.size, total: events.length, max: MAX_ROWS }),
    onSelect: (fn) => { selectHandler = typeof fn === 'function' ? fn : () => {}; },
    onCounts: (fn) => { countsHandler = typeof fn === 'function' ? fn : () => {}; },
    onPause: (fn) => { pauseHandler = typeof fn === 'function' ? fn : () => {}; },
    focus: () => scroller.focus(),
    element: scroller,
  };
}
