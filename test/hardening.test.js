// Regression tests for the hardening pass: frame timeout, partial ACK on close,
// send phase timeout and encoding warnings on msg.in.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventStore } from '../src/core/events.js';
import { sendMessage } from '../src/mllp/sender.js';
import { frame } from '../src/mllp/framing.js';
import { encode, decode, checkEncodingConsistency } from '../src/hl7/encoding.js';
import {
  freePort, startTestListener, stubDeps, SAMPLE_ADT, rawClient, sleep,
} from './helpers.js';

const MLLP = { prefix: Buffer.from([0x0b]), suffix: Buffer.from([0x1c, 0x0d]) };

function rawServer(onConnection) {
  return new Promise(async (resolve) => {
    const port = await freePort();
    const sockets = new Set();
    const server = net.createServer((s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
      s.on('error', () => {});
      onConnection(s);
    });
    server.listen(port, '127.0.0.1', () => resolve({
      port,
      close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
    }));
  });
}

describe('listener frameTimeoutMs', () => {
  test('wrong suffix on a persistent connection is reported without waiting for disconnect', async () => {
    const L = await startTestListener({ frameTimeoutMs: 150 });
    const client = await rawClient(L.port);
    try {
      // 0D0A instead of 1C0D: the frame never completes
      client.write(Buffer.concat([MLLP.prefix, Buffer.from(SAMPLE_ADT.replace(/\n/g, '\r')), Buffer.from([0x0d, 0x0a])]));
      const ev = await L.waitForEvent('frame.incomplete', { timeoutMs: 2000 });
      assert.equal(ev.data.reason, 'timeout');
      assert.equal(ev.data.framing.suffixHexExpected, '1C0D');
      assert.equal(ev.data.framing.suffixHexActual, '0D0A');
      assert.equal(ev.data.framing.suffixOk, false);
      assert.equal(client.destroyed, false, 'connection stays open');
      // the connection is still usable: a correct frame afterwards is received and ACKed
      client.write(frame(Buffer.from(SAMPLE_ADT.replace(/\n/g, '\r')), MLLP));
      const msg = await L.waitForEvent('msg.in', { timeoutMs: 2000 });
      assert.equal(msg.data.framing.suffixOk, true);
    } finally {
      client.destroy();
      await L.stop();
    }
  });

  test('frameTimeoutMs 0 disables the timer', async () => {
    const L = await startTestListener({ frameTimeoutMs: 0 });
    const client = await rawClient(L.port);
    try {
      client.write(Buffer.from([0x0b, 0x4d, 0x53, 0x48]));
      await sleep(250);
      assert.equal(L.events.list({ types: ['frame.incomplete'] }).length, 0);
    } finally {
      client.destroy();
      await L.stop();
    }
  });

  test('idle timeout does not close the socket while an ACK is delayed', async () => {
    const L = await startTestListener({ idleTimeoutMs: 100, ack: { mode: 'AA', delayMs: 300 } });
    try {
      const res = await sendMessage({ host: L.host, port: L.port, message: SAMPLE_ADT, renderTemplate: false, ackTimeoutMs: 2000 }, stubDeps(new EventStore({ ndjsonPath: null })));
      assert.equal(res.ok, true, res.error || '');
      assert.ok(res.timings.ackMs >= 290);
    } finally {
      await L.stop();
    }
  });
});

describe('sender partial ACK and send timeout', () => {
  test('partial ACK followed by close yields frame.incomplete with framing analysis', async () => {
    const srv = await rawServer((s) => {
      s.once('data', () => {
        s.write(Buffer.concat([Buffer.from([0x0b]), Buffer.from('MSH|^~\\&|GW|H|T|T|20260101||ACK|1|P|2.5\rMSA|AA|X\r'), Buffer.from([0x0d, 0x0a])]));
        setTimeout(() => s.destroy(), 30);
      });
    });
    const events = new EventStore({ ndjsonPath: null });
    try {
      const res = await sendMessage({ host: '127.0.0.1', port: srv.port, message: SAMPLE_ADT, renderTemplate: false, ackTimeoutMs: 2000 }, stubDeps(events));
      assert.equal(res.ok, false);
      assert.equal(res.errorPhase, 'ack');
      assert.match(res.error, /incomplete ACK/);
      const inc = events.list({ types: ['frame.incomplete'] });
      assert.equal(inc.length, 1);
      assert.equal(inc[0].source, 'sender');
      assert.equal(inc[0].data.reason, 'close');
      assert.equal(inc[0].data.framing.suffixHexActual, '0D0A');
      assert.ok(res.eventIds.includes(inc[0].id));
    } finally {
      await srv.close();
    }
  });

  test('send phase is bounded when the peer never reads', async () => {
    const srv = await rawServer((s) => { s.pause(); });
    const events = new EventStore({ ndjsonPath: null });
    try {
      // large enough to fill the socket buffers of a peer that never reads
      const big = `${SAMPLE_ADT.replace(/\n/g, '\r')}OBX|1|TX|||${'X'.repeat(64 * 1024 * 1024)}\r`;
      const started = Date.now();
      const res = await sendMessage({ host: '127.0.0.1', port: srv.port, message: big, renderTemplate: false, ackTimeoutMs: 400 }, stubDeps(events));
      assert.equal(res.ok, false);
      assert.ok(['send', 'ack'].includes(res.errorPhase));
      assert.ok(Date.now() - started < 5000, 'returns within a bounded time');
    } finally {
      await srv.close();
    }
  });
});

describe('encoding warnings', () => {
  test('msg.in carries encodingWarnings when cp1250 bytes are decoded as utf8', async () => {
    const encDeps = { encode, decode, check: checkEncodingConsistency };
    const L = await startTestListener({ encoding: 'utf8' }, { encoding: encDeps });
    const client = await rawClient(L.port);
    try {
      const text = 'MSH|^~\\&|A|B|C|D|20260101||ADT^A01|C1|P|2.5\rPID|1||1||Zażółć^Gęślą\r';
      client.write(frame(encode(text, 'cp1250'), MLLP));
      const ev = await L.waitForEvent('msg.in', { timeoutMs: 2000 });
      assert.ok(Array.isArray(ev.data.encodingWarnings) && ev.data.encodingWarnings.length > 0);
      assert.equal(ev.level, 'warn');
    } finally {
      client.destroy();
      await L.stop();
    }
  });
});
