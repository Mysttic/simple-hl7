// Formatting helpers, Polish labels per event type and small DOM utilities shared by all UI modules.
// Browser-only ESM, no dependencies.

// ---------------------------------------------------------------------------
// Event types (order used by filters) and Polish labels
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'system.started',
  'system.info',
  'system.error',
  'listener.started',
  'listener.stopped',
  'listener.error',
  'conn.open',
  'conn.close',
  'conn.error',
  'bytes.in',
  'bytes.out',
  'frame.garbage',
  'frame.incomplete',
  'msg.in',
  'ack.out',
  'ack.skipped',
  'sender.connect',
  'msg.out',
  'ack.in',
  'ack.timeout',
  'sender.error',
  'scenario.start',
  'scenario.step',
  'scenario.end',
];

export const TYPE_LABELS = {
  'system.started': 'Start systemu',
  'system.info': 'Info systemu',
  'system.error': 'Błąd systemu',
  'listener.started': 'Nasłuch uruchomiony',
  'listener.stopped': 'Nasłuch zatrzymany',
  'listener.error': 'Błąd nasłuchu',
  'conn.open': 'Połączenie otwarte',
  'conn.close': 'Połączenie zamknięte',
  'conn.error': 'Błąd połączenia',
  'bytes.in': 'Bajty odebrane',
  'bytes.out': 'Bajty wysłane',
  'frame.garbage': 'Bajty poza ramką',
  'frame.incomplete': 'Niekompletna ramka',
  'msg.in': 'Wiadomość odebrana',
  'ack.out': 'ACK wysłany',
  'ack.skipped': 'ACK pominięty',
  'sender.connect': 'Połączenie nadawcy',
  'msg.out': 'Wiadomość wysłana',
  'ack.in': 'ACK odebrany',
  'ack.timeout': 'Brak ACK (timeout)',
  'sender.error': 'Błąd nadawcy',
  'scenario.start': 'Scenariusz: start',
  'scenario.step': 'Scenariusz: krok',
  'scenario.end': 'Scenariusz: koniec',
};

export const MESSAGE_EVENT_TYPES = new Set(['msg.in', 'ack.out', 'msg.out', 'ack.in']);

export const LEVEL_LABELS = { info: 'Info', warn: 'Ostrzeżenie', error: 'Błąd' };

export const SOURCE_LABELS = { listener: 'nasłuch', sender: 'nadawca', scenario: 'scenariusz', system: 'system' };

export const ENCODINGS = ['utf8', 'cp1250', 'iso88592', 'latin1', 'windows1252', 'ascii'];

export const ENCODING_LABELS = {
  utf8: 'UTF-8',
  cp1250: 'CP1250 (Windows-1250)',
  iso88592: 'ISO-8859-2 (Latin-2)',
  latin1: 'ISO-8859-1 (Latin-1)',
  windows1252: 'Windows-1252',
  ascii: 'ASCII',
};

export const ACK_CODE_LABELS = {
  AA: 'Application Accept',
  AE: 'Application Error',
  AR: 'Application Reject',
  CA: 'Commit Accept',
  CE: 'Commit Error',
  CR: 'Commit Reject',
};

export const CTRL_NAMES = {
  0x00: 'NUL', 0x01: 'SOH', 0x02: 'STX', 0x03: 'ETX', 0x04: 'EOT', 0x05: 'ENQ', 0x06: 'ACK', 0x07: 'BEL',
  0x08: 'BS', 0x09: 'TAB', 0x0a: 'LF', 0x0b: 'VT', 0x0c: 'FF', 0x0d: 'CR', 0x0e: 'SO', 0x0f: 'SI',
  0x10: 'DLE', 0x11: 'DC1', 0x12: 'DC2', 0x13: 'DC3', 0x14: 'DC4', 0x15: 'NAK', 0x16: 'SYN', 0x17: 'ETB',
  0x18: 'CAN', 0x19: 'EM', 0x1a: 'SUB', 0x1b: 'ESC', 0x1c: 'FS', 0x1d: 'GS', 0x1e: 'RS', 0x1f: 'US',
  0x7f: 'DEL',
};

export function typeLabel(type) {
  return TYPE_LABELS[type] || type || '';
}

export function typeClass(type) {
  return 'type-' + String(type || 'unknown').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

export function levelLabel(level) {
  return LEVEL_LABELS[level] || level || '';
}

export function isMessageEvent(ev) {
  return !!ev && MESSAGE_EVENT_TYPES.has(ev.type) && !!ev.data && typeof ev.data.text === 'string';
}

export function controlGlyph(code) {
  switch (code) {
    case 0x0b: return '␋';
    case 0x1c: return '␜';
    case 0x0d: return '␍';
    case 0x0a: return '␊';
    case 0x1e: return '␞';
    case 0x09: return '␉';
    case 0x00: return '␀';
    case 0x7f: return '␡';
    default:
      if (code >= 0 && code < 0x20) return String.fromCharCode(0x2400 + code);
      return '�';
  }
}

export function controlName(code) {
  const name = CTRL_NAMES[code];
  const hex = code.toString(16).toUpperCase().padStart(2, '0');
  return name ? `0x${hex} (${name})` : `0x${hex}`;
}

// ---------------------------------------------------------------------------
// Numbers, time, bytes
// ---------------------------------------------------------------------------

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

export function toDate(ts) {
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') return new Date(ts);
  if (typeof ts === 'string' && ts) return new Date(ts);
  return new Date(NaN);
}

export function formatTime(ts, utc = false) {
  const d = toDate(ts);
  if (Number.isNaN(d.getTime())) return '--:--:--.---';
  const h = utc ? d.getUTCHours() : d.getHours();
  const m = utc ? d.getUTCMinutes() : d.getMinutes();
  const s = utc ? d.getUTCSeconds() : d.getSeconds();
  const ms = utc ? d.getUTCMilliseconds() : d.getMilliseconds();
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

export function formatDateTime(ts, utc = false) {
  const d = toDate(ts);
  if (Number.isNaN(d.getTime())) return '';
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const mo = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const da = utc ? d.getUTCDate() : d.getDate();
  return `${y}-${pad(mo)}-${pad(da)} ${formatTime(d, utc)}${utc ? ' UTC' : ''}`;
}

// Number and unit are joined with a no-break space so a value never wraps between them.
export function formatMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  const abs = Math.abs(ms);
  if (abs < 1) return `${ms.toFixed(2)}\u00A0ms`;
  if (abs < 100) return `${ms.toFixed(1)}\u00A0ms`;
  if (abs < 1000) return `${Math.round(ms)}\u00A0ms`;
  if (abs < 60000) return `${(ms / 1000).toFixed(2)}\u00A0s`;
  const min = Math.floor(abs / 60000);
  const sec = Math.round((abs % 60000) / 1000);
  return `${ms < 0 ? '-' : ''}${min} min ${sec} s`;
}

export function formatDelta(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  return `+${formatMs(ms)}`;
}

export function formatBytes(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n}\u00A0B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}\u00A0KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}\u00A0MB`;
}

export function formatNumber(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat('pl-PL').format(n);
}

/** Polish plural: pluralPl(1, 'krok', 'kroki', 'kroków') -> '1 krok', 3 -> '3 kroki', 5 -> '5 kroków'. */
export function pluralPl(n, one, few, many) {
  if (n === null || n === undefined || !Number.isFinite(n)) return `? ${many}`;
  const abs = Math.abs(Math.trunc(n));
  const last = abs % 10;
  const lastTwo = abs % 100;
  let word = many;
  if (abs === 1) word = one;
  else if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) word = few;
  return `${abs} ${word}`;
}

export function latencyClass(ms, thresholds) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  const warn = Number(thresholds && thresholds.warnMs) || 300;
  const bad = Number(thresholds && thresholds.badMs) || 1000;
  if (ms >= bad) return 'lat-bad';
  if (ms >= warn) return 'lat-warn';
  return 'lat-ok';
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

/** Parse a user-typed hex string. Accepts "0B", "0b", "0x0B", "0B 1C 0D", "0B,1C,0D", "0x1C 0x0D". */
export function parseHexInput(value) {
  const raw = String(value === null || value === undefined ? '' : value);
  const cleaned = raw.replace(/0x/gi, '').replace(/[\s,;:_-]+/g, '').toUpperCase();
  if (cleaned === '') return { ok: true, hex: '' };
  if (!/^[0-9A-F]+$/.test(cleaned)) return { ok: false, hex: null, error: 'Dozwolone tylko znaki 0-9 i A-F' };
  if (cleaned.length % 2 !== 0) return { ok: false, hex: null, error: 'Nieparzysta liczba znaków hex' };
  return { ok: true, hex: cleaned };
}

export function spacedHex(hex) {
  if (hex === null || hex === undefined) return '';
  const clean = String(hex).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (!clean) return '';
  return clean.replace(/(..)/g, '$1 ').trim();
}

export function hexOrNone(hex) {
  const s = spacedHex(hex);
  return s || 'brak';
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

export function controlIdsOf(ev) {
  const d = (ev && ev.data) || {};
  const ids = new Set();
  if (d.summary && d.summary.controlId) ids.add(String(d.summary.controlId));
  if (d.inReplyTo) ids.add(String(d.inReplyTo));
  if (d.validation && d.validation.msa2) ids.add(String(d.validation.msa2));
  if (d.controlId) ids.add(String(d.controlId));
  return [...ids].filter(Boolean);
}

export function bytesOf(ev) {
  if (!ev || !ev.data) return null;
  const d = ev.data;
  switch (ev.type) {
    case 'msg.in':
    case 'msg.out':
    case 'ack.in':
    case 'ack.out':
      return d.raw && Number.isFinite(d.raw.length) ? d.raw.length : null;
    case 'bytes.in':
    case 'bytes.out':
    case 'frame.garbage':
    case 'frame.incomplete':
      return Number.isFinite(d.length) ? d.length : null;
    case 'conn.close':
      return Number.isFinite(d.bytesIn) || Number.isFinite(d.bytesOut) ? (d.bytesIn || 0) + (d.bytesOut || 0) : null;
    case 'ack.timeout':
      return Number.isFinite(d.partialLength) ? d.partialLength : null;
    default:
      return null;
  }
}

/** MSA-1 extracted from ACK text (works for custom ACK templates too). */
export function msa1Of(text) {
  if (typeof text !== 'string') return null;
  const m = /(?:^|[\r\n])MSA\|([^|\r\n]*)/.exec(text);
  return m ? m[1] : null;
}

export function messageTypeOf(summary) {
  if (!summary) return '';
  const t = summary.messageType || '';
  const e = summary.triggerEvent || '';
  if (t && e) return `${t}^${e}`;
  return t || e || summary.messageStructure || '';
}

export function connCounter(connId) {
  if (!connId) return '';
  const i = String(connId).lastIndexOf('#');
  return i >= 0 ? String(connId).slice(i) : '';
}

const REASON_LABELS = {
  close: 'zamknięcie połączenia',
  idle: 'bezczynność',
  timeout: 'timeout',
  stop: 'zatrzymanie (Stop, zmiana konfiguracji albo wyłączenie programu)',
  'mode none': 'tryb ACK none',
  'ack builder returned null': 'nie udało się zbudować ACK',
  'connection closed before ACK': 'połączenie zamknięte przed wysłaniem ACK',
};

export function reasonLabel(reason) {
  return REASON_LABELS[reason] || reason || '';
}

// Polish labels for event data fields shown by the inspector for events without HL7 content.
export const DATA_LABELS = {
  host: 'Host', port: 'Port', prefixHex: 'Prefiks (hex)', suffixHex: 'Sufiks (hex)', encoding: 'Kodowanie',
  version: 'Wersja', code: 'Kod', message: 'Komunikat', reason: 'Powód', phase: 'Faza', error: 'Błąd',
  remoteAddress: 'Adres zdalny', remotePort: 'Port zdalny', localPort: 'Port lokalny',
  durationMs: 'Czas trwania', bytesIn: 'Bajty odebrane', bytesOut: 'Bajty wysłane', messages: 'Wiadomości',
  hadError: 'Zakończone błędem', length: 'Długość', totalBytesOnConn: 'Razem na połączeniu',
  inReplyTo: 'W odpowiedzi na (MSH-10)', ok: 'Udane', connectMs: 'Czas łączenia',
  ackTimeoutMs: 'Timeout ACK', partialLength: 'Odebrane bajty', partialText: 'Odebrany tekst', controlId: 'Control ID (MSH-10)',
  runId: 'Identyfikator przebiegu', name: 'Nazwa', stepCount: 'Liczba kroków', stepIndex: 'Numer kroku',
  status: 'Status', passed: 'Kroki udane', failed: 'Kroki nieudane', startedTs: 'Początek', startedMono: 'Początek (ms od startu)',
};
const PHASE_LABELS = { connect: 'łączenie', send: 'wysyłka', ack: 'oczekiwanie na ACK' };
const STATUS_LABELS = { passed: 'OK', failed: 'BŁĄD', error: 'BŁĄD WYKONANIA', skipped: 'pominięty', stopped: 'ZATRZYMANY' };

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || '';
}

export function phaseLabel(phase) {
  return PHASE_LABELS[phase] || phase || '';
}

// Server error messages are English (they also go to logs); the UI shows the known ones in Polish.
const ERROR_PATTERNS = [
  [/^Stopped by the user$/, () => 'Zatrzymany przez użytkownika'],
  [/^ACK timeout after (\d+) ms$/, (m) => `Brak ACK po ${m[1]} ms`],
  [/^Connect timeout after (\d+) ms$/, (m) => `Nie udało się połączyć w ${m[1]} ms`],
  [/^Connection closed after (\d+) byte\(s\) of an incomplete ACK \(suffix expected (\w+), got (\w+)\)$/,
    (m) => `Bramka zamknęła połączenie po ${m[1]} B niepełnego ACK (oczekiwany sufiks ${spacedHex(m[2])}, otrzymano ${spacedHex(m[3])})`],
  [/^Connection closed before the message was sent$/, () => 'Połączenie zamknięte przed wysłaniem wiadomości'],
  [/^Connection closed before an ACK was received$/, () => 'Bramka zamknęła połączenie przed wysłaniem ACK'],
  [/^Socket is not connected$/, () => 'Brak połączenia z bramką'],
  [/^Write not flushed within (\d+) ms \(peer is not reading\)$/, (m) => `Wysyłka nie zakończyła się w ${m[1]} ms (bramka nie odbiera danych)`],
  [/ECONNREFUSED\s*(\S*)/, (m) => `Odmowa połączenia${m[1] ? ` z ${m[1]}` : ''}: na tym porcie nikt nie nasłuchuje (ECONNREFUSED)`],
  [/ETIMEDOUT/, () => 'Przekroczony czas łączenia: firewall albo zły adres (ETIMEDOUT)'],
  [/ENOTFOUND\s*(\S*)/, (m) => `Nieznana nazwa hosta${m[1] ? ` ${m[1]}` : ''} (ENOTFOUND)`],
  [/ECONNRESET/, () => 'Bramka zerwała połączenie (ECONNRESET)'],
  [/EHOSTUNREACH/, () => 'Host nieosiągalny (EHOSTUNREACH)'],
];

const hexPl = (h) => (h === '<none>' || h === 'none' || h === '' ? 'brak' : spacedHex(h));
const emptyPl = (v) => (v === 'empty' ? 'puste' : v);

// Framing warnings, encoding warnings, ACK validation problems and common parser warnings.
const MESSAGE_PATTERNS = [
  [/^Prefix mismatch: expected (\w+), got (.+)$/, (m) => `Prefiks niezgodny: oczekiwano ${hexPl(m[1])}, otrzymano ${hexPl(m[2])}`],
  [/^Expected prefix (\w+) found at offset (\d+): (\d+) leading byte\(s\) before it$/, (m) => `Oczekiwany prefiks ${hexPl(m[1])} jest na pozycji ${m[2]}, przed nim ${m[3]} B`],
  [/^Suffix mismatch: expected (\w+), got (.+)$/, (m) => `Sufiks niezgodny: oczekiwano ${hexPl(m[1])}, otrzymano ${hexPl(m[2])}`],
  [/^Expected suffix (\w+) found at offset (\d+), followed by (\d+) trailing byte\(s\)$/, (m) => `Oczekiwany sufiks ${hexPl(m[1])} jest na pozycji ${m[2]}, po nim ${m[3]} B`],
  [/^Empty payload$/, () => 'Pusta treść ramki'],
  [/^Payload does not start with MSH \(starts with (.+)\)$/, (m) => `Treść nie zaczyna się od MSH (zaczyna się od ${m[1]})`],
  [/^Segments separated by LF instead of CR$/, () => 'Segmenty rozdzielone LF zamiast CR'],
  [/^Segments separated by CRLF instead of CR$/, () => 'Segmenty rozdzielone CRLF zamiast CR'],
  [/^Mixed segment separators \(CR, LF and CRLF\)$/, () => 'Mieszane separatory segmentów (CR, LF i CRLF)'],
  [/^No segment separator found/, () => 'Brak separatora segmentów (jeden segment bez końcowego CR albo nieznany format)'],
  [/^Missing trailing CR before suffix$/, () => 'Brak CR przed sufiksem'],
  [/^Missing trailing segment separator before suffix$/, () => 'Brak separatora segmentu przed sufiksem'],
  [/^(\d+) unexpected control character\(s\) inside payload \(first at offset (\d+): (\w+)\)$/, (m) => `Nieoczekiwane znaki sterujące w treści: ${m[1]} (pierwszy na pozycji ${m[2]}: ${m[3]})`],
  [/^Prefix (\w+) occurs inside the payload at offset (\d+)/, (m) => `Prefiks ${hexPl(m[1])} występuje w treści na pozycji ${m[2]}: prawdopodobnie dwie wiadomości bez sufiksu między nimi`],
  [/^Unknown character set in MSH-18: "(.*)"$/, (m) => `Nieznany zestaw znaków w MSH-18: "${m[1]}"`],
  [/^Unknown encoding configured: "(.*)"$/, (m) => `Nieznane kodowanie w konfiguracji: "${m[1]}"`],
  [/^MSH-18 declares (.+) \((\w+)\) but payload was decoded as (\w+)$/, (m) => `MSH-18 deklaruje ${m[1]} (${m[2]}), a treść zdekodowano jako ${m[3]}`],
  [/^MSH-18 declares ASCII but payload contains (\d+) non-ASCII bytes$/, (m) => `MSH-18 deklaruje ASCII, a treść ma ${m[1]} bajtów spoza ASCII`],
  [/^MSH-18 declares (.+) but payload contains (\d+) valid UTF-8 multibyte sequences/, (m) => `MSH-18 deklaruje ${m[1]}, a treść zawiera ${m[2]} sekwencji UTF-8 (wygląda na UTF-8)`],
  [/^MSH-18 declares (.+) but payload contains (\d+) invalid UTF-8 bytes/, (m) => `MSH-18 deklaruje ${m[1]}, a treść ma ${m[2]} bajtów niepoprawnych w UTF-8 (wygląda na kodowanie jednobajtowe, np. cp1250 lub iso88592)`],
  [/^Decoded as ascii but payload contains (\d+) non-ASCII bytes/, (m) => `Zdekodowano jako ASCII, a treść ma ${m[1]} bajtów spoza ASCII; w tekście są znaki zastępcze`],
  [/^Decoded as utf8 but payload contains (\d+) invalid UTF-8 bytes/, (m) => `Zdekodowano jako UTF-8, a treść ma ${m[1]} bajtów niepoprawnych w UTF-8; w tekście są znaki zastępcze (prawdopodobnie cp1250 lub iso88592)`],
  [/^Decoded as (\w+) but payload looks like UTF-8 \((\d+) valid multibyte sequences\)/, (m) => `Zdekodowano jako ${m[1]}, a treść wygląda na UTF-8 (${m[2]} sekwencji wielobajtowych); polskie znaki są prawdopodobnie zniekształcone`],
  [/^No MSH segment in ACK$/, () => 'ACK nie ma segmentu MSH'],
  [/^No MSA segment in ACK$/, () => 'ACK nie ma segmentu MSA'],
  [/^MSA-1 is (.+?), expected AA or CA(?: \(MSA-3: (.*)\))?$/, (m) => `MSA-1 ma wartość ${emptyPl(m[1])}, oczekiwano AA lub CA${m[2] ? ` (MSA-3: ${m[2]})` : ''}`],
  [/^MSA-2 (.+) does not match sent MSH-10 (.+)$/, (m) => `MSA-2 (${emptyPl(m[1])}) nie zgadza się z wysłanym MSH-10 (${emptyPl(m[2])})`],
  [/^ACK message type is (.+), expected ACK$/, (m) => `Typ wiadomości ACK to ${m[1]}, oczekiwano ACK`],
  [/^ACK prefix mismatch: expected (\w+), got (\w+)$/, (m) => `Prefiks ACK niezgodny: oczekiwano ${hexPl(m[1])}, otrzymano ${hexPl(m[2])}`],
  [/^ACK suffix mismatch: expected (\w+), got (\w+)$/, (m) => `Sufiks ACK niezgodny: oczekiwano ${hexPl(m[1])}, otrzymano ${hexPl(m[2])}`],
  [/^ACK could not be parsed$/, () => 'Nie udało się odczytać ACK'],
  [/^Leading MLLP start byte \(0x0B\) found in text and ignored$/, () => 'Na początku tekstu był bajt startu MLLP (0x0B), pominięto go'],
  [/^Trailing MLLP end byte \(0x1C\) found in text and ignored$/, () => 'Na końcu tekstu był bajt końca MLLP (0x1C), pominięto go'],
  [/^Leading byte order mark \(U\+FEFF\) found in text and ignored$/, () => 'Na początku tekstu był znacznik BOM (U+FEFF), pominięto go'],
  [/^No MSH segment found, using default delimiters$/, () => 'Brak segmentu MSH, przyjęto domyślne separatory'],
  [/^MSH segment is truncated, using default delimiters$/, () => 'Segment MSH jest ucięty, przyjęto domyślne separatory'],
  [/^First segment is (\S+), expected MSH$/, (m) => `Pierwszy segment to ${m[1]}, oczekiwano MSH`],
  [/^Line (\d+) does not start with a segment name: "(.*)"$/, (m) => `Linia ${m[1]} nie zaczyna się od nazwy segmentu: "${m[2]}"`],
  [/^Line (\d+) is empty$/, (m) => `Linia ${m[1]} jest pusta`],
  [/^Message is empty$/, () => 'Wiadomość jest pusta'],
];

/** Polish text for a known server message (errors, warnings, ACK problems), otherwise the message unchanged. */
export function errorPl(message) {
  const text = String(message ?? '');
  for (const [re, fmt] of ERROR_PATTERNS) {
    const m = re.exec(text);
    if (m) return fmt(m);
  }
  for (const [re, fmt] of MESSAGE_PATTERNS) {
    const m = re.exec(text);
    if (m) return fmt(m);
  }
  return text;
}

export const messagePl = errorPl;

const VARIANTS_PL = {
  'MLLP standard (0B / 1C 0D)': 'standard MLLP (0B / 1C 0D)',
  'MLLP with extra LF (0B / 1C 0D 0A)': 'MLLP z dodatkowym LF (0B / 1C 0D 0A)',
  'MLLP without trailing CR (0B / 1C)': 'MLLP bez końcowego CR (0B / 1C)',
  'STX / ETX (02 / 03)': 'STX / ETX (02 / 03)',
  'no framing': 'bez ramki',
  'prefix 0B, no suffix (ends with CR)': 'prefiks 0B, bez sufiksu (koniec na CR)',
  'prefix 0B, suffix 0D 0A (CRLF, no FS)': 'prefiks 0B, sufiks 0D 0A (CRLF, bez FS)',
  'prefix 0B, unknown suffix': 'prefiks 0B, nieznany sufiks',
  'suffix 0D 0A (CRLF, no FS)': 'sufiks 0D 0A (CRLF, bez FS)',
  'suffix 1C 0D only (no prefix)': 'tylko sufiks 1C 0D (bez prefiksu)',
  'suffix 1C only': 'tylko sufiks 1C',
};

/** Polish name of a recognised framing variant (framing.knownVariant). */
export function variantPl(variant) {
  return VARIANTS_PL[variant] || variant || '';
}

const SEPARATORS_PL = { CR: 'CR', LF: 'LF', CRLF: 'CRLF', mixed: 'mieszany', none: 'brak' };

/** Polish name of a segment separator value (framing.segmentSeparator). */
export function separatorPl(sep) {
  return SEPARATORS_PL[sep] || sep || '';
}

function framingNotes(framing) {
  if (!framing) return [];
  const notes = [];
  if (framing.prefixOk === false) {
    notes.push(`Prefix niezgodny: oczekiwano ${hexOrNone(framing.prefixHexExpected)}, otrzymano ${hexOrNone(framing.prefixHexActual)}`);
  }
  if (framing.suffixOk === false) {
    notes.push(`Suffix niezgodny: oczekiwano ${hexOrNone(framing.suffixHexExpected)}, otrzymano ${hexOrNone(framing.suffixHexActual)}`);
  }
  if (framing.segmentSeparator && framing.segmentSeparator !== 'CR' && framing.segmentSeparator !== 'none') {
    notes.push(`separator segmentów ${separatorPl(framing.segmentSeparator)}`);
  }
  return notes;
}

function describeMessage(d) {
  const s = d && d.summary;
  if (!s) return null;
  const type = messageTypeOf(s) || 'HL7';
  const ctrl = s.controlId ? ` ctrl ${s.controlId}` : '';
  return `${type}${ctrl}`;
}

/** Polish one-line summary built from type and data (falls back to the English server summary). */
export function summaryPl(ev) {
  if (!ev) return '';
  const d = ev.data || {};
  const bytes = bytesOf(ev);
  const sizeTxt = bytes !== null ? ` (${formatBytes(bytes)})` : '';
  try {
    switch (ev.type) {
      case 'system.started':
        return `Serwer uruchomiony${d.web ? ` na ${d.web.host}:${d.web.port}` : ''}${d.version ? `, wersja ${d.version}` : ''}`;
      case 'system.info':
        return `System: ${d.message || ev.summary || 'informacja'}`;
      case 'system.error':
        return `Błąd systemu: ${d.code ? `${d.code} ` : ''}${d.message || ev.summary || 'nieznany błąd'}${d.method && d.path ? ` (${d.method} ${d.path})` : ''}`;
      case 'listener.started':
        return `Nasłuch uruchomiony na ${d.host}:${d.port} (prefix ${hexOrNone(d.prefixHex)}, suffix ${hexOrNone(d.suffixHex)}, ${d.encoding || 'utf8'}, ACK ${d.ack && d.ack.mode ? d.ack.mode : 'AA'})`;
      case 'listener.stopped':
        return `Nasłuch zatrzymany${d.reason ? ` (${d.reason})` : ''}`;
      case 'listener.error':
        return `Błąd nasłuchu: ${d.code ? `${d.code} ` : ''}${d.message || ev.summary}`;
      case 'conn.open':
        return ev.source === 'sender'
          ? `Połączono z ${d.remoteAddress}:${d.remotePort}${d.localPort ? ` (port lokalny ${d.localPort})` : ''}`
          : `Nowe połączenie od ${d.remoteAddress}:${d.remotePort}${d.localPort ? ` na port ${d.localPort}` : ''}`;
      case 'conn.close':
        return `Połączenie zamknięte po ${formatMs(d.durationMs)}: ${d.messages ?? 0} wiad., ${formatBytes(d.bytesIn || 0)} in / ${formatBytes(d.bytesOut || 0)} out${d.hadError ? ', z błędem' : ''}`;
      case 'conn.error':
        return `Błąd połączenia: ${errorPl(d.message || ev.summary)}`;
      case 'bytes.in':
        return `Odebrano ${formatBytes(d.length)}${Number.isFinite(d.totalBytesOnConn) ? `, razem na połączeniu ${formatBytes(d.totalBytesOnConn)}` : ''}${d.previewHex ? ` [${spacedHex(d.previewHex).slice(0, 23)}${d.length > 8 ? ' ...' : ''}]` : ''}`;
      case 'bytes.out':
        return `Wysłano ${formatBytes(d.length)}${d.previewHex ? ` [${spacedHex(d.previewHex).slice(0, 23)}${d.length > 8 ? ' ...' : ''}]` : ''}`;
      case 'frame.garbage':
        return `Nieoczekiwane bajty od bramki: ${formatBytes(d.length)} [${spacedHex(d.hex).slice(0, 23)}${d.length > 8 ? ' ...' : ''}]`;
      case 'frame.incomplete':
        return `Niekompletna ramka: ${formatBytes(d.length)} bez sufiksu, przyczyna: ${REASON_LABELS[d.reason] || d.reason || 'nieznana'}${framingNotes(d.framing).length ? ' · ' + framingNotes(d.framing).join(' · ') : ''}`;
      case 'msg.in': {
        const desc = describeMessage(d);
        const base = desc
          ? `Odebrano ${desc}${sizeTxt}`
          : `Odebrano nieparsowalną wiadomość${sizeTxt}${d.parseError ? `: ${d.parseError}` : ''}`;
        const notes = framingNotes(d.framing);
        return notes.length ? `${base} · ${notes.join(' · ')}` : base;
      }
      case 'ack.out': {
        const code = msa1Of(d.text) || (d.mode && d.mode !== 'custom' ? d.mode : 'ACK');
        const delay = d.delayMs > 0 ? `, opóźnienie ${formatMs(d.delayMs)}` : '';
        return `Wysłano ACK ${code} po ${formatMs(d.processingMs)}${delay}${d.inReplyTo ? ` (na ${d.inReplyTo})` : ''}`;
      }
      case 'ack.skipped':
        return `ACK pominięty${d.inReplyTo ? ` dla ${d.inReplyTo}` : ''} (${REASON_LABELS[d.reason] || d.reason || 'tryb ACK none'})`;
      case 'sender.connect':
        return d.ok
          ? `Połączono z ${d.host}:${d.port} w ${formatMs(d.connectMs)}`
          : `Nie udało się połączyć z ${d.host}:${d.port}${d.error ? `: ${d.error}` : ''}`;
      case 'msg.out': {
        const desc = describeMessage(d) || 'wiadomość';
        const rep = Number.isFinite(d.repeatIndex) && d.repeatIndex > 0 ? ` [#${d.repeatIndex + 1}]` : '';
        const att = Number.isFinite(d.attempt) && d.attempt > 1 ? ` (próba ${d.attempt})` : '';
        const notes = framingNotes(d.framing);
        return `Wysłano ${desc}${sizeTxt}${rep}${att}${notes.length ? ' · ' + notes.join(' · ') : ''}`;
      }
      case 'ack.in': {
        const v = d.validation || {};
        const code = v.msa1 || msa1Of(d.text) || '?';
        const t = d.timing || {};
        const parts = [`ACK ${code} otrzymano po ${formatMs(t.ackMs ?? ev.latencyMs)}`];
        if (v.controlIdMatches === false) parts.push('MSA-2 niezgodne z MSH-10');
        if (v.framingOk === false) parts.push('błędne ramkowanie ACK');
        const notes = framingNotes(d.framing);
        return parts.concat(notes).join(' · ');
      }
      case 'ack.timeout':
        return `Brak ACK po ${formatMs(d.ackTimeoutMs)}${d.controlId ? ` (ctrl ${d.controlId})` : ''}${d.partialLength ? `, odebrano ${formatBytes(d.partialLength)} bez sufiksu` : ', nie odebrano żadnych bajtów'}`;
      case 'sender.error':
        return `Błąd nadawcy (${phaseLabel(d.phase)}): ${errorPl(d.message || ev.summary)}`;
      case 'scenario.start':
        return `Scenariusz "${d.name}" rozpoczęty (${pluralPl(d.stepCount, 'krok', 'kroki', 'kroków')})`;
      case 'scenario.step':
        return `Krok ${Number.isFinite(d.stepIndex) ? d.stepIndex + 1 : '?'} "${d.name}": ${statusLabel(d.status)} w ${formatMs(d.durationMs)}${Array.isArray(d.assertions) && d.assertions.length ? `, asercje ${d.assertions.filter((a) => a.ok).length}/${d.assertions.length}` : ''}`;
      case 'scenario.end':
        return `Scenariusz zakończony: ${statusLabel(d.status)}, ${d.passed ?? 0} OK / ${d.failed ?? 0} błędów w ${formatMs(d.durationMs)}`;
      default:
        return ev.summary || ev.type;
    }
  } catch (err) {
    return ev.summary || ev.type || '';
  }
}

export function directionArrow(ev) {
  if (!ev || !ev.direction) return '';
  return ev.direction === 'in' ? '←' : '→';
}

// ---------------------------------------------------------------------------
// DOM helpers (never use innerHTML with data; everything goes through textContent)
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function append(node, children) {
  if (children === null || children === undefined || children === false) return node;
  if (Array.isArray(children)) {
    for (const c of children) append(node, c);
    return node;
  }
  if (children instanceof Node) {
    node.appendChild(children);
    return node;
  }
  node.appendChild(document.createTextNode(String(children)));
  return node;
}

/**
 * el('div', { class: 'x', title: 't', onClick: fn, dataset: { id: 1 } }, child, 'text', [more])
 * Attribute values null/undefined/false are skipped; true sets an empty attribute.
 */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'value' && 'value' in node) node.value = value;
      else if (key === 'checked' && 'checked' in node) node.checked = !!value;
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

export function clear(node) {
  if (node) node.textContent = '';
  return node;
}

export function badge(text, cls = '', title = null) {
  return el('span', { class: `badge ${cls}`.trim(), title }, text);
}

/** Label and value; opts.view is the view key that hides the pair (see view.js). */
export function kv(label, value, opts = {}) {
  return el('div', { class: `kv ${opts.class || ''}`.trim(), 'data-view': opts.view || null },
    el('div', { class: 'kv-label' }, label),
    el('div', { class: `kv-value ${opts.mono ? 'mono' : ''}`.trim(), title: opts.title || null }, value),
  );
}

/** Labelled form field; opts.class adds classes, opts.view is the view key that hides it (see view.js). */
export function formField(label, input, hint = null, opts = {}) {
  const field = el('div', { class: `form-field ${opts.class || ''}`.trim(), 'data-view': opts.view || null });
  if (input && input.type === 'checkbox') {
    const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
    input.id = id;
    field.classList.add('form-check');
    field.append(el('label', { for: id }, input, el('span', {}, label)));
  } else {
    const id = input && (input.id || `f-${Math.random().toString(36).slice(2, 9)}`);
    if (input) input.id = id;
    field.append(el('label', { for: id }, label));
    if (input) field.append(input);
  }
  if (hint) field.append(el('div', { class: 'form-hint' }, hint));
  field.append(el('div', { class: 'form-error' }));
  return field;
}

export function setFieldError(input, message) {
  const field = input && input.closest ? input.closest('.form-field') : null;
  if (!field) return;
  const errEl = field.querySelector('.form-error');
  if (errEl) errEl.textContent = message || '';
  field.classList.toggle('has-error', !!message);
}

export function inputEl(attrs = {}) {
  return el('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', ...attrs });
}

export function selectEl(options, value, attrs = {}) {
  const sel = el('select', attrs);
  for (const opt of options) {
    const [val, label] = Array.isArray(opt) ? opt : [opt, opt];
    sel.append(el('option', { value: val, selected: String(val) === String(value) ? true : null }, label));
  }
  if (value !== undefined && value !== null) sel.value = String(value);
  return sel;
}

export function checkboxEl(checked, attrs = {}) {
  return el('input', { type: 'checkbox', checked: !!checked, ...attrs });
}

export function debounce(fn, waitMs) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

export function toInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function stringify(value) {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
}

export function safeJson(value, indent = 2) {
  try {
    return JSON.stringify(value, null, indent);
  } catch (err) {
    return `"<nie można zserializować: ${err.message}>"`;
  }
}

const MSH18_MAP = [
  [/^8859\/2$/i, 'iso88592'],
  [/^8859\/1$/i, 'latin1'],
  [/^(UNICODE UTF-8|UTF-8|UTF8|UNICODE)$/i, 'utf8'],
  [/^(CP1250|WINDOWS-1250|WIN-1250)$/i, 'cp1250'],
  [/^(CP1252|WINDOWS-1252)$/i, 'windows1252'],
  [/^ASCII$/i, 'ascii'],
];

/** Map an MSH-18 value to one of ENCODINGS, or null when unknown / empty. */
export function encodingFromMsh18(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  for (const [re, enc] of MSH18_MAP) if (re.test(v)) return enc;
  return null;
}
