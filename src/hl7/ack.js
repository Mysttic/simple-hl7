// HL7 v2 acknowledgment builder. Browser-safe ESM (imports parser + templates only).

import { parseMessage, summarize, isMessage, escape as escapeHl7 } from './parser.js';
import { renderTemplate, generateControlId, formatDate } from './templates.js';

const DEFAULT_VERSION = '2.5';
const DEFAULT_PROCESSING_ID = 'P';
const ERR_CODES_WITH_SEGMENT = new Set(['AE', 'AR']);

// Compare HL7 version strings numerically ('2.3.1' vs '2.5'). Unparsable -> treated as DEFAULT_VERSION.
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function parseVersion(version) {
  const text = version === null || version === undefined ? '' : String(version);
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text);
  if (!m) return parseVersion(DEFAULT_VERSION);
  return [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3] ? parseInt(m[3], 10) : 0];
}

// MSH-9 of the ACK: version < 2.3.1 or no trigger -> 'ACK', else 'ACK^<trigger>^ACK'.
export function ackMessageType(version, trigger) {
  const t = trigger === null || trigger === undefined ? '' : String(trigger).trim();
  if (!t) return 'ACK';
  if (compareVersions(version, '2.3.1') < 0) return 'ACK';
  return `ACK^${t}^ACK`;
}

function toMessage(input) {
  if (isMessage(input)) return input;
  return parseMessage(input === null || input === undefined ? '' : input);
}

function normalizeCode(code) {
  if (code === null || code === undefined) return 'AA';
  const text = String(code).trim();
  return text === '' ? 'AA' : text;
}

function normalizeSegments(text) {
  const normalized = String(text).replace(/\r\n|\r|\n/g, '\r').replace(/\r+$/, '');
  if (normalized === '') return '';
  return `${normalized}\r`;
}

function buildErrSegment(version, errorCode, text) {
  if (compareVersions(version, '2.5') < 0) {
    return `ERR|^^^${errorCode}&${text}`;
  }
  return `ERR|||${errorCode}^${text}^HL70357|E`;
}

export function buildAck(input, opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const msg = toMessage(input);
  const summary = summarize(msg);
  const code = normalizeCode(options.code);
  const textMessage = options.textMessage === null || options.textMessage === undefined ? '' : String(options.textMessage);
  const errorCode = options.errorCode === null || options.errorCode === undefined || options.errorCode === ''
    ? null
    : String(options.errorCode);
  const controlId = options.controlId !== null && options.controlId !== undefined && options.controlId !== ''
    ? String(options.controlId)
    : generateControlId();
  const timestamp = options.timestamp ? String(options.timestamp) : formatDate(new Date(), 'YYYYMMDDHHmmss');

  if (options.template) {
    const baseCtx = options.ctx && typeof options.ctx === 'object' ? options.ctx : {};
    const vars = {
      code,
      textMessage,
      errorCode: errorCode === null ? '' : errorCode,
      timestamp,
      ...(baseCtx.vars && typeof baseCtx.vars === 'object' ? baseCtx.vars : {})
    };
    const rendered = renderTemplate(options.template, { ...baseCtx, vars, msg, summary, controlId });
    return normalizeSegments(rendered);
  }

  const sendingApplication = options.sendingApplication !== null && options.sendingApplication !== undefined
    ? String(options.sendingApplication)
    : msg.get('MSH-5');
  const sendingFacility = options.sendingFacility !== null && options.sendingFacility !== undefined
    ? String(options.sendingFacility)
    : msg.get('MSH-6');
  const receivingApplication = msg.get('MSH-3');
  const receivingFacility = msg.get('MSH-4');
  const versionField = msg.get('MSH-12') || DEFAULT_VERSION;
  const version = msg.get('MSH-12.1') || DEFAULT_VERSION;
  const processingId = msg.get('MSH-11') || DEFAULT_PROCESSING_ID;
  const trigger = msg.get('MSH-9.2');
  const characterSet = msg.get('MSH-18');
  const originalControlId = msg.get('MSH-10');
  const text = escapeHl7(textMessage);

  // mshFields[n - 1] is MSH-n for n >= 2 (MSH-1 is the separator used by join).
  const mshFields = [
    'MSH',
    '^~\\&',
    sendingApplication,
    sendingFacility,
    receivingApplication,
    receivingFacility,
    timestamp,
    '',
    ackMessageType(version, trigger),
    controlId,
    processingId,
    versionField
  ];
  if (characterSet) {
    while (mshFields.length < 17) mshFields.push('');
    mshFields.push(characterSet);
  }

  const segments = [mshFields.join('|'), `MSA|${code}|${originalControlId}|${text}`];
  if (errorCode !== null && ERR_CODES_WITH_SEGMENT.has(code.toUpperCase())) {
    segments.push(buildErrSegment(version, errorCode, text));
  }
  return `${segments.join('\r')}\r`;
}
