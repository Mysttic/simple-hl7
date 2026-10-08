import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAck, compareVersions, parseVersion, ackMessageType } from '../src/hl7/ack.js';
import { parseMessage } from '../src/hl7/parser.js';

function msh(version, extra = '') {
  return `MSH|^~\\&|SENDAPP|SENDFAC|RECVAPP|RECVFAC|20240315101500||ADT^A01^ADT_A01|MSG00001|P|${version}${extra}`;
}
const PID = 'PID|1||12345^^^HOSP^MR||Kowalski^Jan||19800101|M';
const V25 = `${msh('2.5', '|||AL|NE||8859/2')}\r${PID}\r`;
const V23 = `${msh('2.3')}\r${PID}\r`;
const V231 = `${msh('2.3.1')}\r${PID}\r`;

describe('version helpers', () => {
  test('parseVersion and compareVersions', () => {
    assert.deepEqual(parseVersion('2.5'), [2, 5, 0]);
    assert.deepEqual(parseVersion('2.3.1'), [2, 3, 1]);
    assert.deepEqual(parseVersion('2.5.1^PL'), [2, 5, 1]);
    assert.deepEqual(parseVersion(''), [2, 5, 0]);
    assert.deepEqual(parseVersion(null), [2, 5, 0]);
    assert.deepEqual(parseVersion('garbage'), [2, 5, 0]);
    assert.equal(compareVersions('2.3', '2.3.1'), -1);
    assert.equal(compareVersions('2.3.1', '2.3.1'), 0);
    assert.equal(compareVersions('2.5', '2.3.1'), 1);
    assert.equal(compareVersions('2.6', '2.5'), 1);
    assert.equal(compareVersions('2.4', '2.5'), -1);
    assert.equal(compareVersions('2.2', '2.3.1'), -1);
  });

  test('ackMessageType', () => {
    assert.equal(ackMessageType('2.5', 'A01'), 'ACK^A01^ACK');
    assert.equal(ackMessageType('2.3.1', 'A01'), 'ACK^A01^ACK');
    assert.equal(ackMessageType('2.3', 'A01'), 'ACK');
    assert.equal(ackMessageType('2.2', 'A01'), 'ACK');
    assert.equal(ackMessageType('2.5', ''), 'ACK');
    assert.equal(ackMessageType('2.5', null), 'ACK');
    assert.equal(ackMessageType('', 'R01'), 'ACK^R01^ACK');
  });
});

describe('buildAck: default AA', () => {
  test('v2.5 inbound: MSH fields, swap, MSA', () => {
    const ack = buildAck(V25, { controlId: 'ACK123', timestamp: '20240315101501' });
    assert.equal(ack, 'MSH|^~\\&|RECVAPP|RECVFAC|SENDAPP|SENDFAC|20240315101501||ACK^A01^ACK|ACK123|P|2.5||||||8859/2\rMSA|AA|MSG00001|\r');
    const m = parseMessage(ack);
    assert.equal(m.get('MSH-3'), 'RECVAPP');
    assert.equal(m.get('MSH-4'), 'RECVFAC');
    assert.equal(m.get('MSH-5'), 'SENDAPP');
    assert.equal(m.get('MSH-6'), 'SENDFAC');
    assert.equal(m.get('MSH-9'), 'ACK^A01^ACK');
    assert.equal(m.get('MSH-10'), 'ACK123');
    assert.equal(m.get('MSH-11'), 'P');
    assert.equal(m.get('MSH-12'), '2.5');
    assert.equal(m.get('MSH-18'), '8859/2');
    assert.equal(m.get('MSA-1'), 'AA');
    assert.equal(m.get('MSA-2'), 'MSG00001');
    assert.equal(m.get('MSA-3'), '');
    assert.equal(m.segments.length, 2);
    assert.equal(m.delimiters.segment, 'CR');
  });

  test('segments separated by CR only, trailing CR, no LF', () => {
    const ack = buildAck(V25);
    assert.ok(ack.endsWith('\r'));
    assert.ok(!ack.includes('\n'));
    assert.equal(ack.split('\r').length, 3);
  });

  test('defaults: generated control id (20 digits) and timestamp (14 digits)', () => {
    const m = parseMessage(buildAck(V25));
    assert.match(m.get('MSH-10'), /^\d{20}$/);
    assert.match(m.get('MSH-7'), /^\d{14}$/);
    assert.notEqual(m.get('MSH-10'), parseMessage(buildAck(V25)).get('MSH-10'));
  });

  test('MSH-18 omitted when inbound has none (MSH ends at MSH-12)', () => {
    const ack = buildAck(V23, { controlId: 'C', timestamp: 'T' });
    assert.equal(ack, 'MSH|^~\\&|RECVAPP|RECVFAC|SENDAPP|SENDFAC|T||ACK|C|P|2.3\rMSA|AA|MSG00001|\r');
  });

  test('MSH-11 / MSH-12 copied verbatim including components', () => {
    const inbound = 'MSH|^~\\&|A|B|C|D|20240101||ORU^R01^ORU_R01|X1|P^T|2.5.1^PL^x\rPID|1\r';
    const m = parseMessage(buildAck(inbound));
    assert.equal(m.get('MSH-11'), 'P^T');
    assert.equal(m.get('MSH-12'), '2.5.1^PL^x');
    assert.equal(m.get('MSH-9'), 'ACK^R01^ACK');
  });

  test('defaults P and 2.5 when MSH-11 / MSH-12 are missing', () => {
    const m = parseMessage(buildAck('MSH|^~\\&|A|B|C|D|20240101||ADT^A04|X2\r'));
    assert.equal(m.get('MSH-11'), 'P');
    assert.equal(m.get('MSH-12'), '2.5');
    assert.equal(m.get('MSH-9'), 'ACK^A04^ACK');
    assert.equal(m.get('MSA-2'), 'X2');
  });
});

describe('buildAck: MSH-9 version rule', () => {
  test('version < 2.3.1 gives plain ACK', () => {
    assert.equal(parseMessage(buildAck(V23)).get('MSH-9'), 'ACK');
    assert.equal(parseMessage(buildAck(`${msh('2.2')}\r`)).get('MSH-9'), 'ACK');
    assert.equal(parseMessage(buildAck(`${msh('2.1')}\r`)).get('MSH-9'), 'ACK');
  });

  test('version >= 2.3.1 gives ACK^trigger^ACK', () => {
    assert.equal(parseMessage(buildAck(V231)).get('MSH-9'), 'ACK^A01^ACK');
    assert.equal(parseMessage(buildAck(V25)).get('MSH-9'), 'ACK^A01^ACK');
    assert.equal(parseMessage(buildAck(`${msh('2.6')}\r`)).get('MSH-9'), 'ACK^A01^ACK');
    assert.equal(parseMessage(buildAck(`${msh('2.8.2')}\r`)).get('MSH-9'), 'ACK^A01^ACK');
  });

  test('no trigger event gives plain ACK regardless of version', () => {
    const inbound = 'MSH|^~\\&|A|B|C|D|20240101||ACK|X1|P|2.5\rMSA|AA|Y\r';
    assert.equal(parseMessage(buildAck(inbound)).get('MSH-9'), 'ACK');
    const noMsh9 = 'MSH|^~\\&|A|B|C|D|20240101|||X1|P|2.5\r';
    assert.equal(parseMessage(buildAck(noMsh9)).get('MSH-9'), 'ACK');
  });
});

describe('buildAck: codes, text and ERR segment', () => {
  test('AE with errorCode on 2.5 appends ERR 2.5 style', () => {
    const ack = buildAck(V25, { code: 'AE', errorCode: '207', textMessage: 'Application error', controlId: 'C', timestamp: 'T' });
    const segs = ack.split('\r');
    assert.equal(segs.length, 4);
    assert.equal(segs[1], 'MSA|AE|MSG00001|Application error');
    assert.equal(segs[2], 'ERR|||207^Application error^HL70357|E');
    assert.equal(segs[3], '');
    const m = parseMessage(ack);
    assert.equal(m.get('ERR-3.1'), '207');
    assert.equal(m.get('ERR-3.2'), 'Application error');
    assert.equal(m.get('ERR-3.3'), 'HL70357');
    assert.equal(m.get('ERR-4'), 'E');
  });

  test('AR with errorCode on 2.3 appends ERR pre-2.5 style', () => {
    const ack = buildAck(V23, { code: 'AR', errorCode: '200', textMessage: 'Unsupported message type' });
    const segs = ack.split('\r');
    assert.equal(segs[1], 'MSA|AR|MSG00001|Unsupported message type');
    assert.equal(segs[2], 'ERR|^^^200&Unsupported message type');
    const m = parseMessage(ack);
    assert.equal(m.get('ERR-1.4.1'), '200');
    assert.equal(m.get('ERR-1.4.2'), 'Unsupported message type');
  });

  test('2.3.1 and 2.4 still use the pre-2.5 ERR, 2.5.1 and 2.6 the new one', () => {
    assert.ok(buildAck(V231, { code: 'AE', errorCode: '1' }).includes('ERR|^^^1&'));
    assert.ok(buildAck(`${msh('2.4')}\r`, { code: 'AE', errorCode: '1' }).includes('ERR|^^^1&'));
    assert.ok(buildAck(`${msh('2.5.1')}\r`, { code: 'AE', errorCode: '1' }).includes('ERR|||1^^HL70357|E'));
    assert.ok(buildAck(`${msh('2.6')}\r`, { code: 'AE', errorCode: '1' }).includes('ERR|||1^^HL70357|E'));
  });

  test('no ERR without errorCode or for accept codes', () => {
    assert.ok(!buildAck(V25, { code: 'AE', textMessage: 'x' }).includes('ERR|'));
    assert.ok(!buildAck(V25, { code: 'AE', errorCode: '' }).includes('ERR|'));
    assert.ok(!buildAck(V25, { code: 'AA', errorCode: '207' }).includes('ERR|'));
    assert.ok(!buildAck(V25, { code: 'CA', errorCode: '207' }).includes('ERR|'));
    assert.ok(buildAck(V25, { code: 'ae', errorCode: '207' }).includes('ERR|||207^'));
  });

  test('numeric errorCode and code defaults', () => {
    assert.ok(buildAck(V25, { code: 'AR', errorCode: 102 }).includes('ERR|||102^^HL70357|E'));
    assert.equal(parseMessage(buildAck(V25, { code: '' })).get('MSA-1'), 'AA');
    assert.equal(parseMessage(buildAck(V25, { code: null })).get('MSA-1'), 'AA');
    assert.equal(parseMessage(buildAck(V25, { code: ' CE ' })).get('MSA-1'), 'CE');
    assert.equal(parseMessage(buildAck(V25, { code: 'XX' })).get('MSA-1'), 'XX');
  });

  test('textMessage with delimiters is escaped', () => {
    const ack = buildAck(V25, { code: 'AE', errorCode: '207', textMessage: 'bad|pipe^caret' });
    assert.ok(ack.includes('MSA|AE|MSG00001|bad\\F\\pipe\\S\\caret\r'));
    assert.ok(ack.includes('ERR|||207^bad\\F\\pipe\\S\\caret^HL70357|E'));
    const m = parseMessage(ack);
    assert.equal(m.get('MSA-3'), 'bad\\F\\pipe\\S\\caret');
    assert.equal(m.get('ERR-4'), 'E');
  });
});

describe('buildAck: overrides and inputs', () => {
  test('sendingApplication / sendingFacility override MSH-3/4 of the ACK', () => {
    const m = parseMessage(buildAck(V25, { sendingApplication: 'TESTER', sendingFacility: 'LAB' }));
    assert.equal(m.get('MSH-3'), 'TESTER');
    assert.equal(m.get('MSH-4'), 'LAB');
    assert.equal(m.get('MSH-5'), 'SENDAPP');
    assert.equal(m.get('MSH-6'), 'SENDFAC');
    const m2 = parseMessage(buildAck(V25, { sendingApplication: '' }));
    assert.equal(m2.get('MSH-3'), '');
    assert.equal(m2.get('MSH-4'), 'RECVFAC');
  });

  test('accepts a parsed Message as input', () => {
    const msg = parseMessage(V25);
    const ack = buildAck(msg, { controlId: 'C', timestamp: 'T' });
    assert.equal(ack, buildAck(V25, { controlId: 'C', timestamp: 'T' }));
  });

  test('LF and CRLF inbound separators are fine', () => {
    const lf = buildAck(V25.replace(/\r/g, '\n'), { controlId: 'C', timestamp: 'T' });
    const crlf = buildAck(V25.replace(/\r/g, '\r\n'), { controlId: 'C', timestamp: 'T' });
    assert.equal(lf, buildAck(V25, { controlId: 'C', timestamp: 'T' }));
    assert.equal(crlf, lf);
  });

  test('garbage, empty and null input never throw', () => {
    for (const input of ['', null, undefined, 'garbage', 'PID|1||x', 42, {}, '\x0B\x1C\r']) {
      let ack;
      assert.doesNotThrow(() => { ack = buildAck(input); });
      const m = parseMessage(ack);
      assert.equal(m.get('MSA-1'), 'AA');
      assert.equal(m.get('MSA-2'), '');
      assert.equal(m.get('MSH-9'), 'ACK');
      assert.equal(m.get('MSH-12'), '2.5');
      assert.equal(m.get('MSH-11'), 'P');
    }
    assert.doesNotThrow(() => buildAck(V25, null));
    assert.doesNotThrow(() => buildAck(V25, 'bad opts'));
  });

  test('custom inbound delimiters: values are copied, ACK uses standard delimiters', () => {
    const inbound = 'MSH#*;\\%#SEND#SFAC#RECV#RFAC#20240101##ADT*A01#CTRL1#P#2.5\rPID#1\r';
    const ack = buildAck(inbound, { controlId: 'C', timestamp: 'T' });
    assert.equal(ack, 'MSH|^~\\&|RECV|RFAC|SEND|SFAC|T||ACK^A01^ACK|C|P|2.5\rMSA|AA|CTRL1|\r');
  });
});

describe('buildAck: template mode', () => {
  test('template is rendered with msg, summary, controlId and vars', () => {
    const tpl = 'MSH|^~\\&|GW|GWF|{{field:MSH-3}}|{{field:MSH-4}}|{{now}}||ACK|{{controlId}}|P|2.5\nMSA|{{vars.code}}|{{field:MSH-10}}|{{vars.textMessage}}';
    const ack = buildAck(V25, { template: tpl, code: 'AE', textMessage: 'nope', controlId: 'TPL1' });
    assert.ok(ack.endsWith('\r'));
    assert.ok(!ack.includes('\n'));
    const m = parseMessage(ack);
    assert.equal(m.get('MSH-5'), 'SENDAPP');
    assert.equal(m.get('MSH-6'), 'SENDFAC');
    assert.equal(m.get('MSH-10'), 'TPL1');
    assert.match(m.get('MSH-7'), /^\d{14}$/);
    assert.equal(m.get('MSA-1'), 'AE');
    assert.equal(m.get('MSA-2'), 'MSG00001');
    assert.equal(m.get('MSA-3'), 'nope');
  });

  test('ctx vars reach the template, user vars win over built-ins', () => {
    const ack = buildAck(V25, {
      template: 'MSH|{{vars.site}}|{{vars.code}}|{{vars.errorCode}}|{{vars.timestamp}}',
      code: 'AR',
      errorCode: '9',
      timestamp: 'TS',
      ctx: { vars: { site: 'S1', code: 'OVERRIDDEN' } }
    });
    assert.equal(ack, 'MSH|S1|OVERRIDDEN|9|TS\r');
  });

  test('template with trailing separators normalises to one CR, empty template falls back to default', () => {
    assert.equal(buildAck(V25, { template: 'MSA|AA|X\r\n\r\n' }), 'MSA|AA|X\r');
    assert.equal(buildAck(V25, { template: 'MSA|AA|X\rMSA|AA|Y' }), 'MSA|AA|X\rMSA|AA|Y\r');
    assert.ok(buildAck(V25, { template: '' }).startsWith('MSH|^~\\&|RECVAPP'));
    assert.ok(buildAck(V25, { template: null }).startsWith('MSH|^~\\&|RECVAPP'));
  });

  test('intentionally broken template is returned as is (for gateway robustness tests)', () => {
    assert.equal(buildAck(V25, { template: 'not hl7 at all' }), 'not hl7 at all\r');
  });
});
