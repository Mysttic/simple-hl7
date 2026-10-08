// Shared test helpers. Transport tests must not depend on src/hl7, so the HL7 pieces
// (parse, ackBuilder, encoding) are tiny stubs injected through deps.

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventStore } from '../src/core/events.js';
import { MllpListener } from '../src/mllp/listener.js';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SAMPLE_ADT =
  'MSH|^~\\&|SENDAPP|SENDFAC|RECVAPP|RECVFAC|20260101120000||ADT^A01^ADT_A01|MSG00001|P|2.5\r'
  + 'EVN|A01|20260101120000\r'
  + 'PID|1||12345^^^HOSP^MR||Kowalski^Jan||19800101|M\r'
  + 'PV1|1|I\r';

/** Ephemeral TCP port: listen on 0, read the port, close. */
export function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/** Minimal MessageSummary from MSH fields (split based, no real parser). */
export function stubParse(text) {
  if (typeof text !== 'string') return null;
  const segments = text.split(/\r\n|\r|\n/).filter((s) => s.length > 0);
  const msh = segments.find((s) => s.startsWith('MSH'));
  if (!msh || msh.length < 4) return null;
  const fs = msh[3];
  const parts = msh.split(fs);
  const enc = parts[1] || '^~\\&';
  const comp = enc[0] || '^';
  const field = (n) => (parts[n - 1] === undefined ? '' : parts[n - 1]);
  const type = field(9).split(comp);
  return {
    messageType: type[0] || '',
    triggerEvent: type[1] || '',
    messageStructure: type[2] || '',
    controlId: field(10),
    sendingApplication: field(3),
    sendingFacility: field(4),
    receivingApplication: field(5),
    receivingFacility: field(6),
    timestamp: field(7),
    version: field(12),
    processingId: field(11),
    characterSet: field(18),
    segmentNames: segments.map((s) => s.slice(0, 3)),
    segmentCount: segments.length,
    description: '',
  };
}

let ackCounter = 0;

/** Minimal ACK: MSH + MSA with the code taken from config.ack.mode. */
export function stubAckBuilder({ text, summary, config }) {
  const s = summary || stubParse(text) || {};
  const mode = config && config.ack ? config.ack.mode : 'AA';
  const code = mode === 'custom' || mode === 'none' ? 'AA' : mode;
  const textMessage = config && config.ack && config.ack.textMessage ? `|${config.ack.textMessage}` : '';
  ackCounter += 1;
  return `MSH|^~\\&|${s.receivingApplication || 'TESTAPP'}|${s.receivingFacility || 'TESTFAC'}|${s.sendingApplication || ''}|${s.sendingFacility || ''}|20260101120000||ACK|ACK${String(ackCounter).padStart(6, '0')}|P|${s.version || '2.5'}\r`
    + `MSA|${code}|${s.controlId || ''}${textMessage}\r`;
}

export const stubEncoding = {
  encode: (text) => Buffer.from(String(text), 'utf8'),
  decode: (buf) => Buffer.from(buf).toString('utf8'),
};

export function stubDeps(events) {
  return { events, ackBuilder: stubAckBuilder, parse: stubParse, encoding: stubEncoding };
}

/**
 * Wait for an event of the given type (optionally matching predicate). Resolves with the
 * event; checks already stored events first (sinceId) then subscribes.
 */
export function waitForEvent(events, type, { timeoutMs = 3000, predicate = null, sinceId = 0 } = {}) {
  const matches = (ev) => ev.type === type && (!predicate || predicate(ev));
  const existing = events.list({ sinceId, types: [type], limit: 100000 }).find(matches);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      events.off('event', onEvent);
      reject(new Error(`Timed out after ${timeoutMs} ms waiting for event ${type}`));
    }, timeoutMs);
    function onEvent(ev) {
      if (!matches(ev)) return;
      clearTimeout(timer);
      events.off('event', onEvent);
      resolve(ev);
    }
    events.on('event', onEvent);
  });
}

/** Wait until `count` events of the type exist. */
export async function waitForCount(events, type, count, { timeoutMs = 3000, sinceId = 0 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const list = events.list({ sinceId, types: [type], limit: 100000 });
    if (list.length >= count) return list;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} x ${type} (have ${list.length})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Start a listener on 127.0.0.1 with an ephemeral port and stub deps.
 * overrides: listener config overrides; depOverrides: replace stub deps (e.g. events).
 */
export async function startTestListener(overrides = {}, depOverrides = {}) {
  const events = depOverrides.events || new EventStore({ maxEvents: 5000, ndjsonPath: null });
  const port = overrides.port || await freePort();
  const deps = { ...stubDeps(events), ...depOverrides, events };
  const listener = new MllpListener({
    id: 'test',
    name: 'Test listener',
    host: '127.0.0.1',
    autoStart: false,
    ...overrides,
    port,
  }, deps);
  await listener.start();
  return {
    listener,
    events,
    deps,
    port,
    host: '127.0.0.1',
    stop: () => listener.stop(),
    waitForEvent: (type, opts) => waitForEvent(events, type, opts),
    waitForCount: (type, count, opts) => waitForCount(events, type, count, opts),
  };
}

/**
 * Boot a full App + web server for API tests and tear everything down afterwards.
 * Loaded lazily so transport tests do not depend on src/app.js / src/web/server.js.
 * fn receives { app, web, port, baseUrl, events, listenerPort, config }.
 * options.config: deep partial config; options.withListener (default true) adds a test
 * listener on an ephemeral port with autoStart.
 */
export async function withApp(fn, options = {}) {
  const { App } = await import('../src/app.js');
  const { createWebServer } = await import('../src/web/server.js');
  const listenerPort = await freePort();
  const withListener = options.withListener !== false;
  const base = {
    web: { host: '127.0.0.1', port: 0 },
    events: { maxEvents: 2000, ndjsonPath: null },
    listeners: withListener
      ? [{ id: 'default', name: 'Test listener', host: '127.0.0.1', port: listenerPort, autoStart: true }]
      : [],
    ui: { latencyThresholds: { warnMs: 300, badMs: 1000 } },
  };
  const config = deepMerge(base, options.config || {});
  const configPath = path.join(os.tmpdir(), `hl7t-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const app = new App(config, { configPath, rootDir: ROOT_DIR });
  const web = createWebServer(app, { host: '127.0.0.1', port: 0 });
  let started = false;
  try {
    await app.start();
    const { port } = await web.start();
    started = true;
    return await fn({
      app,
      web,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      events: app.events,
      listenerPort,
      config,
      configPath,
    });
  } finally {
    if (started) {
      try { await web.stop(); } catch { /* best effort */ }
    }
    try { await app.stop(); } catch { /* best effort */ }
  }
}

function deepMerge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra) || typeof base !== 'object' || typeof extra !== 'object' || !base || !extra) {
    return extra === undefined ? base : extra;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = deepMerge(base[k], v);
  return out;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Open a raw TCP client to the listener (for byte-level tests). */
export function rawClient(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setNoDelay(true);
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.off('error', reject);
      resolve(socket);
    });
  });
}

/** Collect everything the server sends until the socket closes or timeoutMs elapses. */
export function collect(socket, timeoutMs = 500) {
  return new Promise((resolve) => {
    const chunks = [];
    const done = () => resolve(Buffer.concat(chunks));
    const timer = setTimeout(done, timeoutMs);
    socket.on('data', (c) => chunks.push(c));
    socket.once('close', () => {
      clearTimeout(timer);
      done();
    });
  });
}
