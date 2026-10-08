// App: wires EventStore, MLLP listeners, sender, scenarios and the parse helper used by the web layer.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { EventStore, now } from './core/events.js';
import { hexToBuffer, normalizeHex } from './core/hex.js';
import { analyzeFraming } from './mllp/framing.js';
import { MllpListener, DEFAULT_LISTENER_CONFIG } from './mllp/listener.js';
import { sendMany, DEFAULT_SEND_REQUEST } from './mllp/sender.js';
import { parseMessage, summarize } from './hl7/parser.js';
import { tokenize } from './hl7/tokenize.js';
import { fieldName } from './hl7/dictionary.js';
import { buildAck } from './hl7/ack.js';
import { generateControlId } from './hl7/templates.js';
import { ENCODINGS, encode, decode, checkEncodingConsistency } from './hl7/encoding.js';
import { saveConfig, deepMerge, isPlainObject } from './config.js';
import { loadScenarios, parseScenario, runScenario, rememberRun } from './scenarios/runner.js';
import { VERSION } from './runtime.js';

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const EXAMPLE_FILE_RE = /^[A-Za-z0-9_.-]+\.hl7$/;
const ACK_MODES = ['AA', 'AE', 'AR', 'none', 'custom'];
const LISTENER_KEYS = Object.keys(DEFAULT_LISTENER_CONFIG);
const ACK_KEYS = Object.keys(DEFAULT_LISTENER_CONFIG.ack);
const SEND_KEYS = Object.keys(DEFAULT_SEND_REQUEST);
const MAX_TEXT_LENGTH = 20 * 1024 * 1024;

function pickKnown(obj, keys) {
  const out = {};
  for (const key of keys) if (obj[key] !== undefined) out[key] = obj[key];
  return out;
}

function requireInt(value, label, min, max) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AppError(400, `'${label}' must be an integer between ${min} and ${max}`);
  }
  return n;
}

function requireNumber(value, label, min, max) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new AppError(400, `'${label}' must be a number between ${min} and ${max}`);
  }
  return n;
}

function requireBool(value, label) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (typeof value !== 'boolean') throw new AppError(400, `'${label}' must be a boolean`);
  return value;
}

function requireHex(value, label, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new AppError(400, `'${label}' must be a hex string (empty string allowed)`);
  }
  if (typeof value !== 'string') throw new AppError(400, `'${label}' must be a hex string`);
  if (value.trim() === '') return '';
  try {
    return normalizeHex(value);
  } catch (err) {
    throw new AppError(400, `'${label}': ${err.message}`);
  }
}

function requireEncoding(value, label) {
  if (typeof value !== 'string' || !ENCODINGS.includes(value)) {
    throw new AppError(400, `'${label}' must be one of: ${ENCODINGS.join(', ')}`);
  }
  return value;
}

/** Validates and normalises a full listener config. Unknown keys are dropped. */
export function validateListenerConfig(input) {
  if (!isPlainObject(input)) throw new AppError(400, 'Listener config must be an object');
  const c = deepMerge(DEFAULT_LISTENER_CONFIG, pickKnown(input, LISTENER_KEYS));
  if (typeof c.id !== 'string' || !ID_RE.test(c.id)) {
    throw new AppError(400, "'id' is required and must match ^[A-Za-z0-9_.-]{1,64}$");
  }
  if (c.name === null || c.name === undefined || c.name === '') c.name = c.id;
  if (typeof c.name !== 'string' || c.name.length > 200) throw new AppError(400, "'name' must be a string (max 200 chars)");
  if (typeof c.host !== 'string' || !c.host.trim()) throw new AppError(400, "'host' must be a non-empty string");
  c.host = c.host.trim();
  c.port = requireInt(c.port, 'port', 1, 65535);
  c.prefixHex = requireHex(c.prefixHex, 'prefixHex');
  c.suffixHex = requireHex(c.suffixHex, 'suffixHex');
  c.encoding = requireEncoding(c.encoding, 'encoding');

  if (!isPlainObject(c.ack)) throw new AppError(400, "'ack' must be an object");
  c.ack = { ...structuredClone(DEFAULT_LISTENER_CONFIG.ack), ...pickKnown(c.ack, ACK_KEYS) };
  if (!ACK_MODES.includes(c.ack.mode)) throw new AppError(400, `'ack.mode' must be one of: ${ACK_MODES.join(', ')}`);
  c.ack.delayMs = requireNumber(c.ack.delayMs ?? 0, 'ack.delayMs', 0, 600000);
  if (c.ack.template !== null && typeof c.ack.template !== 'string') throw new AppError(400, "'ack.template' must be a string or null");
  if (c.ack.template === '') c.ack.template = null;
  if (c.ack.mode === 'custom' && !c.ack.template) throw new AppError(400, "'ack.template' is required when ack.mode is 'custom'");
  c.ack.prefixHex = requireHex(c.ack.prefixHex, 'ack.prefixHex', { nullable: true });
  c.ack.suffixHex = requireHex(c.ack.suffixHex, 'ack.suffixHex', { nullable: true });
  if (c.ack.textMessage === null || c.ack.textMessage === undefined) c.ack.textMessage = '';
  if (typeof c.ack.textMessage !== 'string') throw new AppError(400, "'ack.textMessage' must be a string");
  if (c.ack.errorCode !== null && c.ack.errorCode !== undefined) {
    if (!['string', 'number'].includes(typeof c.ack.errorCode)) throw new AppError(400, "'ack.errorCode' must be a string, number or null");
    c.ack.errorCode = String(c.ack.errorCode);
    if (c.ack.errorCode === '') c.ack.errorCode = null;
  } else {
    c.ack.errorCode = null;
  }

  for (const key of ['keepConnection', 'autoStart', 'logBytes']) c[key] = requireBool(c[key], key);
  c.idleTimeoutMs = requireNumber(c.idleTimeoutMs ?? 0, 'idleTimeoutMs', 0, 86_400_000);
  c.frameTimeoutMs = requireNumber(c.frameTimeoutMs ?? 3000, 'frameTimeoutMs', 0, 86_400_000);
  c.maxMessageBytes = requireInt(c.maxMessageBytes, 'maxMessageBytes', 1024, 1024 * 1024 * 1024);
  return c;
}

/** Validates a send request (after merging sender defaults). Unknown keys are dropped. */
export function validateSendRequest(input) {
  if (!isPlainObject(input)) throw new AppError(400, 'Send request must be an object');
  const r = { ...structuredClone(DEFAULT_SEND_REQUEST), ...pickKnown(input, SEND_KEYS) };
  if (typeof r.message !== 'string' || !r.message.trim()) throw new AppError(400, "'message' is required and must be a non-empty string");
  if (r.message.length > MAX_TEXT_LENGTH) throw new AppError(400, "'message' is too large");
  if (r.id === null || r.id === undefined || r.id === '') r.id = 'sender';
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) throw new AppError(400, "'id' must match ^[A-Za-z0-9_.-]{1,64}$");
  if (typeof r.host !== 'string' || !r.host.trim()) throw new AppError(400, "'host' must be a non-empty string");
  r.host = r.host.trim();
  r.port = requireInt(r.port, 'port', 1, 65535);
  r.prefixHex = requireHex(r.prefixHex, 'prefixHex');
  r.suffixHex = requireHex(r.suffixHex, 'suffixHex');
  r.ackPrefixHex = requireHex(r.ackPrefixHex, 'ackPrefixHex', { nullable: true });
  r.ackSuffixHex = requireHex(r.ackSuffixHex, 'ackSuffixHex', { nullable: true });
  r.encoding = requireEncoding(r.encoding, 'encoding');
  for (const key of ['normalizeSegmentSeparator', 'autoControlId', 'renderTemplate', 'expectAck', 'keepAlive', 'logBytes']) {
    r[key] = requireBool(r[key], key);
  }
  r.connectTimeoutMs = requireNumber(r.connectTimeoutMs, 'connectTimeoutMs', 0, 3_600_000);
  r.ackTimeoutMs = requireNumber(r.ackTimeoutMs, 'ackTimeoutMs', 0, 3_600_000);
  r.repeat = requireInt(r.repeat, 'repeat', 1, 100000);
  r.intervalMs = requireNumber(r.intervalMs, 'intervalMs', 0, 3_600_000);
  return r;
}



function stripDescription(text) {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r\n|\r|\n/);
  let description = '';
  let start = 0;
  if (lines.length > 0 && lines[0].startsWith('#')) {
    description = lines[0].replace(/^#+\s?/, '').trim();
    start = 1;
  }
  while (start < lines.length && lines[start].trim() === '') start += 1;
  let end = lines.length;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return { description, text: lines.slice(start, end).join('\n') };
}

function fallbackAck(text, reason) {
  let controlId = '';
  try { controlId = parseMessage(text).get('MSH-10'); } catch { controlId = ''; }
  const ts = now().ts.replace(/[-:TZ.]/g, '').slice(0, 14);
  const safeReason = String(reason).replace(/[|^~\\&\r\n]/g, ' ').slice(0, 200);
  return `MSH|^~\\&|HL7T|HL7T|||${ts}||ACK|${generateControlId()}|P|2.5\rMSA|AE|${controlId}|ACK builder failed: ${safeReason}\r`;
}

export class App extends EventEmitter {
  constructor(config, { configPath = null, rootDir = process.cwd() } = {}) {
    super();
    if (!isPlainObject(config)) throw new TypeError('App: config must be an object');
    this.config = config;
    this.configPath = configPath;
    this.rootDir = path.resolve(rootDir);
    this.version = VERSION;
    this.startedMono = null;
    this.stopped = false;
    this.waiters = new Set();

    const eventsCfg = isPlainObject(config.events) ? config.events : {};
    const ndjsonPath = typeof eventsCfg.ndjsonPath === 'string' && eventsCfg.ndjsonPath.trim()
      ? path.resolve(this.rootDir, eventsCfg.ndjsonPath)
      : null;
    this.events = new EventStore({ maxEvents: eventsCfg.maxEvents ?? 5000, ndjsonPath });
    this.events.on('error', (err) => {
      console.error(`[events] ${err?.message ?? err}`);
    });

    this.parseSummary = (text) => {
      try {
        return summarize(parseMessage(text));
      } catch {
        return null;
      }
    };
    this.encoding = { encode, decode, check: checkEncodingConsistency };
    this.senderDeps = { events: this.events, encoding: this.encoding, parse: this.parseSummary };

    this.listeners = new Map();
    const listenerConfigs = Array.isArray(config.listeners) ? config.listeners : [];
    for (const raw of listenerConfigs) {
      let cfg;
      try {
        cfg = validateListenerConfig(raw);
      } catch (err) {
        this.pushSystem('error', `Invalid listener config skipped (${raw?.id ?? '?'}): ${err.message}`, { code: 'E_CONFIG', message: err.message });
        continue;
      }
      if (this.listeners.has(cfg.id)) {
        this.pushSystem('error', `Duplicate listener id '${cfg.id}' in config skipped`, { code: 'E_CONFIG', message: 'duplicate id' });
        continue;
      }
      this.listeners.set(cfg.id, this.createListener(cfg));
    }

    const runs = [];
    const scenariosDir = path.join(this.rootDir, 'scenarios');
    this.scenarios = {
      runs,
      list: () => loadScenarios(scenariosDir),
      get: (runId) => runs.find((r) => r.runId === runId),
      run: async (name, overrides = {}) => {
        if (typeof name !== 'string' || !name.trim() || name.length > 200) {
          throw new AppError(400, 'Scenario name is required');
        }
        if (overrides !== undefined && overrides !== null && !isPlainObject(overrides)) {
          throw new AppError(400, "'overrides' must be an object");
        }
        const wanted = name.trim();
        const bare = wanted.replace(/\.ya?ml$/i, '');
        const infos = loadScenarios(scenariosDir);
        const info = infos.find((i) => i.id === bare || i.file === wanted) ?? infos.find((i) => i.name === wanted);
        if (!info) throw new AppError(404, `Scenario '${wanted}' not found`);
        if (info.error) throw new AppError(400, `Scenario '${wanted}' is invalid: ${info.error}`);
        let scenario;
        try {
          const text = fs.readFileSync(path.join(scenariosDir, info.file), 'utf8');
          scenario = parseScenario(text, { file: `scenarios/${info.file}` });
        } catch (err) {
          throw new AppError(400, err.message);
        }
        let run;
        try {
          run = await runScenario(scenario, this, { overrides: overrides ?? {} });
        } catch (err) {
          throw err instanceof AppError ? err : new AppError(400, err.message);
        }
        rememberRun(runs, run);
        return run;
      }
    };
  }

  pushSystem(level, summary, data = {}) {
    try {
      return this.events.push({
        source: 'system', endpointId: 'system', connId: null, type: level === 'error' ? 'system.error' : 'system.info',
        direction: null, level, summary, latencyMs: null, data
      });
    } catch (err) {
      console.error(`[system] ${summary} (event push failed: ${err.message})`);
      return null;
    }
  }

  buildAckFor(ctx) {
    const ack = ctx?.config?.ack ?? {};
    const mode = ack.mode ?? 'AA';
    if (mode === 'none') return null;
    const text = typeof ctx.text === 'string' ? ctx.text : '';
    try {
      if (mode === 'custom') {
        if (!ack.template) {
          return buildAck(text, { code: 'AA', textMessage: ack.textMessage ?? '' });
        }
        return buildAck(text, { template: ack.template, ctx: { vars: {} } });
      }
      return buildAck(text, {
        code: mode,
        textMessage: ack.textMessage ?? '',
        errorCode: ack.errorCode ?? null
      });
    } catch (err) {
      const message = err?.message ?? String(err);
      try {
        this.events.push({
          source: 'listener', endpointId: ctx?.config?.id ?? 'listener', connId: null, type: 'listener.error', direction: null,
          level: 'error', summary: `ACK builder failed, sending fallback AE: ${message}`, latencyMs: null,
          data: { code: 'E_ACK_BUILD', message }
        });
      } catch { /* event store failure already logged by its own error handler */ }
      return fallbackAck(text, message);
    }
  }

  createListener(cfg) {
    const listener = new MllpListener(cfg, {
      events: this.events,
      ackBuilder: (ctx) => this.buildAckFor(ctx),
      parse: this.parseSummary,
      encoding: this.encoding
    });
    listener.on('status', () => this.emit('status', { listenerId: cfg.id }));
    listener.on('error', (err) => {
      try {
        this.events.push({
          source: 'listener', endpointId: cfg.id, connId: null, type: 'listener.error', direction: null, level: 'error',
          summary: `Listener error: ${err?.message ?? err}`, latencyMs: null, data: { code: err?.code ?? 'E_LISTENER', message: err?.message ?? String(err) }
        });
      } catch { /* nothing more to do */ }
    });
    return listener;
  }

  persist() {
    this.config.listeners = [...this.listeners.values()].map((l) => structuredClone(l.config));
    if (!this.configPath) return;
    try {
      saveConfig(this.config, this.configPath);
    } catch (err) {
      this.pushSystem('error', `Cannot persist config: ${err.message}`, { code: 'E_CONFIG_SAVE', message: err.message });
      throw new AppError(500, `Config saved in memory only, write failed: ${err.message}`);
    }
  }

  getListener(id) {
    if (typeof id !== 'string' || !id) throw new AppError(400, 'Listener id is required');
    const listener = this.listeners.get(id);
    if (!listener) throw new AppError(404, `Listener '${id}' not found`);
    return listener;
  }

  async start() {
    this.stopped = false;
    this.startedMono = now().mono;
    for (const listener of this.listeners.values()) {
      if (listener.config?.autoStart === false) continue;
      try {
        await listener.start();
      } catch (err) {
        // The listener already pushed listener.error; startup continues with the other listeners.
        console.error(`[listener ${listener.config?.id}] start failed: ${err?.message ?? err}`);
      }
    }
    this.events.push({
      source: 'system', endpointId: 'system', connId: null, type: 'system.started', direction: null, level: 'info',
      summary: `simple-hl7 ${this.version} started`, latencyMs: null,
      data: { web: { host: this.config.web?.host ?? null, port: this.config.web?.port ?? null }, version: this.version }
    });
    this.emit('status', { listenerId: null });
  }

  async stop() {
    this.stopped = true;
    for (const waiter of [...this.waiters]) waiter.cancel(new Error('Application stopped'));
    for (const listener of this.listeners.values()) {
      try {
        await listener.stop();
      } catch (err) {
        console.error(`[listener ${listener.config?.id}] stop failed: ${err?.message ?? err}`);
      }
    }
    if (typeof this.events.close === 'function') {
      try { await this.events.close(); } catch { /* best effort */ }
    }
  }

  uptimeMs() {
    return this.startedMono === null ? 0 : Math.max(0, Math.round(now().mono - this.startedMono));
  }

  listenerStatuses() {
    return [...this.listeners.values()].map((l) => l.status());
  }

  state() {
    const lastRuns = this.scenarios.runs.slice(0, 10).map((run) => ({
      ...run,
      steps: run.steps.map((step) => ({ ...step, result: null }))
    }));
    return {
      listeners: this.listenerStatuses(),
      events: this.events.stats(),
      config: {
        web: structuredClone(this.config.web ?? {}),
        ui: structuredClone(this.config.ui ?? {}),
        senderDefaults: structuredClone(this.config.senderDefaults ?? {})
      },
      scenarios: { available: this.scenarios.list(), lastRuns },
      uptimeMs: this.uptimeMs(),
      version: this.version,
      serverTime: now()
    };
  }

  async addListener(input) {
    const cfg = validateListenerConfig(input);
    if (this.listeners.has(cfg.id)) throw new AppError(409, `Listener '${cfg.id}' already exists`);
    for (const other of this.listeners.values()) {
      if (other.config.port === cfg.port && other.config.host === cfg.host) {
        throw new AppError(409, `Listener '${other.config.id}' already uses ${cfg.host}:${cfg.port}`);
      }
    }
    const listener = this.createListener(cfg);
    this.listeners.set(cfg.id, listener);
    this.persist();
    if (cfg.autoStart) {
      try {
        await listener.start();
      } catch (err) {
        console.error(`[listener ${cfg.id}] start failed: ${err?.message ?? err}`);
      }
    }
    this.emit('status', { listenerId: cfg.id });
    return listener.status();
  }

  async updateListener(id, partial) {
    const listener = this.getListener(id);
    if (!isPlainObject(partial)) throw new AppError(400, 'Listener update must be an object');
    if (partial.id !== undefined && partial.id !== id) throw new AppError(400, "Listener 'id' cannot be changed");
    const merged = validateListenerConfig(deepMerge(listener.config, pickKnown(partial, LISTENER_KEYS)));
    for (const other of this.listeners.values()) {
      if (other !== listener && other.config.port === merged.port && other.config.host === merged.host) {
        throw new AppError(409, `Listener '${other.config.id}' already uses ${merged.host}:${merged.port}`);
      }
    }
    const wasListening = ['listening', 'starting'].includes(listener.status().state);
    const { restartRequired } = listener.updateConfig(merged) ?? { restartRequired: false };
    this.persist();
    if (restartRequired && wasListening) {
      await listener.stop();
      try {
        await listener.start();
      } catch (err) {
        console.error(`[listener ${id}] restart failed: ${err?.message ?? err}`);
      }
    }
    this.emit('status', { listenerId: id });
    return listener.status();
  }

  async removeListener(id) {
    const listener = this.getListener(id);
    try {
      await listener.stop();
    } finally {
      this.listeners.delete(id);
    }
    this.persist();
    this.emit('status', { listenerId: id });
  }

  async startListener(id) {
    const listener = this.getListener(id);
    try {
      await listener.start();
    } catch (err) {
      throw new AppError(409, `Listener '${id}' cannot start: ${err?.message ?? err}`);
    } finally {
      this.emit('status', { listenerId: id });
    }
    return listener.status();
  }

  async stopListener(id) {
    const listener = this.getListener(id);
    await listener.stop();
    this.emit('status', { listenerId: id });
    return listener.status();
  }

  async send(req) {
    if (!isPlainObject(req)) throw new AppError(400, 'Send request must be an object');
    const merged = validateSendRequest({ ...structuredClone(this.config.senderDefaults ?? {}), ...req });
    try {
      return await sendMany(merged, this.senderDeps);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // sendMany throws only for invalid input (bad hex, empty message); network problems come back as ok=false.
      throw new AppError(400, err?.message ?? String(err));
    }
  }

  parse(text, { prefixHex, suffixHex } = {}) {
    if (typeof text !== 'string') throw new AppError(400, "'text' must be a string");
    if (text.length > MAX_TEXT_LENGTH) throw new AppError(400, "'text' is too large");
    let framing = null;
    let payload = text;
    const hasControlBytes = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text);
    if (hasControlBytes) {
      const prefix = hexToBuffer(requireHex(prefixHex ?? '0B', 'prefixHex'));
      const suffix = hexToBuffer(requireHex(suffixHex ?? '1C0D', 'suffixHex'));
      const raw = Buffer.from(text, 'utf8');
      framing = analyzeFraming(raw, { prefix, suffix });
      const start = Number.isInteger(framing?.payloadStart) ? framing.payloadStart : 0;
      const end = Number.isInteger(framing?.payloadEnd) ? framing.payloadEnd : raw.length;
      payload = raw.subarray(Math.max(0, start), Math.min(raw.length, Math.max(start, end))).toString('utf8');
    }
    const message = parseMessage(payload);
    const summary = summarize(message);
    const tokens = tokenize(payload);
    const fieldNames = {};
    for (const segment of message.segments ?? []) {
      const name = segment.name;
      const count = Array.isArray(segment.fields) ? segment.fields.length : 0;
      const existing = fieldNames[name] ?? [];
      if (existing.length < count) {
        const names = [''];
        for (let n = 1; n < count; n += 1) names.push(fieldName(name, n));
        fieldNames[name] = names;
      } else if (!fieldNames[name]) {
        fieldNames[name] = [''];
      }
    }
    const warnings = [...(message.warnings ?? [])];
    if (framing && Array.isArray(framing.warnings)) warnings.push(...framing.warnings);
    return { message: message.toJSON(), summary, tokens, framing, fieldNames, warnings };
  }

  /**
   * Resolves with the first msg.in event on the listener that matches all paths in `match`.
   * With `sinceId`, messages already received after that event id count too (a gateway may answer
   * before the caller starts waiting); otherwise only new messages count.
   */
  async waitForMessage(listenerId, { timeoutMs = 10000, match = {}, sinceId = null } = {}) {
    const listener = this.getListener(listenerId);
    if (this.stopped) throw new AppError(409, 'Application is stopped');
    const timeout = requireNumber(timeoutMs, 'timeoutMs', 1, 3_600_000);
    if (!isPlainObject(match)) throw new AppError(400, "'match' must be an object of HL7 path to expected value");
    const criteria = Object.entries(match);
    const matches = (event) => {
      if (criteria.length === 0) return true;
      let msg;
      try {
        msg = parseMessage(event.data?.text ?? '');
      } catch {
        return false;
      }
      for (const [hl7Path, expected] of criteria) {
        let actual;
        try { actual = msg.get(hl7Path); } catch { return false; }
        if (String(actual ?? '') !== String(expected ?? '')) return false;
      }
      return true;
    };
    if (Number.isInteger(sinceId) && sinceId >= 0) {
      const earlier = this.events.list({ sinceId, types: ['msg.in'], endpointId: listenerId, limit: 100000 });
      const hit = earlier.find((ev) => matches(ev));
      if (hit) return hit;
    }
    return new Promise((resolve, reject) => {
      const waiter = {};
      const cleanup = () => {
        clearTimeout(timer);
        listener.off('message', onMessage);
        this.waiters.delete(waiter);
      };
      const onMessage = ({ event } = {}) => {
        if (!event || !matches(event)) return;
        cleanup();
        resolve(event);
      };
      const timer = setTimeout(() => {
        cleanup();
        const crit = criteria.length ? ` matching ${JSON.stringify(match)}` : '';
        reject(new Error(`Timeout after ${timeout} ms waiting for a message on listener '${listenerId}'${crit}`));
      }, timeout);
      waiter.cancel = (err) => {
        cleanup();
        reject(err);
      };
      this.waiters.add(waiter);
      listener.on('message', onMessage);
    });
  }

  examples() {
    const dir = path.join(this.rootDir, 'examples');
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out = [];
    for (const file of names.filter((n) => EXAMPLE_FILE_RE.test(n)).sort()) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8');
        const { description, text } = stripDescription(raw);
        out.push({ name: file.replace(/\.hl7$/i, ''), file, description, text });
      } catch (err) {
        this.pushSystem('error', `Cannot read example ${file}: ${err.message}`, { code: 'E_EXAMPLE', message: err.message });
      }
    }
    return out;
  }

  updateUiConfig(partial) {
    if (!isPlainObject(partial)) throw new AppError(400, 'UI config must be an object');
    const next = deepMerge(this.config.ui ?? {}, partial);
    if (!isPlainObject(next.latencyThresholds)) throw new AppError(400, "'latencyThresholds' must be an object");
    next.latencyThresholds.warnMs = requireNumber(next.latencyThresholds.warnMs, 'latencyThresholds.warnMs', 0, 3_600_000);
    next.latencyThresholds.badMs = requireNumber(next.latencyThresholds.badMs, 'latencyThresholds.badMs', 0, 3_600_000);
    if (next.latencyThresholds.warnMs > next.latencyThresholds.badMs) {
      throw new AppError(400, "'latencyThresholds.warnMs' must not be greater than 'badMs'");
    }
    if (JSON.stringify(next).length > 64 * 1024) throw new AppError(400, 'UI config is too large');
    this.config.ui = next;
    this.persist();
    this.emit('status', { listenerId: null });
    return structuredClone(this.config.ui);
  }
}
