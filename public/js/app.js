// Bootstrap: layout, shared context (modals, toasts, clipboard), settings, WebSocket wiring and panel switching.

import * as api from './api.js';
import { createWsClient } from './ws.js';
import { createTimeline } from './timeline.js';
import { createInspector } from './inspector.js';
import { createListenersPanel } from './listeners.js';
import { createSenderPanel } from './sender.js';
import { createScenariosPanel } from './scenarios.js';
import { VIEW_GROUPS, VIEW_KEYS, VIEW_LABELS, normalizeView, hiddenKeys, viewCss } from './view.js';
import { el, clear, formatTime, formatMs, inputEl, selectEl, checkboxEl, formField, setFieldError, toInt, debounce } from './format.js';

const SETTINGS_KEY = 'hl7t.ui.settings.v1';
// What the program kept in a browser before the view setting existed: any of it means an earlier user.
const EARLIER_KEYS = [SETTINGS_KEY, 'hl7t.sender.form.v1', 'hl7t.scenarioTarget'];
const DEFAULT_SETTINGS = {
  warnMs: 300,
  badMs: 1000,
  showBytes: false,
  utc: false,
  inspectorW: 460,
  inspectorH: 360,
  inspectorCollapsed: false,
  filtersOpen: false,
  panels: { listeners: true, sender: true, scenarios: true },
};
const REST_FALLBACK_MS = 3000;
const BACKFILL_LIMIT = 2000;

function usedBefore() {
  try {
    return EARLIER_KEYS.some((key) => localStorage.getItem(key) !== null);
  } catch (err) {
    return false;
  }
}

/**
 * Settings from this browser. A view that was never saved comes out as Prosty in a new browser and as
 * Pełny in one that used the program before (its user knows the full screen); viewStored tells which.
 */
function loadSettings() {
  const fallbackView = usedBefore() ? 'full' : 'simple';
  const fresh = () => ({ settings: { ...structuredClone(DEFAULT_SETTINGS), view: normalizeView(null, fallbackView) }, viewStored: false });
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fresh();
    const parsed = JSON.parse(raw);
    return {
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        ...parsed,
        panels: { ...DEFAULT_SETTINGS.panels, ...(parsed.panels || {}) },
        view: normalizeView(parsed.view, fallbackView),
      },
      viewStored: !!parsed.view,
    };
  } catch (err) {
    return fresh();
  }
}

function $(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Brak elementu #${id} w index.html`);
  return node;
}

function init() {
  const { settings, viewStored } = loadSettings();
  const saveSettings = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      // storage unavailable: settings stay in memory for this session
    }
  };

  const docEl = document.documentElement;
  const mainEl = $('main');
  const inspectorEl = $('inspector');
  const handleEl = $('inspector-handle');
  const filtersEl = $('filters');
  const bannerEl = $('ws-banner');
  const wsStatusEl = $('ws-status');
  const clockEl = $('server-clock');
  const counterEl = $('event-counter');
  const versionEl = $('app-version');
  const modalRoot = $('modal-root');
  const toastsEl = $('toasts');
  const btnPause = $('btn-pause');
  const btnFilters = $('btn-filters');
  const btnClear = $('btn-clear');
  const btnSettings = $('btn-settings');
  const btnInspector = $('btn-inspector');
  const exportMenu = $('export-menu');
  const btnExport = $('btn-export');
  const viewStyleEl = $('view-style');
  const viewSelect = $('view-select');
  const mq = window.matchMedia('(max-width: 1700px)');

  let state = null;
  let serverStats = null;
  let loaded = false;
  let backfilled = false;

  // ---- layout: CSS variables, collapsed states ------------------------------------

  docEl.style.setProperty('--inspector-w', `${settings.inspectorW}px`);
  docEl.style.setProperty('--inspector-h', `${settings.inspectorH}px`);
  mainEl.classList.toggle('inspector-collapsed', !!settings.inspectorCollapsed);
  btnInspector.classList.toggle('active', !settings.inspectorCollapsed);
  filtersEl.hidden = !settings.filtersOpen;
  btnFilters.classList.toggle('active', !!settings.filtersOpen);

  // ---- view: which parts of the screen are shown (public/js/view.js) ------------------
  // Set before the panels are drawn: they read view.isHidden() for the parts drawn in code.

  let hiddenView = hiddenKeys(settings.view);
  viewStyleEl.textContent = viewCss(hiddenView);
  for (const [value, label] of Object.entries(VIEW_LABELS)) viewSelect.append(el('option', { value }, label));
  viewSelect.value = settings.view.preset;
  const view = { isHidden: (key) => hiddenView.has(key) };

  // ---- toasts ----------------------------------------------------------------------

  function notify(message, level = 'info', opts = {}) {
    const toast = el('div', { class: `toast toast-${level}`, role: level === 'error' ? 'alert' : 'status' });
    const remove = () => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 200);
    };
    toast.append(
      el('span', { class: 'toast-msg' }, String(message)),
      el('button', { class: 'toast-close', type: 'button', title: 'Zamknij', 'aria-label': 'Zamknij', onClick: remove }, '×'),
    );
    toastsEl.append(toast);
    while (toastsEl.children.length > 6) toastsEl.firstChild.remove();
    const ms = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : (level === 'error' ? 8000 : level === 'warn' ? 5000 : 3500);
    setTimeout(remove, ms);
  }

  // ---- modals ----------------------------------------------------------------------

  const modalStack = [];

  function openModal({ title, body, actions = [], wide = false, onClose = null }) {
    const previouslyFocused = document.activeElement;
    const backdrop = el('div', { class: 'modal-backdrop' });
    const dialog = el('div', { class: `modal ${wide ? 'modal-wide' : ''}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' });
    const errorEl = el('div', { class: 'modal-error', hidden: true, role: 'alert' });
    const footer = el('div', { class: 'modal-footer' });
    let closed = false;
    const handle = {
      dialog,
      close() {
        if (closed) return;
        closed = true;
        backdrop.remove();
        const i = modalStack.indexOf(handle);
        if (i >= 0) modalStack.splice(i, 1);
        if (typeof onClose === 'function') {
          try {
            onClose();
          } catch (err) {
            console.error(err);
          }
        }
        if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
      },
      setError(msg) {
        errorEl.textContent = msg || '';
        errorEl.hidden = !msg;
      },
      setBusy(busy) {
        footer.querySelectorAll('button').forEach((b) => { b.disabled = !!busy; });
        dialog.classList.toggle('busy', !!busy);
      },
    };
    for (const a of actions) {
      footer.append(el('button', {
        class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''} ${a.class || ''}`.replace(/\s+/g, ' ').trim(),
        type: 'button',
        onClick: () => {
          if (typeof a.onClick === 'function') a.onClick(handle.close);
          else handle.close();
        },
      }, a.label));
    }
    dialog.append(
      el('div', { class: 'modal-header' },
        el('h2', {}, title),
        el('button', { class: 'modal-close', type: 'button', title: 'Zamknij (Esc)', 'aria-label': 'Zamknij', onClick: handle.close }, '×')),
      el('div', { class: 'modal-body' }, body),
      errorEl,
      footer,
    );
    backdrop.append(dialog);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) handle.close();
    });
    modalRoot.append(backdrop);
    modalStack.push(handle);
    const first = dialog.querySelector('[autofocus], input:not([disabled]), select, textarea, .modal-footer button');
    (first || dialog).focus();
    return handle;
  }

  function confirmDialog({ title = 'Potwierdź', message, okLabel = 'OK', cancelLabel = 'Anuluj', danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      openModal({
        title,
        body: el('p', { class: 'confirm-text' }, message),
        onClose: () => finish(false),
        actions: [
          { label: cancelLabel, onClick: (close) => close() },
          { label: okLabel, primary: !danger, danger, onClick: (close) => { finish(true); close(); } },
        ],
      });
    });
  }

  // ---- clipboard -------------------------------------------------------------------

  async function copyText(text, label = 'Tekst') {
    const value = String(text === null || text === undefined ? '' : text);
    if (!value) {
      notify(`${label}: brak treści do skopiowania`, 'warn');
      return false;
    }
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        notify(`${label}: skopiowano (${value.length} znaków)`, 'info');
        return true;
      } catch (err) {
        // fall back below (permissions / insecure context)
      }
    }
    try {
      const ta = el('textarea', { class: 'clipboard-helper', 'aria-hidden': 'true' });
      ta.value = value;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) {
        notify(`${label}: skopiowano (${value.length} znaków)`, 'info');
        return true;
      }
    } catch (err) {
      // reported below
    }
    notify(`Nie udało się skopiować (${label}). Zaznacz tekst ręcznie.`, 'error');
    return false;
  }

  // ---- shared context (modules are created below; functions resolve them lazily) -----

  let timeline;
  let inspector;
  let listeners;
  let sender;
  let scenarios;
  let ws;

  const refreshState = debounce(async () => {
    try {
      const st = await api.state();
      applyState(st);
    } catch (err) {
      // the WebSocket heartbeat will deliver the next state anyway
    }
  }, 300);

  function showPanel(name) {
    const section = document.querySelector(`.panel[data-panel="${name}"]`);
    if (!section) return;
    setPanelExpanded(section, true);
    section.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function showFilters(open) {
    const next = open === undefined ? filtersEl.hidden : !!open;
    filtersEl.hidden = !next;
    btnFilters.classList.toggle('active', next);
    settings.filtersOpen = next;
    saveSettings();
  }

  async function selectEvent(id) {
    const numId = Number(id);
    if (!Number.isFinite(numId)) return;
    const ev = timeline.getEvent(numId);
    if (ev) {
      timeline.select(numId, { scroll: true });
      if (!timeline.element.querySelector(`tr[data-id="${numId}"]`)) {
        notify(`Zdarzenie #${numId} jest ukryte na osi czasu (filtry albo widok), pokazano je w inspektorze`, 'info');
      }
      return;
    }
    try {
      const fetched = await api.getEvent(numId);
      timeline.deselect();
      inspector.show(fetched);
      notify(`Zdarzenie #${numId} jest poza buforem osi czasu, pokazano je w inspektorze`, 'info');
    } catch (err) {
      notify(`Nie znaleziono zdarzenia #${numId}: ${err.message}`, 'error');
    }
  }

  async function selectEventByTypes(ids, types) {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite);
    const wanted = Array.isArray(types) && types.length ? types : null;
    if (!list.length) {
      notify('Brak powiązanych zdarzeń', 'warn');
      return;
    }
    const known = list.map((id) => timeline.getEvent(id)).filter(Boolean);
    if (wanted) {
      for (const type of wanted) {
        const found = known.find((ev) => ev.type === type);
        if (found) {
          selectEvent(found.id);
          return;
        }
      }
    }
    const unknownIds = list.filter((id) => !timeline.getEvent(id)).slice(-25);
    const fetched = [];
    for (const id of unknownIds) {
      try {
        fetched.push(await api.getEvent(id));
      } catch (err) {
        // missing on the server too (ring buffer): skip
      }
    }
    if (wanted) {
      for (const type of wanted) {
        const found = fetched.find((ev) => ev && ev.type === type);
        if (found) {
          timeline.deselect();
          inspector.show(found);
          return;
        }
      }
    }
    selectEvent(list[list.length - 1]);
  }

  const ctx = {
    api,
    settings,
    view,
    notify,
    openModal,
    confirm: confirmDialog,
    copy: copyText,
    selectEvent,
    selectEventByTypes,
    getEvent: (id) => timeline.getEvent(Number(id)),
    getPair: (id) => timeline.getPair(Number(id)),
    resend(text, ev) {
      sender.loadMessage(text, { source: ev ? `zdarzenie #${ev.id}` : 'podgląd ACK', focus: true });
      showPanel('sender');
    },
    setEndpointFilter(endpointId) {
      // the buttons that call this are hidden together with the filter bar
      if (view.isHidden('top.filters')) return;
      showFilters(true);
      timeline.setFilters({ endpoint: endpointId });
      notify(`Oś czasu: tylko ${endpointId}`, 'info');
    },
    refreshState,
    showPanel,
    getState: () => state,
  };

  // ---- modules -----------------------------------------------------------------------

  timeline = createTimeline({ root: $('timeline'), filtersRoot: filtersEl, ctx });
  inspector = createInspector({ root: $('inspector-body'), ctx });
  listeners = createListenersPanel({ root: $('listeners-body'), ctx });
  sender = createSenderPanel({ root: $('sender-body'), ctx });
  scenarios = createScenariosPanel({ root: $('scenarios-body'), ctx });

  // the view worked out on this visit (new browser: Prosty, earlier user: Pełny) stays for the next one
  if (!viewStored) saveSettings();

  timeline.onSelect((ev) => {
    if (ev) inspector.show(ev);
  });
  timeline.onCounts(updateCounter);
  timeline.onPause(updatePauseButton);

  function updateCounter() {
    const c = timeline.counts();
    counterEl.textContent = `${c.visible} / ${c.total}`;
    const serverCount = serverStats && Number.isFinite(serverStats.count) ? serverStats.count : null;
    counterEl.title = `Widoczne wiersze / zdarzenia w przeglądarce (max ${c.max})${serverCount !== null ? `. Na serwerze: ${serverCount}${serverStats.dropped ? `, odrzucone z bufora: ${serverStats.dropped}` : ''}` : ''}`;
  }

  function updatePauseButton(info) {
    const paused = info ? info.paused : timeline.isPaused();
    const pending = info && info.pending ? info.pending : 0;
    btnPause.classList.toggle('active', paused);
    btnPause.textContent = paused ? `▶ Wznów${pending ? ` (${pending})` : ''}` : '⏸ Autoprzewijanie';
    btnPause.title = paused
      ? 'Autoprzewijanie wstrzymane. Kliknij, aby wznowić i przewinąć do najnowszych (End)'
      : 'Wstrzymaj autoprzewijanie osi czasu (spacja)';
  }
  updatePauseButton(null);

  // ---- state handling ------------------------------------------------------------------

  function applyState(st) {
    if (!st || typeof st !== 'object') return;
    state = st;
    const list = Array.isArray(st.listeners) ? st.listeners : [];
    listeners.render(list);
    sender.setListeners(list);
    if (st.scenarios && typeof st.scenarios === 'object') {
      scenarios.setAvailable(st.scenarios.available);
      scenarios.setRuns(st.scenarios.lastRuns);
    }
    if (st.config && typeof st.config === 'object') {
      const th = st.config.ui && st.config.ui.latencyThresholds;
      if (th && Number.isFinite(th.warnMs) && Number.isFinite(th.badMs) && (th.warnMs !== settings.warnMs || th.badMs !== settings.badMs)) {
        settings.warnMs = th.warnMs;
        settings.badMs = th.badMs;
        saveSettings();
        timeline.refresh();
        inspector.refresh();
      }
      sender.setDefaults(st.config.senderDefaults);
    }
    serverStats = st.events && typeof st.events === 'object' ? st.events : serverStats;
    updateCounter();
    if (st.version) versionEl.textContent = `v${st.version}`;
  }

  function applySnapshot(msg) {
    const snapEvents = Array.isArray(msg.events) ? msg.events : [];
    const known = timeline.allEvents();
    const prevLastId = known.length ? known[known.length - 1].id : 0;
    let restart = false;
    for (const ev of snapEvents) {
      const known = timeline.getEvent(ev.id);
      if (known && (known.ts !== ev.ts || known.type !== ev.type)) {
        restart = true;
        break;
      }
    }
    if (!timeline.counts().total || restart) {
      const selected = timeline.getSelectedId();
      timeline.rebuild(snapEvents);
      if (selected !== null && timeline.getEvent(selected) && !restart) timeline.select(selected, { scroll: false, emit: false });
      if (restart) {
        inspector.clear();
        notify('Serwer został uruchomiony ponownie, oś czasu przebudowana', 'warn');
      }
    } else {
      timeline.merge(snapEvents);
      // Reconnect: the snapshot carries only the last 500 events, fetch anything missed in between.
      const minSnapId = snapEvents.reduce((min, ev) => (Number.isFinite(ev.id) && ev.id < min ? ev.id : min), Infinity);
      if (prevLastId > 0 && minSnapId > prevLastId + 1) fillGap(prevLastId);
    }
    applyState(msg.state);
    loaded = true;
    if (!backfilled) backfill();
  }

  async function fillGap(sinceId) {
    try {
      const res = await api.events({ sinceId, limit: BACKFILL_LIMIT });
      if (res && Array.isArray(res.events)) {
        const added = timeline.merge(res.events);
        if (added > 0) notify(`Uzupełniono ${added} zdarzeń z okresu bez połączenia`, 'info');
      }
    } catch (err) {
      // best effort: the timeline keeps what the snapshot delivered
    }
  }

  async function backfill() {
    backfilled = true;
    try {
      const res = await api.events({ limit: BACKFILL_LIMIT });
      if (res && Array.isArray(res.events)) {
        const added = timeline.merge(res.events);
        if (added > 0) notify(`Dociągnięto ${added} starszych zdarzeń z serwera`, 'info');
        if (res.stats) {
          serverStats = res.stats;
          updateCounter();
        }
      }
    } catch (err) {
      // the snapshot is enough; backfill is best effort
    }
  }

  function onEvent(ev) {
    if (!timeline.add(ev)) return;
    const current = inspector.current();
    if (current && timeline.getPairId(current.id) === ev.id) inspector.refresh();
  }

  // ---- WebSocket ---------------------------------------------------------------------------

  ws = createWsClient({
    bannerEl,
    onSnapshot: applySnapshot,
    onEvent,
    onState: applyState,
    onGap: (msg) => {
      notify(`Serwer pominął ${msg.dropped ?? 0} zdarzeń (przeciążony bufor WebSocket), dociągam z REST`, 'warn');
      fillGap(Number(msg.sinceId) || 0);
    },
    onClear: () => {
      timeline.clear();
      inspector.clear();
      notify('Zdarzenia zostały wyczyszczone', 'info');
    },
    onStatus: (status, info) => {
      wsStatusEl.className = `ws-status ws-${status}`;
      const label = wsStatusEl.querySelector('.label');
      if (label) {
        label.textContent = status === 'open' ? 'połączono' : status === 'reconnecting' ? `ponawiam (${info.attempt})` : status === 'closed' ? 'rozłączono' : 'łączenie...';
      }
      wsStatusEl.title = status === 'open'
        ? `WebSocket połączony${Number.isFinite(info.rttMs) ? `, RTT ${formatMs(info.rttMs)}` : ''}`
        : 'Brak połączenia WebSocket z serwerem, trwa ponawianie';
    },
  });
  bannerEl.addEventListener('click', () => ws.reconnectNow());
  ws.connect();

  setTimeout(async () => {
    if (loaded) return;
    try {
      const [st, evs] = await Promise.all([api.state(), api.events({ limit: BACKFILL_LIMIT })]);
      if (!loaded) {
        timeline.rebuild(evs && Array.isArray(evs.events) ? evs.events : []);
        applyState(st);
        loaded = true;
        backfilled = true;
        notify('Dane pobrane przez REST (WebSocket jeszcze nie działa)', 'warn');
      }
    } catch (err) {
      notify(`Serwer nie odpowiada: ${err.message}`, 'error');
    }
  }, REST_FALLBACK_MS);

  // ---- clock -----------------------------------------------------------------------------

  setInterval(() => {
    const nowMs = ws.serverNowMs();
    clockEl.textContent = `${formatTime(nowMs, settings.utc)}${settings.utc ? ' UTC' : ''}`;
    const offset = ws.getOffsetMs();
    const rtt = ws.getRttMs();
    clockEl.title = ws.isOffsetKnown()
      ? `Czas serwera (korekta ${offset >= 0 ? '+' : ''}${Math.round(offset)} ms względem tej przeglądarki${Number.isFinite(rtt) ? `, RTT ${formatMs(rtt)}` : ''})`
      : 'Czas lokalny (offset serwera jeszcze nieznany)';
  }, 100);

  // ---- top bar -----------------------------------------------------------------------------

  function togglePause() {
    if (timeline.isPaused()) timeline.resume();
    else timeline.setPaused(true);
  }
  btnPause.addEventListener('click', togglePause);

  btnFilters.addEventListener('click', () => showFilters());

  btnClear.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Wyczyścić zdarzenia?',
      message: 'Bufor zdarzeń na serwerze i oś czasu zostaną wyczyszczone. Plik NDJSON (jeśli włączony) pozostaje bez zmian.',
      okLabel: 'Wyczyść',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.clearEvents();
      timeline.clear();
      inspector.clear();
    } catch (err) {
      notify(`Nie udało się wyczyścić zdarzeń: ${err.message}`, 'error');
    }
  });

  btnExport.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = exportMenu.hidden;
    exportMenu.hidden = !open;
    btnExport.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!exportMenu.hidden && !exportMenu.contains(e.target) && e.target !== btnExport) {
      exportMenu.hidden = true;
      btnExport.setAttribute('aria-expanded', 'false');
    }
  });
  exportMenu.addEventListener('click', (e) => {
    const item = e.target.closest ? e.target.closest('button[data-format]') : null;
    if (!item) return;
    const format = item.dataset.format;
    const url = api.exportUrl(format, timeline.getFilters());
    const a = el('a', { href: url, download: '' });
    document.body.append(a);
    a.click();
    a.remove();
    exportMenu.hidden = true;
    btnExport.setAttribute('aria-expanded', 'false');
    notify(`Eksport ${format.toUpperCase()}${timeline.hasActiveFilters() ? ' (z aktywnymi filtrami)' : ''} rozpoczęty`, 'info');
  });

  btnInspector.addEventListener('click', () => {
    settings.inspectorCollapsed = !settings.inspectorCollapsed;
    mainEl.classList.toggle('inspector-collapsed', settings.inspectorCollapsed);
    btnInspector.classList.toggle('active', !settings.inspectorCollapsed);
    saveSettings();
  });
  $('btn-inspector-close').addEventListener('click', () => btnInspector.click());

  btnSettings.addEventListener('click', openSettings);
  $('btn-add-listener').addEventListener('click', () => listeners.openNew());

  // ---- view switching ------------------------------------------------------------------------

  /** Applies settings.view: the CSS rule, then what is drawn in code (timeline columns, inspector tabs, client hint). */
  function applyView({ save = true } = {}) {
    settings.view = normalizeView(settings.view);
    hiddenView = hiddenKeys(settings.view);
    viewStyleEl.textContent = viewCss(hiddenView);
    viewSelect.value = settings.view.preset;
    // a filter left on under a hidden filter bar would thin out the timeline with no visible reason
    if (hiddenView.has('top.filters') && timeline.hasActiveFilters()) {
      timeline.resetFilters();
      notify('Filtry osi czasu wyczyszczone: ten widok nie pokazuje paska filtrów', 'info');
    }
    timeline.applyView();
    inspector.refresh();
    sender.applyView();
    if (save) saveSettings();
  }

  viewSelect.addEventListener('change', () => {
    const preset = viewSelect.value;
    if (preset === 'custom' && !settings.view.custom) {
      // the first Własny starts from what is on the screen now; the settings window lists every part
      settings.view = { preset, custom: [...hiddenView] };
      applyView();
      openSettings();
      return;
    }
    settings.view = { ...settings.view, preset };
    applyView();
  });

  function openSettings() {
    const viewBefore = structuredClone(settings.view);
    let saved = false;

    // view: the preset, then every part as a checkbox (checked = visible); a change shows at once
    const presetSel = selectEl(Object.entries(VIEW_LABELS), settings.view.preset);
    const countEl = el('div', { class: 'view-count' });
    const boxes = new Map();
    const showCount = () => {
      countEl.textContent = `${VIEW_KEYS.length - hiddenView.size} z ${VIEW_KEYS.length}`;
    };
    const previewView = () => {
      applyView({ save: false });
      presetSel.value = settings.view.preset;
      for (const [key, cb] of boxes) cb.checked = !hiddenView.has(key);
      showCount();
    };
    const groups = el('div', { class: 'view-groups' }, ...VIEW_GROUPS.map((group) => el('div', { class: 'view-group' },
      el('h4', {}, group.title),
      ...group.items.map((item) => {
        const cb = checkboxEl(!hiddenView.has(item.key));
        boxes.set(item.key, cb);
        cb.addEventListener('change', () => {
          const hidden = new Set(hiddenView);
          if (cb.checked) hidden.delete(item.key);
          else hidden.add(item.key);
          settings.view = { preset: 'custom', custom: [...hidden] };
          previewView();
        });
        return el('label', { class: 'check-inline' }, cb, el('span', {}, item.label));
      }))));
    presetSel.addEventListener('change', () => {
      const preset = presetSel.value;
      settings.view = preset === 'custom'
        ? { preset, custom: settings.view.custom || [...hiddenView] }
        : { ...settings.view, preset };
      previewView();
    });
    showCount();

    const warn = inputEl({ type: 'number', min: '1', value: String(settings.warnMs), class: 'mono' });
    const bad = inputEl({ type: 'number', min: '1', value: String(settings.badMs), class: 'mono' });
    const showBytes = checkboxEl(settings.showBytes);
    const utc = checkboxEl(settings.utc);
    const offset = ws.getOffsetMs();
    const body = el('div', {},
      el('h3', { class: 'form-section' }, 'Widok interfejsu (zapisywany w tej przeglądarce)'),
      el('div', { class: 'form-grid cols-2' },
        formField('Widok', presetSel, 'Prosty: wysyłka, odbiór i treść wiadomości. Standardowy: do tego ramka, filtry, eksport i scenariusze. Pełny: wszystko. Zmiana pola poniżej przełącza na Własny.'),
        el('div', { class: 'form-field' }, el('label', {}, 'Widoczne elementy'), countEl)),
      groups,
      el('h3', { class: 'form-section' }, 'Progi czasów odpowiedzi (zapisywane na serwerze)'),
      el('div', { class: 'form-grid cols-2' },
        formField('Próg ostrzeżenia (ms)', warn, 'Czasy >= progu są oznaczane na żółto.'),
        formField('Próg błędu (ms)', bad, 'Czasy >= progu są oznaczane na czerwono.')),
      el('h3', { class: 'form-section' }, 'Wyświetlanie (zapisywane w tej przeglądarce)'),
      el('div', { class: 'form-grid cols-1' },
        formField('Pokazuj zdarzenia bytes.in / bytes.out', showBytes, 'Wyłącz przy dużym ruchu; eksport również je pominie.'),
        formField('Czas w UTC zamiast lokalnego', utc, 'Dotyczy osi czasu, inspektora, kart i zegara w górnym pasku.')),
      el('div', { class: 'dim small' },
        `Zegar serwera: korekta ${offset >= 0 ? '+' : ''}${Math.round(offset)} ms względem przeglądarki` +
        `${Number.isFinite(ws.getRttMs()) ? `, RTT WebSocket ${formatMs(ws.getRttMs())}` : ''}. ` +
        'Czasy odpowiedzi są liczone na serwerze z zegara monotonicznego, niezależnie od tej korekty.'),
    );
    const modal = openModal({
      title: 'Ustawienia',
      body,
      wide: true,
      // closing without Zapisz takes back the view tried out in this window
      onClose: () => {
        if (saved) return;
        settings.view = viewBefore;
        applyView({ save: false });
      },
      actions: [
        { label: 'Anuluj', onClick: (close) => close() },
        {
          label: 'Zapisz',
          primary: true,
          onClick: async (close) => {
            setFieldError(warn, '');
            setFieldError(bad, '');
            const w = toInt(warn.value, NaN);
            const b = toInt(bad.value, NaN);
            let ok = true;
            if (!Number.isFinite(w) || w < 1) {
              setFieldError(warn, 'Podaj liczbę >= 1.');
              ok = false;
            }
            if (!Number.isFinite(b) || b < 1) {
              setFieldError(bad, 'Podaj liczbę >= 1.');
              ok = false;
            }
            if (ok && w >= b) {
              setFieldError(bad, 'Próg błędu musi być większy od progu ostrzeżenia.');
              ok = false;
            }
            if (!ok) return;
            modal.setBusy(true);
            try {
              if (w !== settings.warnMs || b !== settings.badMs) {
                const ui = await api.updateUiConfig({ latencyThresholds: { warnMs: w, badMs: b } });
                const th = ui && ui.latencyThresholds ? ui.latencyThresholds : { warnMs: w, badMs: b };
                settings.warnMs = Number.isFinite(th.warnMs) ? th.warnMs : w;
                settings.badMs = Number.isFinite(th.badMs) ? th.badMs : b;
              }
              settings.showBytes = showBytes.checked;
              settings.utc = utc.checked;
              saveSettings();
              timeline.refresh();
              inspector.refresh();
              listeners.render();
              notify('Ustawienia zapisane', 'info');
              saved = true;
              close();
            } catch (err) {
              modal.setError(`Nie udało się zapisać progów na serwerze: ${err.message}`);
            } finally {
              modal.setBusy(false);
            }
          },
        },
      ],
    });
  }

  // ---- left panel sections -------------------------------------------------------------------

  function setPanelExpanded(section, expanded) {
    const name = section.dataset.panel;
    section.classList.toggle('collapsed', !expanded);
    const toggle = section.querySelector('.panel-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(expanded));
    if (name) {
      settings.panels[name] = expanded;
      saveSettings();
    }
  }

  document.querySelectorAll('.panel[data-panel]').forEach((section) => {
    const name = section.dataset.panel;
    const expanded = settings.panels[name] !== false;
    section.classList.toggle('collapsed', !expanded);
    const toggle = section.querySelector('.panel-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.addEventListener('click', () => setPanelExpanded(section, section.classList.contains('collapsed')));
    }
  });

  // ---- inspector resize ----------------------------------------------------------------------

  handleEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handleEl.setPointerCapture(e.pointerId);
    handleEl.classList.add('dragging');
    document.body.classList.add('resizing');
    const onMove = (ev) => {
      if (mq.matches) {
        const rect = mainEl.getBoundingClientRect();
        const h = Math.round(Math.min(Math.max(rect.bottom - ev.clientY, 160), rect.height - 120));
        settings.inspectorH = h;
        docEl.style.setProperty('--inspector-h', `${h}px`);
      } else {
        const w = Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 320), window.innerWidth * 0.7));
        settings.inspectorW = w;
        docEl.style.setProperty('--inspector-w', `${w}px`);
      }
    };
    const onUp = (ev) => {
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup', onUp);
      handleEl.removeEventListener('pointercancel', onUp);
      try {
        handleEl.releasePointerCapture(ev.pointerId);
      } catch (err) {
        // capture already released
      }
      handleEl.classList.remove('dragging');
      document.body.classList.remove('resizing');
      saveSettings();
    };
    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup', onUp);
    handleEl.addEventListener('pointercancel', onUp);
  });
  handleEl.addEventListener('dblclick', () => {
    settings.inspectorW = DEFAULT_SETTINGS.inspectorW;
    settings.inspectorH = DEFAULT_SETTINGS.inspectorH;
    docEl.style.setProperty('--inspector-w', `${settings.inspectorW}px`);
    docEl.style.setProperty('--inspector-h', `${settings.inspectorH}px`);
    saveSettings();
  });

  // ---- keyboard ---------------------------------------------------------------------------------

  document.addEventListener('keydown', (e) => {
    if (modalStack.length) {
      if (e.key === 'Escape') {
        e.preventDefault();
        modalStack[modalStack.length - 1].close();
      }
      return;
    }
    const target = e.target;
    const tag = target && target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);
    if (typing) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        timeline.moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        timeline.moveSelection(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        timeline.moveSelection(20);
        break;
      case 'PageUp':
        e.preventDefault();
        timeline.moveSelection(-20);
        break;
      case 'End':
        e.preventDefault();
        timeline.resume();
        break;
      case ' ':
        if (target === document.body || target === timeline.element) {
          e.preventDefault();
          togglePause();
        }
        break;
      case 'Escape':
        timeline.deselect();
        inspector.clear();
        break;
      case '/':
        if (view.isHidden('top.filters')) break;
        e.preventDefault();
        showFilters(true);
        {
          const input = filtersEl.querySelector('.filter-text');
          if (input) input.focus();
        }
        break;
      case 'i':
        if (!e.ctrlKey && !e.metaKey && !e.altKey) btnInspector.click();
        break;
      default:
        break;
    }
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('Nieobsłużony błąd', e.reason);
  });

  inspector.clear();
  updateCounter();
}

try {
  init();
} catch (err) {
  console.error(err);
  const box = document.createElement('pre');
  box.style.cssText = 'color:#f85149;padding:16px;font:13px monospace;white-space:pre-wrap';
  box.textContent = `Błąd inicjalizacji interfejsu: ${err && err.stack ? err.stack : err}`;
  document.body.prepend(box);
}
