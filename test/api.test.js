// REST + WebSocket tests: web server on port 0, listener on an ephemeral port, temporary config file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { freePort } from './helpers.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { App } from '../src/app.js';
import { createWebServer } from '../src/web/server.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(rootDir, 'test-tmp', `api-${process.pid}-${Date.now()}`);
const configPath = path.join(tmpDir, 'app.json');

const ADT = [
  'MSH|^~\\&|HIS|SZPITAL|BRAMKA|LAB|20261007120000||ADT^A01^ADT_A01|TEST0001|P|2.5|||AL|NE|PL|UNICODE UTF-8',
  'EVN|A01|20261007120000',
  'PID|1||85010212345^^^SZPITAL^PI||Zażółć^Gęślą^Jaźń||19850102|M',
  'PV1|1|I|ODDZ^SALA^LOZKO'
].join('\r') + '\r';

let app;
let server;
let base;
let listenerPort;

async function api(route, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const type = res.headers.get('content-type') ?? '';
  let data = null;
  if (res.status !== 204) {
    data = type.includes('application/json') ? await res.json() : await res.text();
  }
  return { res, data };
}

function waitForMessage(ws, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('ws message timeout'));
    }, timeoutMs);
    const onMessage = (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(msg)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg);
    };
    ws.on('message', onMessage);
  });
}

before(async () => {
  listenerPort = await freePort();
  const config = structuredClone(DEFAULT_CONFIG);
  config.web = { host: '127.0.0.1', port: 0 };
  config.events.ndjsonPath = null;
  config.listeners = [{ ...structuredClone(DEFAULT_CONFIG.listeners[0]), id: 'default', host: '127.0.0.1', port: listenerPort }];
  fs.mkdirSync(tmpDir, { recursive: true });
  app = new App(config, { configPath, rootDir });
  await app.start();
  server = createWebServer(app, { host: '127.0.0.1', port: 0 });
  const { port } = await server.start();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await server.stop();
  if (app) await app.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /api/health', async () => {
  const { res, data } = await api('/api/health');
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(typeof data.uptimeMs, 'number');
  assert.ok(data.uptimeMs >= 0);
  assert.equal(typeof data.version, 'string');
});

test('GET /api/state has the contract shape', async () => {
  const { res, data } = await api('/api/state');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(data.listeners));
  assert.equal(data.listeners[0].id, 'default');
  assert.equal(data.listeners[0].state, 'listening');
  assert.equal(typeof data.events.count, 'number');
  assert.ok(data.config.web && data.config.ui && data.config.senderDefaults);
  assert.ok(Array.isArray(data.scenarios.available));
  assert.ok(Array.isArray(data.scenarios.lastRuns));
  assert.equal(typeof data.uptimeMs, 'number');
  assert.equal(typeof data.serverTime.ts, 'string');
  assert.equal(typeof data.serverTime.mono, 'number');
});

test('POST /api/parse parses plain text and reports framing when control bytes are present', async () => {
  const plain = await api('/api/parse', { method: 'POST', body: { text: ADT } });
  assert.equal(plain.res.status, 200);
  assert.equal(plain.data.summary.messageType, 'ADT');
  assert.equal(plain.data.summary.triggerEvent, 'A01');
  assert.equal(plain.data.summary.controlId, 'TEST0001');
  assert.equal(plain.data.framing, null);
  assert.ok(Array.isArray(plain.data.message.segments));
  assert.equal(plain.data.message.segments.length, 4);
  assert.ok(Array.isArray(plain.data.tokens.segments));
  assert.ok(Array.isArray(plain.data.fieldNames.PID));
  assert.ok(plain.data.fieldNames.PID.length > 5);
  assert.ok(Array.isArray(plain.data.warnings));

  const framed = await api('/api/parse', { method: 'POST', body: { text: `\u000B${ADT}\u001C\r` } });
  assert.equal(framed.res.status, 200);
  assert.ok(framed.data.framing, 'framing analysis expected');
  assert.equal(framed.data.framing.prefixOk, true);
  assert.equal(framed.data.framing.suffixOk, true);
  assert.equal(framed.data.summary.controlId, 'TEST0001');

  const wrongPrefix = await api('/api/parse', { method: 'POST', body: { text: `\u0000${ADT}\u001C\r` } });
  assert.equal(wrongPrefix.res.status, 200);
  assert.equal(wrongPrefix.data.framing.prefixOk, false);
});

test('POST /api/parse validates input', async () => {
  const missing = await api('/api/parse', { method: 'POST', body: {} });
  assert.equal(missing.res.status, 400);
  assert.equal(typeof missing.data.error, 'string');

  const badHex = await api('/api/parse', { method: 'POST', body: { text: `\u000B${ADT}\u001C\r`, prefixHex: 'ZZ' } });
  assert.equal(badHex.res.status, 400);

  const badJson = await fetch(base + '/api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(badJson.status, 400);
  const body = await badJson.json();
  assert.match(body.error, /JSON/);
});

test('POST /api/send round trip against the test listener', async () => {
  const { res, data } = await api('/api/send', {
    method: 'POST',
    body: { host: '127.0.0.1', port: listenerPort, message: ADT, autoControlId: true, ackTimeoutMs: 5000 }
  });
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.summary.count, 1);
  assert.equal(data.summary.ok, 1);
  assert.equal(data.results.length, 1);
  const result = data.results[0];
  assert.equal(result.ok, true, result.error ?? '');
  assert.equal(typeof result.controlId, 'string');
  assert.notEqual(result.controlId, 'TEST0001');
  for (const key of ['connectMs', 'sendMs', 'firstByteMs', 'ackMs', 'totalMs']) {
    assert.equal(typeof result.timings[key], 'number', `timings.${key} must be a number`);
    assert.ok(result.timings[key] >= 0, `timings.${key} must be >= 0`);
  }
  assert.ok(result.ack, 'ack expected');
  assert.equal(result.ack.validation.msa1, 'AA');
  assert.equal(result.ack.validation.controlIdMatches, true);
  assert.equal(result.ack.validation.msa2, result.controlId);
  assert.equal(result.ack.framing.prefixOk, true);
  assert.equal(result.ack.framing.suffixOk, true);
  assert.ok(Array.isArray(result.eventIds));
  assert.ok(result.eventIds.length > 0);
});

test('POST /api/send validates input', async () => {
  const noMessage = await api('/api/send', { method: 'POST', body: { host: '127.0.0.1', port: listenerPort } });
  assert.equal(noMessage.res.status, 400);
  assert.match(noMessage.data.error, /message/);
  const badPort = await api('/api/send', { method: 'POST', body: { host: '127.0.0.1', port: 70000, message: ADT } });
  assert.equal(badPort.res.status, 400);
  const badHex = await api('/api/send', { method: 'POST', body: { host: '127.0.0.1', port: listenerPort, message: ADT, suffixHex: '1C0' } });
  assert.equal(badHex.res.status, 400);
});

test('GET /api/events supports filters', async () => {
  const all = await api('/api/events');
  assert.equal(all.res.status, 200);
  assert.ok(Array.isArray(all.data.events));
  assert.ok(all.data.events.length > 0);
  assert.equal(typeof all.data.stats.count, 'number');
  for (const event of all.data.events) {
    assert.equal(typeof event.id, 'number');
    assert.match(event.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(typeof event.mono, 'number');
  }

  const typed = await api('/api/events?types=msg.in,ack.out');
  assert.equal(typed.res.status, 200);
  assert.ok(typed.data.events.length >= 2);
  assert.ok(typed.data.events.every((e) => e.type === 'msg.in' || e.type === 'ack.out'));
  const msgIn = typed.data.events.find((e) => e.type === 'msg.in');
  assert.equal(msgIn.direction, 'in');
  assert.equal(typeof msgIn.latencyMs, 'number');
  assert.equal(msgIn.data.summary.messageType, 'ADT');
  const ackOut = typed.data.events.find((e) => e.type === 'ack.out');
  assert.equal(typeof ackOut.latencyMs, 'number');
  assert.ok(ackOut.latencyMs >= 0);

  const byEndpoint = await api('/api/events?endpointId=default');
  assert.ok(byEndpoint.data.events.length > 0);
  assert.ok(byEndpoint.data.events.every((e) => e.endpointId === 'default'));

  const midId = all.data.events[Math.floor(all.data.events.length / 2)].id;
  const since = await api(`/api/events?sinceId=${midId}`);
  assert.ok(since.data.events.every((e) => e.id > midId));

  const limited = await api('/api/events?limit=1');
  assert.equal(limited.data.events.length, 1);

  const byLevel = await api('/api/events?level=info');
  assert.ok(byLevel.data.events.every((e) => e.level === 'info'));

  const badLevel = await api('/api/events?level=bogus');
  assert.equal(badLevel.res.status, 400);
  const badLimit = await api('/api/events?limit=abc');
  assert.equal(badLimit.res.status, 400);

  const one = await api(`/api/events/${all.data.events[0].id}`);
  assert.equal(one.res.status, 200);
  assert.equal(one.data.id, all.data.events[0].id);
  const missing = await api('/api/events/99999999');
  assert.equal(missing.res.status, 404);
  const badId = await api('/api/events/abc');
  assert.equal(badId.res.status, 400);
});

test('GET /api/events/export returns downloadable CSV / NDJSON', async () => {
  const csv = await fetch(base + '/api/events/export?format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /^attachment; filename="simple-hl7-events-.*\.csv"$/);
  // text() would drop the BOM, so the bytes are read as they came
  const csvBytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...csvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csvText = csvBytes.toString('utf8');
  assert.ok(csvText.startsWith('\uFEFFid;ts;source;endpointId;connId;type;direction;level;summary;latencyMs'), csvText.slice(0, 120));
  assert.ok(csvText.trim().split('\n').length > 1);

  const filtered = await fetch(base + '/api/events/export?format=ndjson&types=msg.in');
  assert.equal(filtered.status, 200);
  const filteredLines = (await filtered.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(filteredLines.every((e) => e.type === 'msg.in'));

  const json = await fetch(base + '/api/events/export?format=json');
  assert.equal(json.status, 400, 'JSON export was removed');

  const ndjson = await fetch(base + '/api/events/export');
  assert.equal(ndjson.status, 200);
  assert.match(ndjson.headers.get('content-type'), /ndjson/);
  const lines = (await ndjson.text()).trim().split('\n');
  assert.ok(lines.length > 0);
  JSON.parse(lines[0]);

  const bad = await fetch(base + '/api/events/export?format=xml');
  assert.equal(bad.status, 400);
});

test('GET /lib/*.js serves browser-safe HL7 modules only', async () => {
  const parser = await fetch(base + '/lib/parser.js');
  assert.equal(parser.status, 200);
  assert.match(parser.headers.get('content-type'), /^text\/javascript/);
  const source = await parser.text();
  assert.match(source, /export function parseMessage/);

  const encoding = await fetch(base + '/lib/encoding.js');
  assert.equal(encoding.status, 404);
  const missing = await fetch(base + '/lib/nope.js');
  assert.equal(missing.status, 404);
  const notJs = await fetch(base + '/lib/parser.txt');
  assert.equal(notJs.status, 404);
});

test('WebSocket /ws sends a snapshot and answers ping', async () => {
  const ws = new WebSocket(base.replace('http://', 'ws://') + '/ws');
  const snapshotPromise = waitForMessage(ws, (m) => m.type === 'snapshot');
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const snapshot = await snapshotPromise;
  assert.equal(snapshot.type, 'snapshot');
  assert.ok(Array.isArray(snapshot.state.listeners));
  assert.equal(snapshot.state.listeners[0].id, 'default');
  assert.ok(Array.isArray(snapshot.events));
  assert.ok(snapshot.events.length > 0);
  assert.equal(typeof snapshot.serverTime.ts, 'string');

  const pongPromise = waitForMessage(ws, (m) => m.type === 'pong');
  ws.send(JSON.stringify({ type: 'ping' }));
  const pong = await pongPromise;
  assert.equal(typeof pong.serverTime.tsMs, 'number');

  const eventPromise = waitForMessage(ws, (m) => m.type === 'event' && m.event.type === 'msg.in');
  const sent = await api('/api/send', { method: 'POST', body: { host: '127.0.0.1', port: listenerPort, message: ADT, autoControlId: true } });
  assert.equal(sent.res.status, 200);
  const live = await eventPromise;
  assert.equal(live.event.type, 'msg.in');
  assert.equal(live.event.endpointId, 'default');

  ws.close();
  await new Promise((resolve) => ws.once('close', resolve));
});

test('listener CRUD persists the config file', async () => {
  const port = await freePort();
  const created = await api('/api/listeners', { method: 'POST', body: { id: 'second', name: 'Drugi', host: '127.0.0.1', port, prefixHex: '0b', suffixHex: '1c 0d' } });
  assert.equal(created.res.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.id, 'second');
  assert.equal(created.data.state, 'listening');
  assert.equal(created.data.config.prefixHex, '0B');
  assert.equal(created.data.config.suffixHex, '1C0D');

  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.ok(saved.listeners.some((l) => l.id === 'second'));

  const duplicate = await api('/api/listeners', { method: 'POST', body: { id: 'second', host: '127.0.0.1', port: await freePort() } });
  assert.equal(duplicate.res.status, 409);
  const badHex = await api('/api/listeners', { method: 'POST', body: { id: 'third', host: '127.0.0.1', port: await freePort(), prefixHex: 'XY' } });
  assert.equal(badHex.res.status, 400);
  const badId = await api('/api/listeners', { method: 'POST', body: { id: '../x', host: '127.0.0.1', port: await freePort() } });
  assert.equal(badId.res.status, 400);

  const updated = await api('/api/listeners/second', { method: 'PUT', body: { ack: { mode: 'AE', textMessage: 'Odrzucone' } } });
  assert.equal(updated.res.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.config.ack.mode, 'AE');
  assert.equal(updated.data.config.ack.textMessage, 'Odrzucone');
  assert.equal(updated.data.config.port, port);

  const list = await api('/api/listeners');
  assert.equal(list.data.filter((l) => l.id === 'second').length, 1);

  const stopped = await api('/api/listeners/second/stop', { method: 'POST' });
  assert.equal(stopped.res.status, 200);
  assert.equal(stopped.data.state, 'stopped');
  const started = await api('/api/listeners/second/start', { method: 'POST' });
  assert.equal(started.res.status, 200);
  assert.equal(started.data.state, 'listening');

  const removed = await api('/api/listeners/second', { method: 'DELETE' });
  assert.equal(removed.res.status, 204);
  const afterRemove = await api('/api/listeners');
  assert.ok(!afterRemove.data.some((l) => l.id === 'second'));
  const notFound = await api('/api/listeners/second', { method: 'DELETE' });
  assert.equal(notFound.res.status, 404);
  const savedAfter = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.ok(!savedAfter.listeners.some((l) => l.id === 'second'));
});

test('POST /api/ack/preview builds an ACK with tokens', async () => {
  const { res, data } = await api('/api/ack/preview', { method: 'POST', body: { text: ADT, code: 'AE', textMessage: 'Blad', errorCode: '207' } });
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.match(data.ack, /^MSH\|/);
  assert.match(data.ack, /MSA\|AE\|TEST0001\|Blad/);
  assert.match(data.ack, /ERR\|/);
  assert.ok(Array.isArray(data.tokens.segments));
  const bad = await api('/api/ack/preview', { method: 'POST', body: { code: 'AA' } });
  assert.equal(bad.res.status, 400);
});

test('GET /api/examples and /api/scenarios list project files', async () => {
  const examples = await api('/api/examples');
  assert.equal(examples.res.status, 200);
  const adt = examples.data.find((e) => e.name === 'adt_a01');
  assert.ok(adt, 'adt_a01 example expected');
  assert.equal(adt.file, 'adt_a01.hl7');
  assert.ok(adt.description.length > 0);
  assert.ok(adt.text.startsWith('MSH|'));
  assert.match(adt.text, /\{\{controlId\}\}/);

  const scenarios = await api('/api/scenarios');
  assert.equal(scenarios.res.status, 200);
  const names = scenarios.data.map((s) => s.file);
  for (const file of ['01_czy_bramka_odpowiada.yaml', '02_przyjecie_pacjenta_a01.yaml', '03_hospitalizacja_a01_a08_a03.yaml', '04_polskie_znaki_iso8859_2.yaml', '05_bledna_wiadomosc.yaml', '06_zlecenie_i_wynik.yaml', '07_odbior_z_bramki.yaml', '08_czas_odpowiedzi_20x.yaml', '09_zly_sufiks.yaml']) {
    assert.ok(names.includes(file), `${file} expected in scenario list`);
  }
  assert.ok(scenarios.data.every((s) => !s.error), JSON.stringify(scenarios.data));

  const runs = await api('/api/scenarios/runs');
  assert.equal(runs.res.status, 200);
  assert.ok(Array.isArray(runs.data));
  const missingRun = await api('/api/scenarios/runs/does-not-exist');
  assert.equal(missingRun.res.status, 404);
  const missingScenario = await api('/api/scenarios/does_not_exist/run', { method: 'POST', body: {} });
  assert.equal(missingScenario.res.status, 404);
});

test('POST /api/scenarios/:name/run executes a scenario with overrides', async () => {
  const { res, data } = await api('/api/scenarios/02_przyjecie_pacjenta_a01/run', {
    method: 'POST',
    body: { overrides: { target: { host: '127.0.0.1', port: listenerPort, ackTimeoutMs: 5000 } } }
  });
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.status, 'passed', JSON.stringify(data.steps.map((s) => s.assertions)));
  assert.equal(typeof data.runId, 'string');
  assert.equal(typeof data.durationMs, 'number');
  const fetched = await api(`/api/scenarios/runs/${data.runId}`);
  assert.equal(fetched.res.status, 200);
  assert.equal(fetched.data.runId, data.runId);
  const state = await api('/api/state');
  assert.ok(state.data.scenarios.lastRuns.some((r) => r.runId === data.runId));
});

test('GET /api/config and PUT /api/config/ui', async () => {
  const cfg = await api('/api/config');
  assert.equal(cfg.res.status, 200);
  assert.ok(cfg.data.web && cfg.data.ui && cfg.data.listeners && cfg.data.senderDefaults);

  const ok = await api('/api/config/ui', { method: 'PUT', body: { latencyThresholds: { warnMs: 200, badMs: 800 } } });
  assert.equal(ok.res.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.latencyThresholds.warnMs, 200);
  assert.equal(ok.data.latencyThresholds.badMs, 800);
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(saved.ui.latencyThresholds.badMs, 800);

  const bad = await api('/api/config/ui', { method: 'PUT', body: { latencyThresholds: { warnMs: 900, badMs: 800 } } });
  assert.equal(bad.res.status, 400);
});

test('unknown routes return JSON 404 and DELETE /api/events clears', async () => {
  const missing = await api('/api/nope');
  assert.equal(missing.res.status, 404);
  assert.equal(typeof missing.data.error, 'string');

  const cleared = await api('/api/events', { method: 'DELETE' });
  assert.equal(cleared.res.status, 204);
  const after = await api('/api/events');
  assert.equal(after.data.events.length, 0);
});

test('POST /api/scenarios/:name/stop answers 409 when the scenario is not running', async () => {
  const r = await fetch(base + '/api/scenarios/01_czy_bramka_odpowiada/stop', { method: 'POST' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /not running/);
});
