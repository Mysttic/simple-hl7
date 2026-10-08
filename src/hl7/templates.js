// Template placeholders for HL7 messages and control id generation. Browser-safe ESM.
// Placeholders: {{controlId}} {{now}} {{now:FORMAT}} {{seq}} {{field:PID-3.1}} {{vars.name}}
// Unknown placeholders are left untouched.

const PLACEHOLDER_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const NOW_RE = /^now(?::(.*))?$/s;

let controlCounter = 0;
let seqCounter = 0;

function pad(value, width) {
  return String(value).padStart(width, '0');
}

// Format a Date with tokens YYYY MM DD HH mm ss SSS (local time).
export function formatDate(date, format = 'YYYYMMDDHHmmss') {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const map = {
    YYYY: pad(d.getFullYear(), 4),
    MM: pad(d.getMonth() + 1, 2),
    DD: pad(d.getDate(), 2),
    HH: pad(d.getHours(), 2),
    mm: pad(d.getMinutes(), 2),
    ss: pad(d.getSeconds(), 2),
    SSS: pad(d.getMilliseconds(), 3)
  };
  return String(format).replace(/YYYY|SSS|MM|DD|HH|mm|ss/g, (token) => map[token]);
}

// 20 characters: YYYYMMDDHHmmssSSS + 3 digit counter (fits MSH-10 limit).
export function generateControlId(date = new Date()) {
  controlCounter = (controlCounter + 1) % 1000;
  return formatDate(date, 'YYYYMMDDHHmmssSSS') + pad(controlCounter, 3);
}

export function nextSeq() {
  seqCounter += 1;
  return seqCounter;
}

function lookup(obj, path) {
  if (obj === null || obj === undefined) return undefined;
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function toValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return formatDate(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Returns the replacement string, or null to leave the placeholder untouched.
function resolvePlaceholder(body, ctx, state) {
  if (body === 'controlId') {
    if (state.controlId === null) state.controlId = generateControlId(state.now);
    return state.controlId;
  }
  if (body === 'seq') {
    if (state.seq === null) state.seq = nextSeq();
    return String(state.seq);
  }
  const nowMatch = NOW_RE.exec(body);
  if (nowMatch) {
    const format = nowMatch[1] !== undefined && nowMatch[1] !== '' ? nowMatch[1] : 'YYYYMMDDHHmmss';
    return formatDate(state.now, format);
  }
  let m = /^field:(.+)$/s.exec(body);
  if (m) {
    const msg = ctx.msg;
    if (!msg || typeof msg.get !== 'function') return '';
    try {
      const v = msg.get(m[1].trim());
      return v === null || v === undefined ? '' : String(v);
    } catch {
      return '';
    }
  }
  m = /^vars\.(.+)$/s.exec(body);
  if (m) return toValue(lookup(ctx.vars, m[1]));
  return null;
}

// Render all placeholders. Values are stable within one render ({{controlId}}, {{seq}}, {{now}} base time).
export function renderTemplate(text, ctx = {}) {
  if (text === null || text === undefined) return '';
  const src = typeof text === 'string' ? text : String(text);
  if (!src.includes('{{')) return src;
  const context = ctx && typeof ctx === 'object' ? ctx : {};
  const state = {
    controlId: context.controlId !== undefined && context.controlId !== null && context.controlId !== ''
      ? String(context.controlId)
      : null,
    seq: null,
    now: context.now instanceof Date && !Number.isNaN(context.now.getTime()) ? context.now : new Date()
  };
  return src.replace(PLACEHOLDER_RE, (whole, body) => {
    let value;
    try {
      value = resolvePlaceholder(body, context, state);
    } catch {
      value = null;
    }
    return value === null ? whole : value;
  });
}
