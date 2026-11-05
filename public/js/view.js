// Interface view: which parts of the screen are visible. Three presets (Prosty, Standardowy, Pełny)
// and Własny, the user's own set of hidden items. Pure data and helpers, no DOM, so the tests can
// import it.
//
// An element that a view can hide carries data-view="<key>"; with several keys it is hidden when any
// of them is hidden. app.js turns the hidden keys into one CSS rule (viewCss). The timeline columns,
// the connection events and the inspector Hex tab are drawn in code and ask ctx.view.isHidden(key).

export const VIEW_GROUPS = [
  {
    title: 'Górny pasek',
    items: [
      { key: 'top.clock', label: 'Zegar serwera' },
      { key: 'top.counter', label: 'Licznik zdarzeń' },
      { key: 'top.pause', label: 'Przycisk Autoprzewijanie' },
      { key: 'top.filters', label: 'Filtry (przycisk, pasek, przyciski Zdarzenia)' },
      { key: 'top.export', label: 'Eksport' },
      { key: 'top.clear', label: 'Wyczyść' },
    ],
  },
  {
    title: 'Serwer',
    items: [
      { key: 'listeners', label: 'Panel Serwer' },
      { key: 'listeners.framing', label: 'Ramka i kodowanie na kafelku' },
      { key: 'listeners.ack', label: 'Linia ACK i połączeń na kafelku' },
      { key: 'listeners.stats', label: 'Statystyki szczegółowe na kafelku' },
    ],
  },
  {
    title: 'Klient',
    items: [
      { key: 'sender', label: 'Panel Klient' },
      { key: 'sender.framing', label: 'Prefix i suffix' },
      { key: 'sender.ackFraming', label: 'Ramka ACK' },
      { key: 'sender.encoding', label: 'Kodowanie' },
      { key: 'sender.timeouts', label: 'Timeouty' },
      { key: 'sender.series', label: 'Seria (powtórzenia, odstęp, keepAlive)' },
      { key: 'sender.options', label: 'Przełączniki (Oczekuj ACK, Szablony, Auto MSH-10, Normalizuj CR, Loguj bajty)' },
      { key: 'sender.preview', label: 'Przycisk Podgląd szablonu' },
      { key: 'sender.status', label: 'Linia stanu edytora' },
      { key: 'sender.details', label: 'Szczegóły wyniku (ramka ACK, rozmiar, pasek czasów)' },
    ],
  },
  {
    title: 'Scenariusze',
    items: [
      { key: 'scenarios', label: 'Panel Scenariusze' },
    ],
  },
  {
    title: 'Oś czasu',
    items: [
      { key: 'timeline.delta', label: 'Kolumna Δ' },
      { key: 'timeline.endpoint', label: 'Kolumna Punkt' },
      { key: 'timeline.bytes', label: 'Kolumna Bajty' },
      { key: 'timeline.conn', label: 'Zdarzenia połączeń (conn.open, conn.close, sender.connect)' },
    ],
  },
  {
    title: 'Inspektor',
    items: [
      { key: 'inspector.framing', label: 'Znaczki ramki' },
      { key: 'inspector.details', label: 'Dodatkowe pola MSH i czasy' },
      { key: 'inspector.hex', label: 'Zakładka Hex i Kopiuj hex' },
      { key: 'inspector.tools', label: 'Kopiuj JSON i Podgląd ACK' },
    ],
  },
];

export const VIEW_KEYS = VIEW_GROUPS.flatMap((group) => group.items.map((item) => item.key));

// Prosty: sending, receiving and reading a message. Everything about the frame, timings and tools is hidden.
const SIMPLE_HIDDEN = [
  'top.clock', 'top.counter', 'top.pause', 'top.filters', 'top.export',
  'listeners.framing', 'listeners.ack', 'listeners.stats',
  'sender.framing', 'sender.ackFraming', 'sender.timeouts', 'sender.series', 'sender.options',
  'sender.preview', 'sender.status', 'sender.details',
  'scenarios',
  'timeline.delta', 'timeline.endpoint', 'timeline.bytes', 'timeline.conn',
  'inspector.framing', 'inspector.details', 'inspector.hex', 'inspector.tools',
];

// Standardowy: Prosty plus the frame (client, tiles, inspector badges, Hex), the tile statistics,
// timeouts, filters, export, scenarios and the Punkt column.
const STANDARD_HIDDEN = [
  'top.clock', 'top.counter', 'top.pause',
  'listeners.ack',
  'sender.ackFraming', 'sender.series', 'sender.options', 'sender.preview', 'sender.status', 'sender.details',
  'timeline.delta', 'timeline.bytes', 'timeline.conn',
  'inspector.details', 'inspector.tools',
];

export const VIEW_PRESETS = {
  simple: { label: 'Prosty', hidden: SIMPLE_HIDDEN },
  standard: { label: 'Standardowy', hidden: STANDARD_HIDDEN },
  full: { label: 'Pełny', hidden: [] },
};

/** Choices of the view switch, in this order. */
export const VIEW_LABELS = { simple: 'Prosty', standard: 'Standardowy', full: 'Pełny', custom: 'Własny' };

/**
 * A stored view made safe: { preset, custom }. An unknown preset becomes `fallback`; custom keeps
 * only known keys, once each. Własny without its list falls back too, so nothing vanishes by accident.
 */
export function normalizeView(raw, fallback = 'full') {
  const base = Object.hasOwn(VIEW_PRESETS, fallback) ? fallback : 'full';
  if (!raw || typeof raw !== 'object') return { preset: base, custom: null };
  const custom = Array.isArray(raw.custom) ? [...new Set(raw.custom.filter((key) => VIEW_KEYS.includes(key)))] : null;
  let preset = typeof raw.preset === 'string' && Object.hasOwn(VIEW_LABELS, raw.preset) ? raw.preset : base;
  if (preset === 'custom' && !custom) preset = base;
  return { preset, custom };
}

/** Keys hidden by a view (a stored one is normalized first). */
export function hiddenKeys(view) {
  const v = normalizeView(view);
  return new Set(v.preset === 'custom' ? v.custom : VIEW_PRESETS[v.preset].hidden);
}

/** One CSS rule that hides every element tagged with a hidden key; empty when nothing is hidden. */
export function viewCss(hidden) {
  const keys = [...(hidden || [])].filter((key) => VIEW_KEYS.includes(key));
  if (!keys.length) return '';
  return `${keys.map((key) => `[data-view~="${key}"]`).join(',\n')} { display: none !important; }\n`;
}
