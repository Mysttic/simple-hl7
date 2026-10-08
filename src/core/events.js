// Event store: ring buffer of timestamped events with an optional NDJSON sink.
// All latencies in the application are computed from `now().mono` (monotonic, fractional ms
// since process start); `ts` / `tsMs` are wall clock values for display and export only.

import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';

const START_NS = process.hrtime.bigint();

const SOURCES = new Set(['listener', 'sender', 'scenario', 'system']);
const LEVELS = new Set(['info', 'warn', 'error']);
const DIRECTIONS = new Set(['in', 'out']);
const SINK_QUEUE_LIMIT = 10000;

export const CSV_COLUMNS = [
  'id', 'ts', 'source', 'endpointId', 'connId', 'type', 'direction', 'level', 'summary', 'latencyMs',
];
const CSV_SEPARATOR = ';';

/** Wall clock + monotonic snapshot. Take it once per step and reuse it. */
export function now() {
  const date = new Date();
  return {
    ts: date.toISOString(),
    tsMs: date.getTime(),
    mono: Number(process.hrtime.bigint() - START_NS) / 1e6,
  };
}

export class EventStore extends EventEmitter {
  constructor({ maxEvents = 5000, ndjsonPath = null } = {}) {
    super();
    this.setMaxListeners(0);
    this._maxEvents = toPositiveInt(maxEvents, 5000);
    this._buffer = [];
    this._nextId = 1;
    this._dropped = 0;
    this._closed = false;
    this._sink = null;
    if (typeof ndjsonPath === 'string' && ndjsonPath.trim() !== '') {
      this._openSink(ndjsonPath.trim());
    }
  }

  get maxEvents() {
    return this._maxEvents;
  }

  get ndjsonPath() {
    return this._sink ? this._sink.path : null;
  }

  /** Assigns id and timestamps, stores, emits 'event', appends to the NDJSON sink. Returns the event. */
  push(partial) {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
      throw new TypeError('EventStore.push expects an event object');
    }
    const hasTs = typeof partial.ts === 'string';
    const hasTsMs = typeof partial.tsMs === 'number' && Number.isFinite(partial.tsMs);
    const hasMono = typeof partial.mono === 'number' && Number.isFinite(partial.mono);
    const stamp = (hasTs && hasTsMs && hasMono) ? null : now();
    const parsedTs = hasTs && !hasTsMs ? Date.parse(partial.ts) : NaN;
    const event = {
      id: this._nextId,
      ts: hasTs ? partial.ts : stamp.ts,
      tsMs: hasTsMs ? partial.tsMs : (Number.isFinite(parsedTs) ? parsedTs : stamp.tsMs),
      mono: hasMono ? partial.mono : stamp.mono,
      source: SOURCES.has(partial.source) ? partial.source : 'system',
      endpointId: typeof partial.endpointId === 'string' && partial.endpointId !== '' ? partial.endpointId : 'system',
      connId: typeof partial.connId === 'string' ? partial.connId : null,
      type: typeof partial.type === 'string' && partial.type !== '' ? partial.type : 'unknown',
      direction: DIRECTIONS.has(partial.direction) ? partial.direction : null,
      level: LEVELS.has(partial.level) ? partial.level : 'info',
      summary: partial.summary == null ? '' : String(partial.summary),
      latencyMs: typeof partial.latencyMs === 'number' && Number.isFinite(partial.latencyMs) ? partial.latencyMs : null,
      data: partial.data && typeof partial.data === 'object' ? partial.data : {},
    };
    this._nextId += 1;
    this._buffer.push(event);
    if (this._buffer.length > this._maxEvents) {
      const excess = this._buffer.length - this._maxEvents;
      this._buffer.splice(0, excess);
      this._dropped += excess;
    }
    this._appendSink(event);
    this.emit('event', event);
    return event;
  }

  /**
   * Filtered view, oldest -> newest. When more than `limit` events match, the newest `limit`
   * are returned (still ascending), so a poll always sees the most recent activity.
   * types: array or comma separated string. text: case-insensitive substring over summary,
   * type, endpoint, connection id, decoded text and control id.
   */
  list({ sinceId = 0, limit = 500, types = null, endpointId = null, text = null, level = null } = {}) {
    const since = Number(sinceId) || 0;
    const max = toPositiveInt(limit, 500);
    const typeSet = normalizeTypes(types);
    const endpoint = typeof endpointId === 'string' && endpointId !== '' ? endpointId : null;
    const needle = typeof text === 'string' && text.trim() !== '' ? text.trim().toLowerCase() : null;
    const lvl = typeof level === 'string' && LEVELS.has(level) ? level : null;

    const out = [];
    for (let i = this._buffer.length - 1; i >= 0 && out.length < max; i -= 1) {
      const ev = this._buffer[i];
      if (ev.id <= since) break;
      if (typeSet && !typeSet.has(ev.type)) continue;
      if (endpoint && ev.endpointId !== endpoint) continue;
      if (lvl && ev.level !== lvl) continue;
      if (needle && !matchesText(ev, needle)) continue;
      out.push(ev);
    }
    return out.reverse();
  }

  last(n) {
    const count = toPositiveInt(n, 1);
    if (count >= this._buffer.length) return this._buffer.slice();
    return this._buffer.slice(this._buffer.length - count);
  }

  get(id) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || this._buffer.length === 0) return undefined;
    // ids are contiguous, so the index is a direct offset from the oldest retained event
    const index = numeric - this._buffer[0].id;
    if (index < 0 || index >= this._buffer.length) return undefined;
    const ev = this._buffer[index];
    return ev && ev.id === numeric ? ev : undefined;
  }

  clear() {
    this._buffer = [];
    this._dropped = 0;
    this.emit('clear');
  }

  stats() {
    const count = this._buffer.length;
    return {
      count,
      firstId: count ? this._buffer[0].id : null,
      lastId: count ? this._buffer[count - 1].id : null,
      dropped: this._dropped,
      nextId: this._nextId,
      maxEvents: this._maxEvents,
    };
  }

  /** RFC 4180 style CSV (LF line endings, fields quoted when needed). */
  /**
   * CSV for a spreadsheet set to Polish: UTF-8 with a BOM (without it Excel reads the file as
   * cp1250), a semicolon between columns and a decimal comma, so a double click opens it in columns.
   */
  toCsv(events) {
    const rows = [CSV_COLUMNS.join(CSV_SEPARATOR)];
    for (const ev of toArray(events)) {
      rows.push(CSV_COLUMNS.map((col) => csvCell(ev[col])).join(CSV_SEPARATOR));
    }
    return `\uFEFF${rows.join('\r\n')}\r\n`;
  }

  toNdjson(events) {
    const list = toArray(events);
    if (list.length === 0) return '';
    return `${list.map((ev) => JSON.stringify(ev)).join('\n')}\n`;
  }

  /** Flushes and closes the NDJSON sink (if any). Safe to call multiple times. */
  async close() {
    this._closed = true;
    const sink = this._sink;
    if (!sink) return;
    this._sink = null;
    const stream = sink.stream;
    if (!stream || stream.destroyed || sink.failed) return;
    for (const line of sink.queue) stream.write(line);
    sink.queue = [];
    await new Promise((done) => {
      stream.once('error', () => done());
      stream.end(() => done());
    });
  }

  _openSink(path) {
    const sink = { path, stream: null, queue: [], failed: false };
    this._sink = sink;
    mkdir(dirname(resolvePath(path)), { recursive: true })
      .then(() => {
        if (this._closed || this._sink !== sink) return;
        const stream = createWriteStream(path, { flags: 'a' });
        stream.on('error', (err) => this._sinkFailure(sink, err));
        sink.stream = stream;
        for (const line of sink.queue) stream.write(line);
        sink.queue = [];
      })
      .catch((err) => this._sinkFailure(sink, err));
  }

  _appendSink(event) {
    const sink = this._sink;
    if (!sink || sink.failed) return;
    const line = `${JSON.stringify(event)}\n`;
    if (!sink.stream) {
      sink.queue.push(line);
      if (sink.queue.length > SINK_QUEUE_LIMIT) sink.queue.splice(0, sink.queue.length - SINK_QUEUE_LIMIT);
      return;
    }
    sink.stream.write(line);
  }

  _sinkFailure(sink, err) {
    if (sink.failed) return;
    sink.failed = true;
    sink.queue = [];
    if (sink.stream && !sink.stream.destroyed) {
      try { sink.stream.destroy(); } catch { /* already gone */ }
    }
    if (this._sink === sink) this._sink = null;
    // report once; the sink is disabled so this cannot recurse
    this.push({
      source: 'system',
      endpointId: 'system',
      type: 'system.error',
      level: 'error',
      summary: `NDJSON event sink disabled: ${err && err.message ? err.message : err}`,
      data: { code: err && err.code ? err.code : null, message: err && err.message ? err.message : String(err), path: sink.path },
    });
  }
}

function matchesText(ev, needle) {
  const parts = [ev.summary, ev.type, ev.endpointId, ev.connId || ''];
  const data = ev.data || {};
  if (typeof data.text === 'string') parts.push(data.text);
  if (data.summary && typeof data.summary === 'object' && typeof data.summary.controlId === 'string') {
    parts.push(data.summary.controlId);
  }
  if (typeof data.controlId === 'string') parts.push(data.controlId);
  if (typeof data.inReplyTo === 'string') parts.push(data.inReplyTo);
  if (typeof data.message === 'string') parts.push(data.message);
  return parts.join('\n').toLowerCase().includes(needle);
}

function normalizeTypes(types) {
  if (types == null) return null;
  let list;
  if (Array.isArray(types)) list = types;
  else if (typeof types === 'string') list = types.split(',');
  else return null;
  const cleaned = list.map((t) => String(t).trim()).filter((t) => t !== '');
  return cleaned.length ? new Set(cleaned) : null;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value).replace('.', ',');
  const str = typeof value === 'string' ? value : String(value);
  if (/[";\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toArray(events) {
  if (Array.isArray(events)) return events;
  if (events && typeof events[Symbol.iterator] === 'function') return Array.from(events);
  return [];
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.trunc(n);
}
