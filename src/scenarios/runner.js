// YAML scenarios: parse (strict shape validation), list a directory, run against an App instance.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { now } from '../core/events.js';
import { parseMessage } from '../hl7/parser.js';

export const SCENARIO_FILE_RE = /^[A-Za-z0-9_.-]+\.ya?ml$/;

const SCENARIO_KEYS = new Set(['name', 'description', 'continueOnFailure', 'target', 'vars', 'steps']);
const STEP_KEYS = new Set(['name', 'send', 'receive', 'wait', 'expect']);
const EXPECT_KEYS = new Set(['ack', 'framing', 'fields', 'maxReceiveMs']);
const EXPECT_ACK_KEYS = new Set(['msa1', 'controlIdMatches', 'maxAckMs', 'timeout']);
const FRAMING_KEYS = new Set([
  'prefixOk', 'suffixOk', 'segmentSeparator', 'trailingSeparator', 'knownVariant',
  'prefixHexActual', 'suffixHexActual', 'nonAsciiCount'
]);
const RECEIVE_KEYS = new Set(['listenerId', 'timeoutMs', 'match']);
const SEND_STRING_KEYS = ['host', 'prefixHex', 'suffixHex', 'encoding', 'ackPrefixHex', 'ackSuffixHex', 'id'];
const SEND_BOOL_KEYS = ['autoControlId', 'renderTemplate', 'normalizeSegmentSeparator', 'expectAck', 'keepAlive', 'logBytes'];
const SEND_NUMBER_KEYS = ['port', 'connectTimeoutMs', 'ackTimeoutMs', 'repeat', 'intervalMs'];
const TARGET_KEYS = new Set([...SEND_STRING_KEYS, ...SEND_BOOL_KEYS, ...SEND_NUMBER_KEYS]);
const MAX_WAIT_MS = 10 * 60 * 1000;
const MAX_RUNS = 50;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function fail(file, message) {
  throw new Error(`Scenario ${file}: ${message}`);
}

function checkKnownKeys(obj, allowed, where, file) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) fail(file, `${where} has unknown key '${key}' (allowed: ${[...allowed].join(', ')})`);
  }
}

function requireNumber(value, where, file, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(file, `${where} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function validateTargetLike(obj, where, file) {
  checkKnownKeys(obj, TARGET_KEYS, where, file);
  const out = {};
  for (const key of SEND_STRING_KEYS) {
    if (obj[key] === undefined) continue;
    if (obj[key] !== null && typeof obj[key] !== 'string') fail(file, `${where}.${key} must be a string`);
    out[key] = obj[key];
  }
  for (const key of SEND_BOOL_KEYS) {
    if (obj[key] === undefined) continue;
    if (typeof obj[key] !== 'boolean') fail(file, `${where}.${key} must be a boolean`);
    out[key] = obj[key];
  }
  for (const key of SEND_NUMBER_KEYS) {
    if (obj[key] === undefined) continue;
    const integer = ['port', 'repeat'].includes(key);
    const min = key === 'port' || key === 'repeat' ? 1 : 0;
    const max = key === 'port' ? 65535 : key === 'repeat' ? 100000 : 3_600_000;
    out[key] = requireNumber(obj[key], `${where}.${key}`, file, { min, max, integer });
  }
  return out;
}

function validateFieldsMap(obj, where, file) {
  if (!isPlainObject(obj)) fail(file, `${where} must be a mapping of HL7 path to expected value`);
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!/^[A-Z][A-Z0-9]{2}(\[\d+\])?(-\d+(\(\d+\))?(\.\d+(\.\d+)?)?)?$/.test(key)) {
      fail(file, `${where} has an invalid HL7 path '${key}' (expected e.g. PID-3.1, OBX[2]-5, PID-3(2).1)`);
    }
    if (!isScalar(value)) fail(file, `${where}['${key}'] must be a scalar value`);
    out[key] = value;
  }
  return out;
}

function validateExpect(expect, kind, where, file) {
  if (expect === undefined || expect === null) return null;
  if (!isPlainObject(expect)) fail(file, `${where} must be a mapping`);
  checkKnownKeys(expect, EXPECT_KEYS, where, file);
  const out = {};
  if (expect.ack !== undefined) {
    if (kind !== 'send') fail(file, `${where}.ack is only valid for send steps`);
    if (!isPlainObject(expect.ack)) fail(file, `${where}.ack must be a mapping`);
    checkKnownKeys(expect.ack, EXPECT_ACK_KEYS, `${where}.ack`, file);
    const ack = {};
    if (expect.ack.msa1 !== undefined) {
      const list = Array.isArray(expect.ack.msa1) ? expect.ack.msa1 : [expect.ack.msa1];
      if (list.length === 0 || !list.every((v) => typeof v === 'string' && v.trim())) {
        fail(file, `${where}.ack.msa1 must be a string or a non-empty list of strings`);
      }
      ack.msa1 = list.map((v) => v.trim().toUpperCase());
    }
    if (expect.ack.controlIdMatches !== undefined) {
      if (typeof expect.ack.controlIdMatches !== 'boolean') fail(file, `${where}.ack.controlIdMatches must be a boolean`);
      ack.controlIdMatches = expect.ack.controlIdMatches;
    }
    if (expect.ack.maxAckMs !== undefined) {
      ack.maxAckMs = requireNumber(expect.ack.maxAckMs, `${where}.ack.maxAckMs`, file, { min: 0, max: 3_600_000 });
    }
    if (expect.ack.timeout !== undefined) {
      if (typeof expect.ack.timeout !== 'boolean') fail(file, `${where}.ack.timeout must be a boolean`);
      ack.timeout = expect.ack.timeout;
    }
    out.ack = ack;
  }
  if (expect.framing !== undefined) {
    if (!isPlainObject(expect.framing)) fail(file, `${where}.framing must be a mapping`);
    checkKnownKeys(expect.framing, FRAMING_KEYS, `${where}.framing`, file);
    for (const [key, value] of Object.entries(expect.framing)) {
      if (!isScalar(value)) fail(file, `${where}.framing.${key} must be a scalar value`);
    }
    out.framing = { ...expect.framing };
  }
  if (expect.fields !== undefined) {
    out.fields = validateFieldsMap(expect.fields, `${where}.fields`, file);
  }
  if (expect.maxReceiveMs !== undefined) {
    if (kind !== 'receive') fail(file, `${where}.maxReceiveMs is only valid for receive steps`);
    out.maxReceiveMs = requireNumber(expect.maxReceiveMs, `${where}.maxReceiveMs`, file, { min: 0, max: 3_600_000 });
  }
  return out;
}

function validateStep(raw, index, file) {
  const where = `steps[${index}]`;
  if (!isPlainObject(raw)) fail(file, `${where} must be a mapping`);
  checkKnownKeys(raw, STEP_KEYS, where, file);
  const kinds = ['send', 'receive', 'wait'].filter((k) => raw[k] !== undefined);
  if (kinds.length !== 1) fail(file, `${where} must have exactly one of 'send', 'receive' or 'wait' (found: ${kinds.join(', ') || 'none'})`);
  const kind = kinds[0];
  if (raw.name !== undefined && typeof raw.name !== 'string') fail(file, `${where}.name must be a string`);
  const step = { index, name: raw.name?.trim() || `${kind} step ${index + 1}`, kind };

  if (kind === 'send') {
    const send = raw.send;
    if (!isPlainObject(send)) fail(file, `${where}.send must be a mapping`);
    const hasFile = send.file !== undefined;
    const hasMessage = send.message !== undefined;
    if (hasFile === hasMessage) fail(file, `${where}.send must have exactly one of 'file' or 'message'`);
    if (hasFile && (typeof send.file !== 'string' || !send.file.trim())) fail(file, `${where}.send.file must be a non-empty string`);
    if (hasMessage && (typeof send.message !== 'string' || !send.message.trim())) fail(file, `${where}.send.message must be a non-empty string`);
    const { file: sendFile, message, ...rest } = send;
    step.send = {
      ...validateTargetLike(rest, `${where}.send`, file),
      ...(hasFile ? { file: sendFile.trim() } : { message })
    };
  } else if (kind === 'receive') {
    const receive = raw.receive;
    if (!isPlainObject(receive)) fail(file, `${where}.receive must be a mapping`);
    checkKnownKeys(receive, RECEIVE_KEYS, `${where}.receive`, file);
    const listenerId = receive.listenerId === undefined ? 'default' : receive.listenerId;
    if (typeof listenerId !== 'string' || !listenerId.trim()) fail(file, `${where}.receive.listenerId must be a non-empty string`);
    const timeoutMs = receive.timeoutMs === undefined
      ? 10000
      : requireNumber(receive.timeoutMs, `${where}.receive.timeoutMs`, file, { min: 1, max: 3_600_000 });
    const match = receive.match === undefined ? {} : validateFieldsMap(receive.match, `${where}.receive.match`, file);
    step.receive = { listenerId: listenerId.trim(), timeoutMs, match };
  } else {
    const wait = raw.wait;
    let ms;
    if (typeof wait === 'number') {
      ms = wait;
    } else if (isPlainObject(wait)) {
      checkKnownKeys(wait, new Set(['ms']), `${where}.wait`, file);
      ms = wait.ms;
    } else {
      fail(file, `${where}.wait must be a number of milliseconds or a mapping { ms }`);
    }
    step.wait = { ms: requireNumber(ms, `${where}.wait.ms`, file, { min: 0, max: MAX_WAIT_MS }) };
  }

  step.expect = validateExpect(raw.expect, kind, `${where}.expect`, file);
  if (kind === 'wait' && step.expect && Object.keys(step.expect).length > 0) {
    fail(file, `${where}.expect is not allowed on wait steps`);
  }
  return step;
}

/** Parses and validates a YAML scenario. Throws an Error with a readable message on any shape problem. */
export function parseScenario(yamlText, { file = 'scenario.yaml' } = {}) {
  if (typeof yamlText !== 'string') fail(file, 'YAML text must be a string');
  let doc;
  try {
    doc = yaml.load(yamlText, { filename: file });
  } catch (err) {
    fail(file, `invalid YAML: ${err.message}`);
  }
  if (!isPlainObject(doc)) fail(file, 'the document must be a mapping with a "steps" list');
  checkKnownKeys(doc, SCENARIO_KEYS, 'document', file);

  const baseName = path.basename(file).replace(/\.ya?ml$/i, '');
  if (doc.name !== undefined && (typeof doc.name !== 'string' || !doc.name.trim())) fail(file, "'name' must be a non-empty string");
  if (doc.description !== undefined && doc.description !== null && typeof doc.description !== 'string') fail(file, "'description' must be a string");
  if (doc.continueOnFailure !== undefined && typeof doc.continueOnFailure !== 'boolean') fail(file, "'continueOnFailure' must be a boolean");

  let target = {};
  if (doc.target !== undefined && doc.target !== null) {
    if (!isPlainObject(doc.target)) fail(file, "'target' must be a mapping");
    target = validateTargetLike(doc.target, 'target', file);
  }

  let vars = {};
  if (doc.vars !== undefined && doc.vars !== null) {
    if (!isPlainObject(doc.vars)) fail(file, "'vars' must be a mapping");
    for (const [key, value] of Object.entries(doc.vars)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) fail(file, `vars key '${key}' must be an identifier`);
      if (!isScalar(value)) fail(file, `vars.${key} must be a scalar value`);
      vars[key] = value === null ? '' : String(value);
    }
  }

  if (!Array.isArray(doc.steps) || doc.steps.length === 0) fail(file, "'steps' must be a non-empty list");
  const steps = doc.steps.map((raw, index) => validateStep(raw, index, file));

  return {
    name: doc.name?.trim() || baseName,
    description: doc.description ?? '',
    file,
    continueOnFailure: doc.continueOnFailure === true,
    target,
    vars,
    steps
  };
}

/** Lists *.yaml / *.yml scenarios in a directory. Broken files are listed with `error`, never thrown. */
export function loadScenarios(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const infos = [];
  for (const fileName of names.filter((n) => SCENARIO_FILE_RE.test(n)).sort()) {
    const id = fileName.replace(/\.ya?ml$/i, '');
    try {
      const text = fs.readFileSync(path.join(dir, fileName), 'utf8');
      const scenario = parseScenario(text, { file: fileName });
      infos.push({
        id,
        name: scenario.name,
        file: fileName,
        description: scenario.description,
        stepCount: scenario.steps.length
      });
    } catch (err) {
      infos.push({ id, name: id, file: fileName, description: '', stepCount: 0, error: err.message });
    }
  }
  return infos;
}

/** Replaces {{vars.name}} placeholders only; other placeholders are left for the sender's template renderer. */
export function substituteVars(text, vars = {}) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{\{\s*vars\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  ));
}

function renderValue(value, vars) {
  return typeof value === 'string' ? substituteVars(value, vars) : value;
}

function round(ms) {
  return Math.round(ms * 1000) / 1000;
}

function stripLeadingComments(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  let start = 0;
  while (start < lines.length && (lines[start].startsWith('#') || lines[start].trim() === '')) start += 1;
  return lines.slice(start).join('\n');
}

function readMessageFile(relativeFile, rootDir) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativeFile);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`send.file must resolve inside the project root: ${relativeFile}`);
  }
  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new Error(`send.file cannot be read (${relativeFile}): ${err.message}`);
  }
  const body = stripLeadingComments(text);
  if (!body.trim()) throw new Error(`send.file is empty: ${relativeFile}`);
  return body;
}

function safeGet(text, hl7Path) {
  try {
    return parseMessage(text).get(hl7Path);
  } catch (err) {
    return `<error: ${err.message}>`;
  }
}

function assertion(name, ok, expected, actual) {
  return { name, ok: Boolean(ok), expected, actual };
}

function compareScalar(expected, actual) {
  if (typeof expected === 'boolean' || typeof expected === 'number') return expected === actual;
  if (expected === null) return actual === null || actual === undefined || actual === '';
  return String(expected) === String(actual ?? '');
}

function framingAssertions(expectFraming, framing, prefix) {
  const out = [];
  for (const [key, expected] of Object.entries(expectFraming)) {
    const actual = framing ? framing[key] : undefined;
    out.push(assertion(`${prefix}.${key}`, framing !== null && framing !== undefined && compareScalar(expected, actual), expected, actual ?? null));
  }
  return out;
}

function fieldAssertions(expectFields, text, vars, prefix) {
  const out = [];
  for (const [hl7Path, rawExpected] of Object.entries(expectFields)) {
    const expected = renderValue(rawExpected, vars);
    const actual = typeof text === 'string' ? safeGet(text, hl7Path) : null;
    out.push(assertion(`${prefix}.${hl7Path}`, actual !== null && compareScalar(expected, actual), expected, actual));
  }
  return out;
}

function timedOut(result, app) {
  const viaEvents = Array.isArray(result.eventIds) && result.eventIds.some((id) => {
    try { return app.events.get(id)?.type === 'ack.timeout'; } catch { return false; }
  });
  return viaEvents || (!result.ok && result.errorPhase === 'ack' && /time\s*out/i.test(result.error ?? ''));
}

function sendAssertions(expect, result, app, vars, prefix) {
  const out = [];
  const ack = expect?.ack ?? {};
  const expectTimeout = ack.timeout === true;
  const ackObj = result.ack ?? null;
  const validation = ackObj?.validation ?? null;
  const timings = result.timings ?? {};

  if (expectTimeout) {
    const delivered = !['connect', 'send'].includes(result.errorPhase);
    out.push(assertion(`${prefix}send.delivered`, delivered, true, delivered ? true : `${result.errorPhase}: ${result.error}`));
    const isTimeout = timedOut(result, app);
    out.push(assertion(`${prefix}ack.timeout`, isTimeout, true, isTimeout ? true : (ackObj ? `ack received (MSA-1 ${validation?.msa1 ?? '?'})` : result.error ?? false)));
  } else {
    out.push(assertion(`${prefix}send.ok`, result.ok === true, true, result.ok === true ? true : `${result.errorPhase ?? 'error'}: ${result.error ?? 'unknown error'}`));
    if (ack.timeout === false) {
      out.push(assertion(`${prefix}ack.received`, ackObj !== null, true, ackObj !== null));
    }
  }
  if (ack.msa1 !== undefined) {
    const actual = validation?.msa1 ?? null;
    out.push(assertion(`${prefix}ack.msa1`, actual !== null && ack.msa1.includes(String(actual).toUpperCase()), ack.msa1.length === 1 ? ack.msa1[0] : ack.msa1, actual));
  }
  if (ack.controlIdMatches !== undefined) {
    const actual = validation ? validation.controlIdMatches === true : null;
    out.push(assertion(`${prefix}ack.controlIdMatches`, actual === ack.controlIdMatches, ack.controlIdMatches, validation ? actual : null));
  }
  if (ack.maxAckMs !== undefined) {
    const actual = typeof timings.ackMs === 'number' ? round(timings.ackMs) : null;
    out.push(assertion(`${prefix}ack.maxAckMs`, actual !== null && actual <= ack.maxAckMs, `<= ${ack.maxAckMs} ms`, actual));
  }
  if (expect?.framing) {
    out.push(...framingAssertions(expect.framing, ackObj?.framing ?? null, `${prefix}framing`));
  }
  if (expect?.fields) {
    out.push(...fieldAssertions(expect.fields, ackObj?.text ?? null, vars, `${prefix}fields`));
  }
  return out;
}

function receiveAssertions(expect, event, vars) {
  const out = [];
  const data = event?.data ?? {};
  if (expect?.fields) out.push(...fieldAssertions(expect.fields, data.text ?? null, vars, 'fields'));
  if (expect?.framing) out.push(...framingAssertions(expect.framing, data.framing ?? null, 'framing'));
  if (expect?.maxReceiveMs !== undefined) {
    const actual = typeof event?.latencyMs === 'number' ? round(event.latencyMs) : (typeof data.timing?.receiveMs === 'number' ? round(data.timing.receiveMs) : null);
    out.push(assertion('receive.maxReceiveMs', actual !== null && actual <= expect.maxReceiveMs, `<= ${expect.maxReceiveMs} ms`, actual));
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderMatch(match, vars) {
  const out = {};
  for (const [key, value] of Object.entries(match)) out[key] = renderValue(value, vars);
  return out;
}

function pushScenarioEvent(app, type, runId, level, summary, data) {
  try {
    app.events.push({
      source: 'scenario', endpointId: runId, connId: null, type, direction: null,
      level, summary, latencyMs: null, data
    });
  } catch (err) {
    console.error(`[scenario] cannot push ${type} event: ${err.message}`);
  }
}

async function executeStep(step, ctx) {
  const { app, target, vars } = ctx;
  if (step.kind === 'wait') {
    await sleep(step.wait.ms);
    return { status: 'passed', assertions: [], result: null };
  }
  if (step.kind === 'send') {
    const { file, message, ...sendOpts } = step.send;
    const text = substituteVars(file !== undefined ? readMessageFile(file, ctx.rootDir) : message, vars);
    const req = { ...target, ...sendOpts, message: text };
    const sent = await app.send(req);
    const results = Array.isArray(sent?.results) ? sent.results : [];
    if (results.length === 0) {
      return { status: 'error', assertions: [], result: sent ?? null, error: 'sender returned no results' };
    }
    const assertions = results.length === 1
      ? sendAssertions(step.expect, results[0], app, vars, '')
      : results.flatMap((result, i) => sendAssertions(step.expect, result, app, vars, `#${i + 1} `));
    const status = assertions.every((a) => a.ok) ? 'passed' : 'failed';
    return { status, assertions, result: sent };
  }
  // receive
  const { listenerId, timeoutMs, match } = step.receive;
  let event;
  try {
    // messages received since the scenario started count, each one is used by one receive step only
    event = await app.waitForMessage(listenerId, { timeoutMs, match: renderMatch(match, vars), sinceId: ctx.receiveSinceId });
    ctx.receiveSinceId = event.id;
  } catch (err) {
    if (err && Number.isInteger(err.status) && err.status === 404) {
      return { status: 'error', assertions: [], result: null, error: err.message };
    }
    return {
      status: 'failed',
      assertions: [assertion('receive.message', false, `message on listener '${listenerId}' within ${timeoutMs} ms`, err?.message ?? 'timeout')],
      result: null
    };
  }
  const assertions = [
    assertion('receive.message', true, `message on listener '${listenerId}' within ${timeoutMs} ms`, `received ${event?.data?.summary?.messageType ?? '?'}^${event?.data?.summary?.triggerEvent ?? '?'} (control id ${event?.data?.summary?.controlId ?? '?'})`),
    ...receiveAssertions(step.expect, event, vars)
  ];
  return { status: assertions.every((a) => a.ok) ? 'passed' : 'failed', assertions, result: event };
}

function applyOverrides(scenario, overrides) {
  if (overrides === undefined || overrides === null) return scenario;
  if (!isPlainObject(overrides)) throw new Error('overrides must be an object');
  const file = scenario.file;
  // Unknown keys (e.g. a flat { host, port }) would otherwise be ignored and the scenario would silently
  // run against the wrong target, so they are rejected with a readable message.
  const allowedKeys = ['target', 'vars', 'continueOnFailure'];
  for (const key of Object.keys(overrides)) {
    if (!allowedKeys.includes(key)) {
      fail(file, `overrides.${key} is not supported (allowed: ${allowedKeys.join(', ')}; put host/port under overrides.target)`);
    }
  }
  const out = { ...scenario, target: { ...scenario.target }, vars: { ...scenario.vars } };
  if (overrides.target !== undefined && overrides.target !== null) {
    if (!isPlainObject(overrides.target)) fail(file, 'overrides.target must be a mapping');
    Object.assign(out.target, validateTargetLike(overrides.target, 'overrides.target', file));
  }
  if (overrides.vars !== undefined && overrides.vars !== null) {
    if (!isPlainObject(overrides.vars)) fail(file, 'overrides.vars must be a mapping');
    for (const [key, value] of Object.entries(overrides.vars)) {
      if (!isScalar(value)) fail(file, `overrides.vars.${key} must be a scalar value`);
      out.vars[key] = value === null ? '' : String(value);
    }
  }
  if (overrides.continueOnFailure !== undefined) {
    if (typeof overrides.continueOnFailure !== 'boolean') fail(file, 'overrides.continueOnFailure must be a boolean');
    out.continueOnFailure = overrides.continueOnFailure;
  }
  return out;
}

/**
 * Runs a parsed scenario against an App. Never rejects for step failures: every step problem is
 * recorded in the returned ScenarioRun. Rejects only for invalid arguments.
 */
export async function runScenario(scenario, app, { overrides } = {}) {
  if (!isPlainObject(scenario) || !Array.isArray(scenario.steps)) {
    throw new Error('runScenario: scenario must be a parsed scenario object');
  }
  if (!app || typeof app.send !== 'function' || typeof app.waitForMessage !== 'function' || !app.events) {
    throw new Error('runScenario: app must provide send(), waitForMessage() and events');
  }
  const effective = applyOverrides(scenario, overrides);
  const runId = globalThis.crypto.randomUUID();
  const started = now();
  const ctx = {
    app,
    target: effective.target,
    vars: effective.vars,
    rootDir: app.rootDir ?? process.cwd(),
    receiveSinceId: app.events.stats().lastId ?? 0,
  };
  const run = {
    runId,
    name: effective.name,
    file: effective.file,
    startedAt: started.ts,
    finishedAt: null,
    durationMs: null,
    status: 'passed',
    steps: []
  };

  pushScenarioEvent(app, 'scenario.start', runId, 'info',
    `Scenario '${effective.name}' started (${effective.steps.length} steps)`,
    { runId, name: effective.name, stepCount: effective.steps.length });

  let stop = false;
  for (const step of effective.steps) {
    const t0 = now().mono;
    const record = { index: step.index, name: step.name, kind: step.kind, status: 'skipped', durationMs: 0, assertions: [], result: null, error: null };
    if (!stop) {
      try {
        const outcome = await executeStep(step, ctx);
        record.status = outcome.status;
        record.assertions = outcome.assertions;
        record.result = outcome.result;
        record.error = outcome.error ?? null;
      } catch (err) {
        record.status = 'error';
        record.error = err?.message ?? String(err);
      }
      record.durationMs = round(now().mono - t0);
      if (record.status !== 'passed' && !effective.continueOnFailure) stop = true;
    }
    run.steps.push(record);
    const level = record.status === 'passed' || record.status === 'skipped' ? 'info' : 'error';
    const detail = record.error ? `: ${record.error}` : '';
    pushScenarioEvent(app, 'scenario.step', runId, level,
      `Step ${step.index + 1}/${effective.steps.length} '${step.name}' ${record.status} in ${record.durationMs} ms${detail}`,
      { runId, stepIndex: step.index, name: step.name, status: record.status, durationMs: record.durationMs, assertions: record.assertions });
  }

  const finished = now();
  run.finishedAt = finished.ts;
  run.durationMs = round(finished.mono - started.mono);
  const passed = run.steps.filter((s) => s.status === 'passed').length;
  const failed = run.steps.filter((s) => s.status === 'failed').length;
  const errored = run.steps.filter((s) => s.status === 'error').length;
  run.status = errored > 0 ? 'error' : (failed > 0 || passed < run.steps.length ? 'failed' : 'passed');

  pushScenarioEvent(app, 'scenario.end', runId, run.status === 'passed' ? 'info' : 'error',
    `Scenario '${effective.name}' ${run.status}: ${passed} passed, ${failed} failed${errored ? `, ${errored} errors` : ''} in ${run.durationMs} ms`,
    { runId, status: run.status, durationMs: run.durationMs, passed, failed });
  return run;
}

/** Appends a run to a bounded list (newest first, last MAX_RUNS kept). */
export function rememberRun(runs, run, max = MAX_RUNS) {
  runs.unshift(run);
  if (runs.length > max) runs.length = max;
  return runs;
}
