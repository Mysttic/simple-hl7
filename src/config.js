// Configuration: defaults, deep merge of config/app.json, environment overrides, atomic save.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LISTENER_CONFIG } from './mllp/listener.js';
import { DEFAULT_SEND_REQUEST } from './mllp/sender.js';

const { message: _omittedMessage, ...SENDER_DEFAULTS } = DEFAULT_SEND_REQUEST;

export const DEFAULT_CONFIG = {
  web: { host: '0.0.0.0', port: 8080 },
  events: { maxEvents: 5000, ndjsonPath: 'logs/events.ndjson' },
  listeners: [structuredClone(DEFAULT_LISTENER_CONFIG)],
  senderDefaults: structuredClone(SENDER_DEFAULTS),
  ui: { latencyThresholds: { warnMs: 300, badMs: 1000 } }
};

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursively merges `override` over `base`. Plain objects are merged key by key,
 * everything else (arrays, scalars, null) replaces the base value. Returns a new object,
 * never mutates its inputs. `undefined` values in override are ignored.
 */
export function deepMerge(base, override) {
  if (!isPlainObject(override)) {
    return override === undefined ? structuredClone(base) : structuredClone(override);
  }
  const out = isPlainObject(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

function requireInt(value, label, min, max) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Config: '${label}' must be an integer between ${min} and ${max}, got ${JSON.stringify(value)}`);
  }
  return n;
}

function requireNumber(value, label, min, max) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new Error(`Config: '${label}' must be a number between ${min} and ${max}, got ${JSON.stringify(value)}`);
  }
  return n;
}

/** Merges a parsed config file over the defaults. Listeners are merged one by one over the listener defaults. */
export function mergeConfig(fileConfig = {}) {
  if (!isPlainObject(fileConfig)) {
    throw new Error('Config: the configuration must be a JSON object');
  }
  const { listeners, ...rest } = fileConfig;
  const merged = deepMerge(DEFAULT_CONFIG, rest);
  if (listeners === undefined || listeners === null) {
    merged.listeners = structuredClone(DEFAULT_CONFIG.listeners);
  } else if (Array.isArray(listeners)) {
    merged.listeners = listeners
      .filter(isPlainObject)
      .map((listener) => deepMerge(DEFAULT_LISTENER_CONFIG, listener));
  } else {
    throw new Error("Config: 'listeners' must be an array");
  }
  return merged;
}

/** Applies environment overrides: HL7T_WEB_PORT (or PORT) and HL7T_WEB_HOST. */
export function applyEnvOverrides(config, env = process.env) {
  const port = env.HL7T_WEB_PORT ?? env.PORT;
  if (port !== undefined && String(port).trim() !== '') {
    config.web.port = requireInt(port, 'web.port (environment)', 0, 65535);
  }
  const host = env.HL7T_WEB_HOST;
  if (host !== undefined && String(host).trim() !== '') {
    config.web.host = String(host).trim();
  }
  return config;
}

/** Validates and normalises the parts of the config that are not owned by listener / sender modules. */
export function validateConfig(config) {
  if (!isPlainObject(config.web)) throw new Error("Config: 'web' must be an object");
  if (typeof config.web.host !== 'string' || !config.web.host.trim()) {
    throw new Error("Config: 'web.host' must be a non-empty string");
  }
  config.web.port = requireInt(config.web.port, 'web.port', 0, 65535);

  if (!isPlainObject(config.events)) throw new Error("Config: 'events' must be an object");
  config.events.maxEvents = requireInt(config.events.maxEvents, 'events.maxEvents', 10, 10_000_000);
  if (config.events.ndjsonPath !== null && config.events.ndjsonPath !== undefined) {
    if (typeof config.events.ndjsonPath !== 'string') {
      throw new Error("Config: 'events.ndjsonPath' must be a string or null");
    }
    if (config.events.ndjsonPath.trim() === '') config.events.ndjsonPath = null;
  } else {
    config.events.ndjsonPath = null;
  }

  if (!isPlainObject(config.senderDefaults)) throw new Error("Config: 'senderDefaults' must be an object");

  if (!isPlainObject(config.ui)) throw new Error("Config: 'ui' must be an object");
  if (!isPlainObject(config.ui.latencyThresholds)) {
    throw new Error("Config: 'ui.latencyThresholds' must be an object");
  }
  const thresholds = config.ui.latencyThresholds;
  thresholds.warnMs = requireNumber(thresholds.warnMs, 'ui.latencyThresholds.warnMs', 0, 3_600_000);
  thresholds.badMs = requireNumber(thresholds.badMs, 'ui.latencyThresholds.badMs', 0, 3_600_000);
  if (thresholds.warnMs > thresholds.badMs) {
    throw new Error("Config: 'ui.latencyThresholds.warnMs' must not be greater than 'badMs'");
  }
  return config;
}

/**
 * Loads the configuration file (deep-merged over DEFAULT_CONFIG) and applies environment overrides.
 * A relative path is resolved against `rootDir` (defaults to process.cwd()). A missing file yields
 * the defaults. An unreadable or syntactically invalid file throws an Error with a readable message.
 */
export function loadConfig(configPath = process.env.HL7T_CONFIG || 'config/app.json', { rootDir = process.cwd(), env = process.env } = {}) {
  if (typeof configPath !== 'string' || !configPath.trim()) {
    throw new Error('Config: path must be a non-empty string');
  }
  const resolved = path.resolve(rootDir, configPath);
  let fileConfig = {};
  if (fs.existsSync(resolved)) {
    let text;
    try {
      text = fs.readFileSync(resolved, 'utf8');
    } catch (err) {
      throw new Error(`Config: cannot read ${resolved}: ${err.message}`);
    }
    const trimmed = text.replace(/^﻿/, '').trim();
    if (trimmed) {
      try {
        fileConfig = JSON.parse(trimmed);
      } catch (err) {
        throw new Error(`Config: ${resolved} is not valid JSON: ${err.message}`);
      }
      if (!isPlainObject(fileConfig)) {
        throw new Error(`Config: ${resolved} must contain a JSON object`);
      }
    }
  }
  const config = mergeConfig(fileConfig);
  applyEnvOverrides(config, env);
  validateConfig(config);
  return config;
}

/** Atomic write (temp file + rename), pretty JSON, creates the directory if needed. */
export function saveConfig(config, configPath) {
  if (!isPlainObject(config)) {
    throw new TypeError('saveConfig: config must be an object');
  }
  if (typeof configPath !== 'string' || !configPath.trim()) {
    throw new TypeError('saveConfig: path must be a non-empty string');
  }
  const target = path.resolve(configPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const json = JSON.stringify(config, null, 2) + '\n';
  try {
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort cleanup */ }
    throw new Error(`saveConfig: cannot write ${target}: ${err.message}`);
  }
}

/** Copy of the config that is safe to expose over the API (no runtime-only fields). */
export function sanitizeConfig(config) {
  return {
    web: structuredClone(config.web ?? {}),
    events: structuredClone(config.events ?? {}),
    listeners: structuredClone(config.listeners ?? []),
    senderDefaults: structuredClone(config.senderDefaults ?? {}),
    ui: structuredClone(config.ui ?? {})
  };
}
