import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { EventStore, now } from '../src/core/events.js';
import { MllpListener, DEFAULT_LISTENER_CONFIG } from '../src/mllp/listener.js';
import { sendMessage, sendMany, MllpSenderConnection, DEFAULT_SEND_REQUEST } from '../src/mllp/sender.js';
import { frame } from '../src/mllp/framing.js';
import { hexToBuffer } from '../src/core/hex.js';
import {
  freePort, startTestListener, stubDeps, stubParse, SAMPLE_ADT, waitForEvent, waitForCount, rawClient, collect, sleep,
} from './helpers.js';

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function baseReq(L, extra = {}) {
  return { host: L.host, port: L.port, message: SAMPLE_ADT, renderTemplate: false, ackTimeoutMs: 3000, connectTimeoutMs: 3000, ...extra };
}

describe('EventStore', () => {
  test('now() shape', () => {
    const t = now();
    assert.match(t.ts, ISO_MS);
    assert.equal(typeof t.tsMs, 'number');
    assert.equal(typeof t.mono, 'number');
    const t2 = now();
    assert.ok(t2.mono >= t.mono);
  });

  test('ring buffer, ids, dropped, get, last, stats', () => {
    const store = new EventStore({ maxEvents: 3 });
    const seen = [];
    store.on('event', (ev) => seen.push(ev.id));
    for (let i = 1; i <= 5; i += 1) store.push({ type: `t${i}`, source: 'system', summary: `s${i}` });
    assert.deepEqual(seen, [1, 2, 3, 4, 5]);
    assert.deepEqual(store.list().map((e) => e.id), [3, 4, 5]);
    assert.deepEqual(store.stats(), { count: 3, firstId: 3, lastId: 5, dropped: 2, nextId: 6, maxEvents: 3 });
    assert.equal(store.get(4).type, 't4');
    assert.equal(store.get(1), undefined);
    assert.equal(store.get('5').id, 5);
    assert.equal(store.get(99), undefined);
    assert.deepEqual(store.last(2).map((e) => e.id), [4, 5]);
    assert.deepEqual(store.last(10).map((e) => e.id), [3, 4, 5]);
    let cleared = false;
    store.on('clear', () => { cleared = true; });
    store.clear();
    assert.equal(cleared, true);
    assert.equal(store.stats().count, 0);
    assert.equal(store.push({ type: 'x' }).id, 6, 'ids keep growing after clear');
  });

  test('push fills defaults and timestamps, validates input', () => {
    const store = new EventStore();
    const ev = store.push({ type: 'msg.in' });
    assert.match(ev.ts, ISO_MS);
    assert.equal(typeof ev.tsMs, 'number');
    assert.equal(typeof ev.mono, 'number');
    assert.equal(ev.source, 'system');
    assert.equal(ev.endpointId, 'system');
    assert.equal(ev.connId, null);
    assert.equal(ev.direction, null);
    assert.equal(ev.level, 'info');
    assert.equal(ev.summary, '');
    assert.equal(ev.latencyMs, null);
    assert.deepEqual(ev.data, {});
    const custom = store.push({ ts: '2026-01-01T00:00:00.000Z', type: 'x', level: 'bogus', direction: 'sideways', latencyMs: 'fast' });
    assert.equal(custom.ts, '2026-01-01T00:00:00.000Z');
    assert.equal(custom.tsMs, Date.parse('2026-01-01T00:00:00.000Z'));
    assert.equal(custom.level, 'info');
    assert.equal(custom.direction, null);
    assert.equal(custom.latencyMs, null);
    assert.throws(() => store.push(null), TypeError);
    assert.throws(() => store.push('text'), TypeError);
  });

  test('list filters: sinceId, limit (newest), types csv/array, endpointId, level, text', () => {
    const store = new EventStore();
    store.push({ type: 'msg.in', source: 'listener', endpointId: 'a', summary: 'Received ADT', level: 'info', data: { text: 'MSH|hello' } });
    store.push({ type: 'ack.out', source: 'listener', endpointId: 'a', summary: 'Sent ACK', level: 'info' });
    store.push({ type: 'conn.error', source: 'sender', endpointId: 'b', summary: 'boom', level: 'error' });
    store.push({ type: 'msg.in', source: 'listener', endpointId: 'b', summary: 'Received ORU', level: 'warn', data: { summary: { controlId: 'CTRL77' } } });
    assert.deepEqual(store.list({ sinceId: 2 }).map((e) => e.id), [3, 4]);
    assert.deepEqual(store.list({ limit: 2 }).map((e) => e.id), [3, 4]);
    assert.deepEqual(store.list({ types: 'msg.in,ack.out' }).map((e) => e.id), [1, 2, 4]);
    assert.deepEqual(store.list({ types: ['conn.error'] }).map((e) => e.id), [3]);
    assert.deepEqual(store.list({ endpointId: 'b' }).map((e) => e.id), [3, 4]);
    assert.deepEqual(store.list({ level: 'error' }).map((e) => e.id), [3]);
    assert.deepEqual(store.list({ text: 'hello' }).map((e) => e.id), [1]);
    assert.deepEqual(store.list({ text: 'ctrl77' }).map((e) => e.id), [4]);
    assert.deepEqual(store.list({ text: 'received', types: 'msg.in', endpointId: 'b' }).map((e) => e.id), [4]);
    assert.deepEqual(store.list({ types: '' }).map((e) => e.id), [1, 2, 3, 4]);
  });

  test('toCsv quotes commas, quotes and newlines; toNdjson one line per event', () => {
    const store = new EventStore();
    store.push({ type: 'msg.in', source: 'listener', endpointId: 'a', connId: 'a#1', direction: 'in', summary: 'has, comma and "quotes"\nand newline', latencyMs: 1.5 });
    store.push({ type: 'x', summary: 'plain' });
    const csv = store.toCsv(store.list());
    const lines = csv.split('\n');
    assert.equal(lines[0], 'id,ts,source,endpointId,connId,type,direction,level,summary,latencyMs');
    assert.ok(csv.includes('"has, comma and ""quotes""\nand newline"'));
    assert.ok(csv.endsWith('plain,\n'));
    assert.equal(lines.filter((l) => l.startsWith('2,')).length, 1);
    const nd = store.toNdjson(store.list());
    const parsed = nd.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].id, 1);
    assert.equal(store.toNdjson([]), '');
  });

  test('NDJSON sink appends lines and creates the directory', async () => {
    const dir = path.join(os.tmpdir(), `hl7t-events-${process.pid}-${Date.now()}`);
    const file = path.join(dir, 'nested', 'events.ndjson');
    const store = new EventStore({ maxEvents: 10, ndjsonPath: file });
    store.push({ type: 'one', summary: 'first' });
    await sleep(50);
    store.push({ type: 'two', summary: 'second' });
    await store.close();
    const content = await readFile(file, 'utf8');
    const lines = content.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.type), ['one', 'two']);
    assert.equal(lines[1].summary, 'second');
    await rm(dir, { recursive: true, force: true });
  });
});

describe('MllpListener + sender: round trips', () => {
  let L;
  before(async () => { L = await startTestListener(); });
  after(async () => { await L.stop(); });

  test('AA round trip with timings and control id match', async () => {
    const events = L.events;
    const sinceId = events.stats().lastId || 0;
    const res = await sendMessage(baseReq(L), stubDeps(events));

    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.equal(res.error, null);
    assert.equal(res.errorPhase, null);
    assert.equal(res.controlId, 'MSG00001');
    assert.ok(res.sentText.startsWith('MSH|'));
    assert.ok(res.sentHex.startsWith('0B4D5348'));
    assert.ok(res.sentHex.endsWith('1C0D'));
    assert.ok(res.ack);
    assert.equal(res.ack.validation.msa1, 'AA');
    assert.equal(res.ack.validation.msa2, 'MSG00001');
    assert.equal(res.ack.validation.accepted, true);
    assert.equal(res.ack.validation.controlIdMatches, true);
    assert.equal(res.ack.validation.framingOk, true);
    assert.deepEqual(res.ack.validation.problems, []);
    assert.equal(res.ack.framing.prefixOk, true);
    assert.equal(res.ack.framing.suffixOk, true);
    assert.equal(res.ack.summary.messageType, 'ACK');
    assert.equal(res.ack.raw.hex.slice(0, 2), '0B');

    const t = res.timings;
    for (const key of ['tsStart', 'tsConnected', 'tsSent', 'tsFirstByte', 'tsAck']) assert.match(t[key], ISO_MS, key);
    for (const key of ['connectMs', 'sendMs', 'firstByteMs', 'ackMs', 'totalMs']) {
      assert.equal(typeof t[key], 'number', key);
      assert.ok(t[key] >= 0, `${key} >= 0`);
    }
    assert.ok(t.totalMs >= t.ackMs);
    assert.ok(t.ackMs >= t.firstByteMs);
    assert.ok(t.ackMs < 2000);

    const msgIn = await L.waitForEvent('msg.in', { sinceId });
    assert.equal(msgIn.source, 'listener');
    assert.equal(msgIn.endpointId, 'test');
    assert.match(msgIn.connId, /^test#\d+$/);
    assert.equal(msgIn.direction, 'in');
    assert.equal(msgIn.level, 'info');
    assert.equal(msgIn.data.summary.controlId, 'MSG00001');
    assert.equal(msgIn.data.summary.messageType, 'ADT');
    assert.equal(msgIn.data.framing.prefixOk, true);
    assert.equal(msgIn.data.framing.suffixOk, true);
    assert.equal(msgIn.data.framing.segmentSeparator, 'CR');
    assert.equal(msgIn.data.text, SAMPLE_ADT);
    assert.equal(msgIn.data.encoding, 'utf8');
    assert.equal(msgIn.data.raw.hex, res.sentHex);
    assert.equal(msgIn.latencyMs, msgIn.data.timing.receiveMs);
    assert.ok(msgIn.data.timing.receiveMs >= 0);
    assert.match(msgIn.data.timing.firstByteTs, ISO_MS);
    assert.equal(msgIn.data.timing.bytes, res.sentHex.length / 2);

    const ackOut = await L.waitForEvent('ack.out', { sinceId });
    assert.equal(ackOut.connId, msgIn.connId);
    assert.equal(ackOut.direction, 'out');
    assert.equal(ackOut.data.inReplyTo, 'MSG00001');
    assert.equal(ackOut.data.mode, 'AA');
    assert.equal(ackOut.data.delayMs, 0);
    assert.ok(ackOut.data.processingMs >= 0);
    assert.equal(ackOut.latencyMs, ackOut.data.processingMs);
    assert.equal(ackOut.data.summary.messageType, 'ACK');
    assert.equal(ackOut.data.raw.hex, res.ack.raw.hex);

    const ackIn = events.list({ sinceId, types: 'ack.in' })[0];
    assert.ok(ackIn);
    assert.equal(ackIn.source, 'sender');
    assert.equal(ackIn.endpointId, 'sender');
    assert.match(ackIn.connId, /^sender#\d+$/);
    assert.equal(ackIn.latencyMs, res.timings.ackMs);
    assert.equal(ackIn.data.validation.accepted, true);
    assert.deepEqual(Object.keys(ackIn.data.timing).sort(), ['ackMs', 'connectMs', 'firstByteMs', 'sendMs', 'totalMs']);
    assert.ok(res.eventIds.includes(ackIn.id));

    const msgOut = events.list({ sinceId, types: 'msg.out' })[0];
    assert.equal(msgOut.direction, 'out');
    assert.equal(msgOut.data.attempt, 1);
    assert.equal(msgOut.data.repeatIndex, 0);
    assert.equal(msgOut.data.summary.controlId, 'MSG00001');
    assert.ok(res.eventIds.includes(msgOut.id));

    const connect = events.list({ sinceId, types: 'sender.connect' })[0];
    assert.equal(connect.data.ok, true);
    assert.equal(connect.latencyMs, connect.data.connectMs);
    assert.equal(events.list({ sinceId, types: 'conn.open' }).length, 2, 'listener and sender conn.open');
    assert.ok(events.list({ sinceId, types: 'bytes.in' }).length >= 2);
    assert.ok(events.list({ sinceId, types: 'bytes.out' }).length >= 2);

    await L.waitForEvent('conn.close', { sinceId, predicate: (e) => e.source === 'listener' });
    const status = L.listener.status();
    assert.equal(status.state, 'listening');
    assert.equal(status.port, L.port);
    assert.equal(status.stats.messages, 1);
    assert.equal(status.stats.acksSent, 1);
    assert.equal(typeof status.stats.minProcessingMs, 'number');
    assert.equal(typeof status.stats.avgProcessingMs, 'number');
    assert.equal(typeof status.stats.maxProcessingMs, 'number');
    assert.ok(status.stats.minProcessingMs <= status.stats.maxProcessingMs);
    assert.match(status.stats.lastMessageTs, ISO_MS);
    assert.ok(status.stats.bytesIn > 0 && status.stats.bytesOut > 0);
  });

  test('local message event and warnings array', async () => {
    const got = new Promise((resolve) => L.listener.once('message', resolve));
    const res = await sendMessage(baseReq(L, { renderTemplate: true }), stubDeps(L.events));
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.warnings));
    const { event } = await got;
    assert.equal(event.type, 'msg.in');
  });

  test('wrong prefix from sender: msg.in prefixOk false and still ACKed', async () => {
    const sinceId = L.events.stats().lastId || 0;
    const res = await sendMessage(baseReq(L, { prefixHex: '00', ackPrefixHex: '0B' }), stubDeps(L.events));
    assert.equal(res.ok, true, res.error);
    assert.equal(res.ack.validation.accepted, true);
    assert.equal(res.ack.validation.controlIdMatches, true);
    assert.equal(res.ack.validation.framingOk, true);
    const msgIn = await L.waitForEvent('msg.in', { sinceId });
    assert.equal(msgIn.level, 'warn');
    assert.equal(msgIn.data.framing.prefixOk, false);
    assert.equal(msgIn.data.framing.suffixOk, true);
    assert.equal(msgIn.data.framing.prefixHexActual, '00');
    assert.equal(msgIn.data.framing.prefixHexExpected, '0B');
    assert.ok(msgIn.data.framing.warnings.includes('Prefix mismatch: expected 0B, got 00'));
    assert.ok(msgIn.data.text.startsWith('\u0000MSH|'), 'text keeps the stray byte as received');
    assert.equal(msgIn.data.strayLeadingBytes, 1);
    assert.equal(msgIn.data.summary.controlId, 'MSG00001', 'parsed from the MSH segment despite the stray byte');
    assert.equal(msgIn.data.raw.hex.slice(0, 2), '00');
    assert.ok(L.listener.status().stats.framingErrors >= 1);
  });

  test('sendMany with keepAlive uses a single connection and reports percentiles', async () => {
    const sinceId = L.events.stats().lastId || 0;
    const out = await sendMany(baseReq(L, { repeat: 3, keepAlive: true, intervalMs: 5 }), stubDeps(L.events));
    assert.equal(out.results.length, 3);
    assert.ok(out.results.every((r) => r.ok), JSON.stringify(out.results.map((r) => r.error)));
    assert.equal(out.summary.count, 3);
    assert.equal(out.summary.ok, 3);
    assert.equal(out.summary.failed, 0);
    for (const key of ['minAckMs', 'avgAckMs', 'maxAckMs', 'p95AckMs']) assert.equal(typeof out.summary[key], 'number', key);
    assert.ok(out.summary.minAckMs <= out.summary.avgAckMs && out.summary.avgAckMs <= out.summary.maxAckMs);
    assert.ok(out.summary.p95AckMs <= out.summary.maxAckMs);
    const msgOuts = L.events.list({ sinceId, types: 'msg.out' });
    assert.deepEqual(msgOuts.map((e) => e.data.repeatIndex), [0, 1, 2]);
    assert.ok(msgOuts.every((e) => e.data.repeatTotal === 3));
    assert.equal(new Set(msgOuts.map((e) => e.connId)).size, 1, 'one sender connection');
    assert.equal(L.events.list({ sinceId, types: 'conn.open' }).filter((e) => e.source === 'listener').length, 1);
    assert.equal(out.results[1].timings.connectMs, 0, 'reused connection has no connect time');
    await L.waitForEvent('conn.close', { sinceId, predicate: (e) => e.source === 'sender' });
  });

  test('sendMany without keepAlive opens one connection per message', async () => {
    const sinceId = L.events.stats().lastId || 0;
    const out = await sendMany(baseReq(L, { repeat: 2, intervalMs: 10 }), stubDeps(L.events));
    assert.equal(out.results.length, 2);
    assert.ok(out.results.every((r) => r.ok));
    assert.equal(L.events.list({ sinceId, types: 'conn.open' }).filter((e) => e.source === 'listener').length, 2);
    assert.equal(L.events.list({ sinceId, types: 'sender.connect' }).length, 2);
  });

  test('expectAck=false resolves right after the write', async () => {
    const res = await sendMessage(baseReq(L, { expectAck: false }), stubDeps(L.events));
    assert.equal(res.ok, true);
    assert.equal(res.ack, null);
    assert.equal(res.errorPhase, null);
    assert.equal(typeof res.timings.sendMs, 'number');
    assert.equal(res.timings.ackMs, null);
    assert.equal(res.timings.tsAck, null);
  });

  test('autoControlId with injected generator and MSH-10 replacement', async () => {
    const deps = { ...stubDeps(L.events), generateControlId: () => 'NEWID123' };
    const res = await sendMessage(baseReq(L, { autoControlId: true }), deps);
    assert.equal(res.ok, true);
    assert.equal(res.controlId, 'NEWID123');
    assert.ok(res.sentText.includes('|NEWID123|P|2.5\r'));
    assert.equal(res.ack.validation.msa2, 'NEWID123');
    assert.equal(res.ack.validation.controlIdMatches, true);
  });

  test('segment separators are normalised to CR with trailing CR', async () => {
    const message = 'MSH|^~\\&|A|B|C|D|20260101||ADT^A01|X1|P|2.5\nPID|1\r\nPV1|1';
    const res = await sendMessage(baseReq(L, { message }), stubDeps(L.events));
    assert.equal(res.ok, true);
    assert.equal(res.sentText, 'MSH|^~\\&|A|B|C|D|20260101||ADT^A01|X1|P|2.5\rPID|1\rPV1|1\r');
    assert.equal(res.ack.validation.msa2, 'X1');
  });

  test('MllpSenderConnection: explicit connect, serialised sends, close', async () => {
    const conn = new MllpSenderConnection({ id: 'ka', host: L.host, port: L.port, connectTimeoutMs: 2000 }, stubDeps(L.events));
    const c = await conn.connect();
    assert.ok(c.connectMs >= 0);
    assert.equal(conn.connected, true);
    assert.match(conn.connId, /^ka#\d+$/);
    const [a, b] = await Promise.all([
      conn.send(baseReq(L, { message: SAMPLE_ADT.replace('MSG00001', 'P1') })),
      conn.send(baseReq(L, { message: SAMPLE_ADT.replace('MSG00001', 'P2') })),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.ack.validation.msa2, 'P1');
    assert.equal(b.ack.validation.msa2, 'P2');
    assert.ok(a.timings.tsAck <= b.timings.tsSent || a.timings.ackMs !== null, 'second send waits for the first');
    await conn.close();
    assert.equal(conn.connected, false);
    const viaDep = await sendMessage(baseReq(L), { ...stubDeps(L.events), connection: conn });
    assert.equal(viaDep.ok, true, 'deps.connection reconnects transparently');
    await conn.close();
  });

  test('invalid input throws instead of returning a result', async () => {
    const deps = stubDeps(L.events);
    await assert.rejects(sendMessage(baseReq(L, { message: '' }), deps), /Message is empty/);
    await assert.rejects(sendMessage(baseReq(L, { message: '   ' }), deps), /Message is empty/);
    await assert.rejects(sendMessage(baseReq(L, { prefixHex: 'ZZ' }), deps), /Invalid prefixHex/);
    await assert.rejects(sendMessage(baseReq(L, { ackSuffixHex: '0D0' }), deps), /Invalid ackSuffixHex/);
    await assert.rejects(sendMessage(baseReq(L, { port: 0 }), deps), /Invalid port/);
    await assert.rejects(sendMany(baseReq(L, { message: '' }), deps), /Message is empty/);
    await assert.rejects(sendMessage(baseReq(L), {}), TypeError);
    assert.throws(() => new MllpSenderConnection({ host: L.host, port: L.port }, {}), TypeError);
  });
});

describe('MllpListener + sender: ACK delay, modes and timeouts', () => {
  test('delayMs 200 -> ackMs >= 190 and processingMs >= 190', async () => {
    const L = await startTestListener({ ack: { mode: 'AA', delayMs: 200 } });
    try {
      const res = await sendMessage(baseReq(L), stubDeps(L.events));
      assert.equal(res.ok, true, res.error);
      assert.ok(res.timings.ackMs >= 190, `ackMs ${res.timings.ackMs}`);
      assert.ok(res.timings.totalMs >= 190);
      const ackOut = await L.waitForEvent('ack.out');
      assert.equal(ackOut.data.delayMs, 200);
      assert.ok(ackOut.data.processingMs >= 190, `processingMs ${ackOut.data.processingMs}`);
      assert.ok(L.listener.status().stats.maxProcessingMs >= 190);
    } finally {
      await L.stop();
    }
  });

  test('mode none -> ack.skipped on listener, ack.timeout on sender', async () => {
    const L = await startTestListener({ ack: { mode: 'none' } });
    try {
      const res = await sendMessage(baseReq(L, { ackTimeoutMs: 300 }), stubDeps(L.events));
      assert.equal(res.ok, false);
      assert.equal(res.errorPhase, 'ack');
      assert.match(res.error, /ACK timeout after 300 ms/);
      assert.equal(res.ack, null);
      assert.ok(res.timings.totalMs >= 290);
      assert.equal(res.timings.ackMs, null);
      const skipped = await L.waitForEvent('ack.skipped');
      assert.equal(skipped.data.reason, 'mode none');
      assert.equal(skipped.data.inReplyTo, 'MSG00001');
      const timeout = await L.waitForEvent('ack.timeout');
      assert.equal(timeout.source, 'sender');
      assert.equal(timeout.level, 'error');
      assert.equal(timeout.data.ackTimeoutMs, 300);
      assert.equal(timeout.data.partialHex, '');
      assert.equal(timeout.data.partialLength, 0);
      assert.equal(timeout.data.framing, null);
      assert.equal(timeout.data.controlId, 'MSG00001');
      assert.ok(res.eventIds.includes(timeout.id));
      assert.equal(L.listener.status().stats.acksSent, 0);
      assert.equal(L.listener.status().stats.messages, 1);
    } finally {
      await L.stop();
    }
  });

  test('mode AE -> ok transport, validation not accepted', async () => {
    const L = await startTestListener({ ack: { mode: 'AE', textMessage: 'Bad data' } });
    try {
      const res = await sendMessage(baseReq(L), stubDeps(L.events));
      assert.equal(res.ok, true);
      assert.equal(res.ack.validation.msa1, 'AE');
      assert.equal(res.ack.validation.msa3, 'Bad data');
      assert.equal(res.ack.validation.accepted, false);
      assert.equal(res.ack.validation.controlIdMatches, true);
      assert.ok(res.ack.validation.problems.some((p) => p.startsWith('MSA-1 is AE')));
      const ackIn = await L.waitForEvent('ack.in');
      assert.equal(ackIn.level, 'warn');
    } finally {
      await L.stop();
    }
  });

  test('wrong suffix on sender: listener never frames, sender times out, incomplete reported on close', async () => {
    const L = await startTestListener();
    try {
      const res = await sendMessage(baseReq(L, { suffixHex: '0D0A', ackSuffixHex: '1C0D', ackTimeoutMs: 300 }), stubDeps(L.events));
      assert.equal(res.ok, false);
      assert.equal(res.errorPhase, 'ack');
      const timeout = await L.waitForEvent('ack.timeout');
      assert.equal(timeout.data.partialLength, 0);
      const incomplete = await L.waitForEvent('frame.incomplete');
      assert.equal(incomplete.data.reason, 'close');
      assert.equal(incomplete.level, 'warn');
      assert.equal(incomplete.data.framing.suffixOk, false);
      assert.equal(incomplete.data.framing.prefixOk, true);
      assert.equal(incomplete.data.framing.suffixHexActual, '0D0A');
      assert.equal(incomplete.data.framing.suffixHexExpected, '1C0D');
      assert.ok(incomplete.data.framing.warnings.includes('Suffix mismatch: expected 1C0D, got 0D0A'));
      assert.equal(incomplete.data.framing.knownVariant, 'prefix 0B, suffix 0D 0A (CRLF, no FS)');
      assert.ok(incomplete.data.hex.endsWith('0D0A'));
      assert.ok(incomplete.data.text.startsWith('\u000bMSH|'));
      assert.equal(L.listener.status().stats.messages, 0);
      assert.equal(L.listener.status().stats.framingErrors, 1);
      assert.equal(L.events.list({ types: 'msg.in' }).length, 0);
    } finally {
      await L.stop();
    }
  });

  test('wrong expected ACK suffix: ack.timeout carries the partial ACK bytes and diagnoses the suffix', async () => {
    const L = await startTestListener();
    try {
      const res = await sendMessage(baseReq(L, { ackSuffixHex: '0D0A', ackTimeoutMs: 300 }), stubDeps(L.events));
      assert.equal(res.ok, false);
      assert.equal(res.errorPhase, 'ack');
      assert.equal(typeof res.timings.firstByteMs, 'number', 'bytes did arrive');
      assert.equal(res.timings.ackMs, null);
      const timeout = await L.waitForEvent('ack.timeout');
      assert.ok(timeout.data.partialLength > 0);
      assert.ok(timeout.data.partialHex.startsWith('0B4D5348'));
      assert.ok(timeout.data.partialHex.endsWith('1C0D'));
      assert.equal(timeout.data.partialLength, timeout.data.partialHex.length / 2);
      assert.equal(timeout.data.framing.prefixOk, true);
      assert.equal(timeout.data.framing.suffixOk, false);
      assert.equal(timeout.data.framing.suffixHexExpected, '0D0A');
      assert.equal(timeout.data.framing.suffixHexActual, '1C0D');
      assert.ok(timeout.data.framing.warnings.includes('Suffix mismatch: expected 0D0A, got 1C0D'));
      assert.equal(timeout.data.framing.knownVariant, 'MLLP standard (0B / 1C 0D)');
      assert.ok(timeout.data.partialText.includes('MSA|AA|MSG00001'));
      assert.ok(timeout.summary.includes('partial'));
      const ackOut = await L.waitForEvent('ack.out');
      assert.equal(ackOut.data.inReplyTo, 'MSG00001', 'listener did answer');
    } finally {
      await L.stop();
    }
  });

  test('ACK with a different framing than inbound (ack.prefixHex / ack.suffixHex)', async () => {
    const L = await startTestListener({ ack: { mode: 'AA', prefixHex: '', suffixHex: '0D0A' } });
    try {
      const mismatch = await sendMessage(baseReq(L, { ackTimeoutMs: 300 }), stubDeps(L.events));
      assert.equal(mismatch.ok, false, 'sender expects 0B/1C0D for the ACK');
      const matching = await sendMessage(baseReq(L, { ackPrefixHex: '', ackSuffixHex: '0D0A' }), stubDeps(L.events));
      assert.equal(matching.ok, true, matching.error);
      assert.equal(matching.ack.framing.prefixHexExpected, '');
      assert.equal(matching.ack.framing.suffixHexExpected, '0D0A');
      assert.equal(matching.ack.validation.framingOk, true);
      assert.equal(matching.ack.validation.accepted, true);
    } finally {
      await L.stop();
    }
  });

  test('keepConnection=false closes the socket after the ACK', async () => {
    const L = await startTestListener({ keepConnection: false });
    try {
      const res = await sendMessage(baseReq(L), stubDeps(L.events));
      assert.equal(res.ok, true, res.error);
      assert.equal(res.ack.validation.accepted, true);
      const close = await L.waitForEvent('conn.close', { predicate: (e) => e.source === 'listener' });
      assert.equal(close.data.messages, 1);
      assert.equal(close.data.hadError, false);
      assert.ok(close.data.durationMs >= 0);
      assert.ok(close.data.bytesIn > 0 && close.data.bytesOut > 0);
    } finally {
      await L.stop();
    }
  });

  test('connection refused: ok=false, errorPhase connect, no throw', async () => {
    const events = new EventStore();
    const port = await freePort();
    const res = await sendMessage({ host: '127.0.0.1', port, message: SAMPLE_ADT, renderTemplate: false, connectTimeoutMs: 2000 }, stubDeps(events));
    assert.equal(res.ok, false);
    assert.equal(res.errorPhase, 'connect');
    assert.equal(typeof res.error, 'string');
    assert.equal(res.ack, null);
    assert.equal(res.controlId, 'MSG00001');
    assert.equal(res.timings.connectMs, null);
    assert.equal(res.timings.tsConnected, null);
    assert.ok(res.timings.totalMs >= 0);
    const connect = events.list({ types: 'sender.connect' })[0];
    assert.equal(connect.data.ok, false);
    assert.equal(connect.level, 'error');
    assert.equal(typeof connect.data.error, 'string');
    const err = events.list({ types: 'sender.error' })[0];
    assert.equal(err.data.phase, 'connect');
    assert.ok(res.eventIds.includes(err.id));
    const many = await sendMany({ host: '127.0.0.1', port, message: SAMPLE_ADT, renderTemplate: false, repeat: 2, keepAlive: true, connectTimeoutMs: 2000 }, stubDeps(events));
    assert.equal(many.results.length, 2);
    assert.equal(many.summary.failed, 2);
    assert.equal(many.summary.minAckMs, null);
    assert.equal(many.summary.p95AckMs, null);
  });

  test('peer closes before ACK -> errorPhase ack', async () => {
    const events = new EventStore();
    const L = await startTestListener({ ack: { mode: 'none' }, keepConnection: false }, { events });
    try {
      const res = await sendMessage(baseReq(L, { ackTimeoutMs: 2000 }), stubDeps(events));
      assert.equal(res.ok, false);
      assert.equal(res.errorPhase, 'ack');
      assert.match(res.error, /Connection closed before an ACK/);
      const err = await waitForEvent(events, 'sender.error');
      assert.equal(err.data.code, 'ECONNCLOSED');
    } finally {
      await L.stop();
    }
  });
});

describe('MllpListener: lifecycle, config and raw sockets', () => {
  test('EADDRINUSE: start rejects and pushes listener.error', async () => {
    const L = await startTestListener();
    try {
      const events = L.events;
      const other = new MllpListener({ id: 'dup', host: '127.0.0.1', port: L.port }, stubDeps(events));
      await assert.rejects(other.start(), (err) => err.code === 'EADDRINUSE');
      const errEvent = events.list({ types: 'listener.error', endpointId: 'dup' })[0];
      assert.ok(errEvent);
      assert.equal(errEvent.level, 'error');
      assert.equal(errEvent.data.code, 'EADDRINUSE');
      const status = other.status();
      assert.equal(status.state, 'error');
      assert.match(status.error, /EADDRINUSE/);
      await other.stop();
      assert.equal(other.status().state, 'stopped');
    } finally {
      await L.stop();
    }
  });

  test('invalid config: start rejects with a readable error', async () => {
    const events = new EventStore();
    const bad = new MllpListener({ id: 'bad', host: '127.0.0.1', port: 70000 }, stubDeps(events));
    await assert.rejects(bad.start(), /Invalid listener port: 70000/);
    assert.equal(events.list({ types: 'listener.error' })[0].data.code, 'EINVAL');
    const badHex = new MllpListener({ id: 'badhex', host: '127.0.0.1', port: await freePort(), prefixHex: 'XX' }, stubDeps(events));
    await assert.rejects(badHex.start(), /Invalid prefixHex/);
    assert.throws(() => new MllpListener({ id: 'x' }, {}), TypeError);
  });

  test('start/stop lifecycle events, idempotent stop, destroys sockets', async () => {
    const events = new EventStore();
    const port = await freePort();
    const listener = new MllpListener({ id: 'lc', host: '127.0.0.1', port }, stubDeps(events));
    assert.equal(listener.status().state, 'stopped');
    const states = [];
    listener.on('status', (s) => states.push(s.state));
    await listener.start();
    await listener.start();
    assert.equal(listener.status().state, 'listening');
    const started = events.list({ types: 'listener.started' })[0];
    assert.equal(started.data.port, port);
    assert.equal(started.data.prefixHex, '0B');
    assert.equal(started.data.suffixHex, '1C0D');
    assert.equal(started.data.encoding, 'utf8');
    assert.equal(started.data.ack.mode, 'AA');

    const client = await rawClient(port);
    await waitForEvent(events, 'conn.open');
    assert.equal(listener.status().connections, 1);
    const closed = new Promise((resolve) => client.once('close', resolve));
    await Promise.all([listener.stop(), listener.stop()]);
    await closed;
    assert.equal(listener.status().state, 'stopped');
    assert.equal(listener.status().connections, 0);
    const stopped = events.list({ types: 'listener.stopped' });
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0].data.reason, 'stop');
    assert.ok(states.includes('starting') && states.includes('listening') && states.includes('stopped'));
    await listener.stop();
    await listener.start();
    assert.equal(listener.status().state, 'listening');
    await listener.stop();
  });

  test('port 0 binds an ephemeral port reported in status', async () => {
    const events = new EventStore();
    const listener = new MllpListener({ id: 'eph', host: '127.0.0.1', port: 0 }, stubDeps(events));
    await listener.start();
    try {
      assert.ok(listener.status().port > 0);
      assert.equal(events.list({ types: 'listener.started' })[0].data.port, listener.status().port);
    } finally {
      await listener.stop();
    }
  });

  test('updateConfig: live vs restart keys, validation, defaults merge', async () => {
    const L = await startTestListener();
    try {
      const listener = L.listener;
      assert.deepEqual(listener.config.ack, { ...DEFAULT_LISTENER_CONFIG.ack });
      assert.deepEqual(listener.updateConfig({ ack: { mode: 'AE' } }), { restartRequired: false });
      assert.equal(listener.config.ack.mode, 'AE');
      assert.equal(listener.config.ack.delayMs, 0, 'nested defaults kept');
      assert.deepEqual(listener.updateConfig({ logBytes: false, keepConnection: false, idleTimeoutMs: 0, name: 'Renamed' }), { restartRequired: false });
      assert.equal(listener.status().name, 'Renamed');
      assert.deepEqual(listener.updateConfig({ prefixHex: '0x0b', suffixHex: '1c 0d' }), { restartRequired: false }, 'same bytes, different spelling');
      assert.deepEqual(listener.updateConfig({ port: L.port + 1 }), { restartRequired: true });
      assert.deepEqual(listener.updateConfig({ encoding: 'cp1250' }), { restartRequired: true });
      assert.deepEqual(listener.updateConfig({ suffixHex: '0D0A' }), { restartRequired: true });
      assert.throws(() => listener.updateConfig({ ack: { prefixHex: 'nope' } }), /Invalid ack.prefixHex/);
      assert.throws(() => listener.updateConfig({ ack: { mode: 'XX' } }), /Invalid ack.mode/);
      assert.throws(() => listener.updateConfig({ port: -1 }), /Invalid listener port/);
      assert.throws(() => listener.updateConfig(null), /expects a config object/);
      assert.equal(listener.config.ack.mode, 'AE', 'failed update changed nothing');
      assert.equal(listener.config.suffixHex, '0D0A');
      listener.updateConfig({ id: 'other' });
      assert.equal(listener.id, 'test', 'id is immutable');
      assert.equal(listener.status().state, 'listening', 'listener keeps running with old framing until restarted');
      const res = await sendMessage(baseReq(L), stubDeps(L.events));
      assert.equal(res.ok, true, 'old framing still active');
      assert.equal(res.ack.validation.msa1, 'AE', 'ack mode applied live');
    } finally {
      await L.stop();
    }
  });

  test('logBytes=false suppresses bytes.* events on the listener', async () => {
    const L = await startTestListener({ logBytes: false });
    try {
      const res = await sendMessage(baseReq(L, { logBytes: false }), stubDeps(L.events));
      assert.equal(res.ok, true);
      await L.waitForEvent('ack.out');
      assert.equal(L.events.list({ types: 'bytes.in,bytes.out' }).length, 0);
    } finally {
      await L.stop();
    }
  });

  test('stray bytes before the prefix: prefixOk false, counted as garbage, message still ACKed', async () => {
    const L = await startTestListener();
    try {
      const client = await rawClient(L.port);
      const framed = frame(Buffer.from(SAMPLE_ADT), { prefix: hexToBuffer('0B'), suffix: hexToBuffer('1C0D') });
      client.write(Buffer.concat([Buffer.from([0x00, 0x00]), framed]));
      const msgIn = await L.waitForEvent('msg.in');
      assert.equal(msgIn.data.framing.prefixOk, false);
      const ackOut = await L.waitForEvent('ack.out');
      assert.equal(ackOut.data.inReplyTo, 'MSG00001');
      assert.ok(L.listener.status().stats.garbageBytes >= 2);
      client.destroy();
      await L.waitForEvent('conn.close');
    } finally {
      await L.stop();
    }
  });

  test('three frames in one TCP chunk are ACKed in order', async () => {
    const L = await startTestListener();
    try {
      const client = await rawClient(L.port);
      const framing = { prefix: hexToBuffer('0B'), suffix: hexToBuffer('1C0D') };
      const chunk = Buffer.concat(['A1', 'A2', 'A3'].map((id) => frame(Buffer.from(SAMPLE_ADT.replace('MSG00001', id)), framing)));
      client.write(chunk);
      const acks = await L.waitForCount('ack.out', 3);
      assert.deepEqual(acks.map((e) => e.data.inReplyTo), ['A1', 'A2', 'A3']);
      const msgs = L.events.list({ types: 'msg.in' });
      assert.equal(msgs.length, 3);
      assert.ok(msgs.every((m) => m.connId === msgs[0].connId));
      const closing = collect(client, 200);
      client.end();
      const bytes = await closing;
      assert.ok(bytes.toString('latin1').includes('MSA|AA|A3'));
      await L.waitForEvent('conn.close');
      assert.equal(L.listener.status().stats.acksSent, 3);
    } finally {
      await L.stop();
    }
  });

  test('idle timeout flushes pending bytes as incomplete and closes the socket', async () => {
    const L = await startTestListener({ idleTimeoutMs: 150 });
    try {
      const client = await rawClient(L.port);
      client.write(Buffer.concat([hexToBuffer('0B'), Buffer.from('MSH|partial')]));
      const closed = new Promise((resolve) => client.once('close', resolve));
      const incomplete = await L.waitForEvent('frame.incomplete');
      assert.equal(incomplete.data.reason, 'idle');
      assert.equal(incomplete.data.text, '\u000bMSH|partial');
      await closed;
      await L.waitForEvent('conn.close');
      assert.equal(L.listener.status().stats.incompleteFrames, 1);
    } finally {
      await L.stop();
    }
  });

  test('unparseable payload: msg.in warn with parseError, ACK builder still consulted', async () => {
    const L = await startTestListener();
    try {
      const client = await rawClient(L.port);
      client.write(frame(Buffer.from('garbage without msh\r'), { prefix: hexToBuffer('0B'), suffix: hexToBuffer('1C0D') }));
      const msgIn = await L.waitForEvent('msg.in');
      assert.equal(msgIn.level, 'warn');
      assert.equal(msgIn.data.summary, null);
      assert.equal(typeof msgIn.data.parseError, 'string');
      assert.ok(msgIn.data.framing.warnings.some((w) => w.startsWith('Payload does not start with MSH')));
      const ackOut = await L.waitForEvent('ack.out');
      assert.equal(ackOut.data.inReplyTo, null);
      assert.equal(L.listener.status().stats.parseErrors, 1);
      client.destroy();
      await L.waitForEvent('conn.close');
    } finally {
      await L.stop();
    }
  });

  test('ack builder returning null or throwing produces ack.skipped, never crashes', async () => {
    const events = new EventStore();
    let mode = 'null';
    const ackBuilder = () => {
      if (mode === 'throw') throw new Error('builder exploded');
      return null;
    };
    const L = await startTestListener({}, { events, ackBuilder });
    try {
      const first = await sendMessage(baseReq(L, { ackTimeoutMs: 200 }), stubDeps(events));
      assert.equal(first.ok, false);
      const skipped = await waitForEvent(events, 'ack.skipped');
      assert.equal(skipped.data.reason, 'ack builder returned null');
      mode = 'throw';
      const second = await sendMessage(baseReq(L, { ackTimeoutMs: 200 }), stubDeps(events));
      assert.equal(second.ok, false);
      const failed = await waitForEvent(events, 'ack.skipped', { predicate: (e) => e.level === 'error' });
      assert.match(failed.data.reason, /builder exploded/);
      assert.equal(L.listener.status().state, 'listening');
      assert.equal(L.listener.status().stats.acksSkipped, 2);
    } finally {
      await L.stop();
    }
  });

  test('defaults exported per contract', () => {
    assert.equal(DEFAULT_LISTENER_CONFIG.port, 2575);
    assert.equal(DEFAULT_LISTENER_CONFIG.prefixHex, '0B');
    assert.equal(DEFAULT_LISTENER_CONFIG.suffixHex, '1C0D');
    assert.equal(DEFAULT_LISTENER_CONFIG.ack.mode, 'AA');
    assert.equal(DEFAULT_SEND_REQUEST.ackTimeoutMs, 5000);
    assert.equal(DEFAULT_SEND_REQUEST.ackPrefixHex, null);
    assert.equal(DEFAULT_SEND_REQUEST.keepAlive, false);
    assert.equal(stubParse(SAMPLE_ADT).controlId, 'MSG00001');
  });
});
