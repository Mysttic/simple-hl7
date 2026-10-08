import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { frame, analyzeFraming, FrameDecoder } from '../src/mllp/framing.js';
import { hexToBuffer, bufferToHex } from '../src/core/hex.js';

const VT = Buffer.from([0x0b]);
const FS_CR = Buffer.from([0x1c, 0x0d]);
const STD = { prefix: VT, suffix: FS_CR };
const MSG = 'MSH|^~\\&|A|B|C|D|20260101||ADT^A01|1|P|2.5\rPID|1||1\r';

function collect(decoder) {
  const out = { frames: [], garbage: [], incomplete: [], errors: [] };
  decoder.on('frame', (f) => out.frames.push(f));
  decoder.on('garbage', (g) => out.garbage.push(g));
  decoder.on('incomplete', (i) => out.incomplete.push(i));
  decoder.on('error', (e) => out.errors.push(e));
  return out;
}

describe('frame()', () => {
  test('prefix + payload + suffix', () => {
    const out = frame(Buffer.from('abc'), STD);
    assert.equal(bufferToHex(out, ''), '0B6162631C0D');
  });

  test('empty prefix and suffix', () => {
    const out = frame(Buffer.from('abc'), { prefix: Buffer.alloc(0), suffix: Buffer.alloc(0) });
    assert.equal(out.toString(), 'abc');
    const out2 = frame(Buffer.from('abc'), {});
    assert.equal(out2.toString(), 'abc');
  });

  test('accepts hex strings for prefix and suffix, rejects non-buffer payload', () => {
    const out = frame(Buffer.from('x'), { prefix: '0B', suffix: '1C 0D' });
    assert.equal(bufferToHex(out, ''), '0B781C0D');
    assert.throws(() => frame('x', STD), /payload must be a Buffer/);
  });
});

describe('analyzeFraming()', () => {
  test('standard MLLP frame', () => {
    const raw = frame(Buffer.from(MSG), STD);
    const a = analyzeFraming(raw, STD);
    assert.equal(a.prefixHexExpected, '0B');
    assert.equal(a.suffixHexExpected, '1C0D');
    assert.equal(a.prefixHexActual, '0B');
    assert.equal(a.suffixHexActual, '1C0D');
    assert.equal(a.prefixOk, true);
    assert.equal(a.suffixOk, true);
    assert.equal(a.payloadStart, 1);
    assert.equal(a.payloadEnd, raw.length - 2);
    assert.equal(raw.subarray(a.payloadStart, a.payloadEnd).toString(), MSG);
    assert.equal(a.segmentSeparator, 'CR');
    assert.equal(a.trailingSeparator, true);
    assert.equal(a.nonAsciiCount, 0);
    assert.deepEqual(a.controlChars, []);
    assert.equal(a.knownVariant, 'MLLP standard (0B / 1C 0D)');
    assert.deepEqual(a.warnings, []);
  });

  test('wrong prefix is reported with actual bytes', () => {
    const raw = Buffer.concat([Buffer.from([0x00]), Buffer.from(MSG), FS_CR]);
    const a = analyzeFraming(raw, STD);
    assert.equal(a.prefixOk, false);
    assert.equal(a.suffixOk, true);
    assert.equal(a.prefixHexActual, '00');
    assert.equal(a.payloadStart, 0);
    assert.ok(a.warnings.includes('Prefix mismatch: expected 0B, got 00'));
    assert.equal(a.controlChars.length, 1);
    assert.deepEqual(a.controlChars[0], { offset: 0, hex: '00' });
  });

  test('wrong suffix (CRLF instead of FS CR) is reported and variant detected', () => {
    const raw = Buffer.concat([VT, Buffer.from(MSG), Buffer.from([0x0d, 0x0a])]);
    const a = analyzeFraming(raw, STD);
    assert.equal(a.prefixOk, true);
    assert.equal(a.suffixOk, false);
    assert.equal(a.suffixHexActual, '0D0A');
    assert.equal(a.payloadEnd, raw.length);
    assert.ok(a.warnings.includes('Suffix mismatch: expected 1C0D, got 0D0A'));
    assert.equal(a.knownVariant, 'prefix 0B, suffix 0D 0A (CRLF, no FS)');
  });

  test('expected suffix present but followed by extra bytes', () => {
    const raw = Buffer.concat([VT, Buffer.from(MSG), FS_CR, Buffer.from([0x0a])]);
    const a = analyzeFraming(raw, STD);
    assert.equal(a.suffixOk, false);
    assert.ok(a.warnings.some((w) => w.startsWith('Expected suffix 1C0D found at offset') && w.endsWith('1 trailing byte(s)')));
    assert.equal(a.knownVariant, 'MLLP with extra LF (0B / 1C 0D 0A)');
  });

  test('garbage before prefix is reported with offset', () => {
    const raw = Buffer.concat([Buffer.from('xx'), VT, Buffer.from(MSG), FS_CR]);
    const a = analyzeFraming(raw, STD);
    assert.equal(a.prefixOk, false);
    assert.ok(a.warnings.includes('Expected prefix 0B found at offset 2: 2 leading byte(s) before it'));
  });

  test('segment separator detection: LF, CRLF, mixed, none', () => {
    const lf = analyzeFraming(frame(Buffer.from('MSH|a\nPID|b\n'), STD), STD);
    assert.equal(lf.segmentSeparator, 'LF');
    assert.equal(lf.trailingSeparator, true);
    assert.ok(lf.warnings.includes('Segments separated by LF instead of CR'));

    const crlf = analyzeFraming(frame(Buffer.from('MSH|a\r\nPID|b\r\n'), STD), STD);
    assert.equal(crlf.segmentSeparator, 'CRLF');
    assert.equal(crlf.trailingSeparator, true);
    assert.ok(crlf.warnings.includes('Segments separated by CRLF instead of CR'));

    const mixed = analyzeFraming(frame(Buffer.from('MSH|a\rPID|b\nOBX|c\r\n'), STD), STD);
    assert.equal(mixed.segmentSeparator, 'mixed');
    assert.ok(mixed.warnings.some((w) => w.startsWith('Mixed segment separators')));

    const none = analyzeFraming(frame(Buffer.from('MSH|a'), STD), STD);
    assert.equal(none.segmentSeparator, 'none');
    assert.equal(none.trailingSeparator, false);
    assert.ok(none.warnings.includes('Missing trailing CR before suffix'));
  });

  test('missing trailing CR before suffix', () => {
    const a = analyzeFraming(frame(Buffer.from('MSH|a\rPID|b'), STD), STD);
    assert.equal(a.segmentSeparator, 'CR');
    assert.equal(a.trailingSeparator, false);
    assert.ok(a.warnings.includes('Missing trailing CR before suffix'));
  });

  test('control chars and non-ascii inside payload', () => {
    const payload = Buffer.concat([Buffer.from('MSH|a\rPID|'), Buffer.from([0x01, 0x02]), Buffer.from('Zażółć\r', 'utf8')]);
    const a = analyzeFraming(frame(payload, STD), STD);
    assert.equal(a.controlChars.length, 2);
    assert.equal(a.controlChars[0].hex, '01');
    assert.equal(a.controlChars[0].offset, 1 + 10);
    assert.ok(a.nonAsciiCount > 0);
    assert.ok(a.warnings.some((w) => w.includes('2 unexpected control character(s)')));
    const long = Buffer.alloc(30, 0x05);
    const many = analyzeFraming(frame(Buffer.concat([Buffer.from('MSH|'), long, Buffer.from('\r')]), STD), STD);
    assert.equal(many.controlChars.length, 20);
    assert.equal(many.controlCharCount, 30);
  });

  test('empty expected prefix/suffix shows first/last byte for display', () => {
    const raw = Buffer.from(MSG);
    const a = analyzeFraming(raw, { prefix: Buffer.alloc(0), suffix: Buffer.alloc(0) });
    assert.equal(a.prefixOk, true);
    assert.equal(a.suffixOk, true);
    assert.equal(a.prefixHexExpected, '');
    assert.equal(a.prefixHexActual, '4D');
    assert.equal(a.suffixHexActual, '0D');
    assert.equal(a.payloadStart, 0);
    assert.equal(a.payloadEnd, raw.length);
    assert.equal(a.knownVariant, 'no framing');
  });

  test('other known variants', () => {
    assert.equal(analyzeFraming(Buffer.concat([VT, Buffer.from(MSG), Buffer.from([0x1c])]), STD).knownVariant, 'MLLP without trailing CR (0B / 1C)');
    assert.equal(analyzeFraming(Buffer.concat([Buffer.from(MSG), Buffer.from([0x1c])]), STD).knownVariant, 'suffix 1C only');
    assert.equal(analyzeFraming(Buffer.concat([Buffer.from(MSG), Buffer.from([0x1c, 0x0d])]), STD).knownVariant, 'suffix 1C 0D only (no prefix)');
    assert.equal(analyzeFraming(Buffer.from('MSH|a\r\n'), STD).knownVariant, 'suffix 0D 0A (CRLF, no FS)');
    assert.equal(analyzeFraming(Buffer.concat([Buffer.from([0x02]), Buffer.from(MSG), Buffer.from([0x03])]), STD).knownVariant, 'STX / ETX (02 / 03)');
    assert.equal(analyzeFraming(Buffer.from([0x00, 0x01]), STD).knownVariant, null);
  });

  test('empty raw and payload not starting with MSH', () => {
    const empty = analyzeFraming(Buffer.alloc(0), STD);
    assert.equal(empty.prefixOk, false);
    assert.equal(empty.prefixHexActual, '');
    assert.ok(empty.warnings.includes('Empty payload'));
    const notMsh = analyzeFraming(frame(Buffer.from('PID|1\r'), STD), STD);
    assert.ok(notMsh.warnings.some((w) => w.startsWith('Payload does not start with MSH')));
  });

  test('prefix inside payload hints at two concatenated messages', () => {
    const raw = Buffer.concat([VT, Buffer.from('MSH|a\r'), VT, Buffer.from('MSH|b\r'), FS_CR]);
    const a = analyzeFraming(raw, STD);
    assert.ok(a.warnings.some((w) => w.startsWith('Prefix 0B occurs inside the payload at offset 7')));
  });

  test('rejects non-buffer raw', () => {
    assert.throws(() => analyzeFraming('text', STD), /raw must be a Buffer/);
  });
});

describe('FrameDecoder', () => {
  test('frame split across chunks byte by byte', () => {
    const d = new FrameDecoder(STD);
    const out = collect(d);
    const raw = frame(Buffer.from(MSG), STD);
    for (let i = 0; i < raw.length; i += 1) {
      d.push(raw.subarray(i, i + 1));
      if (i < raw.length - 1) assert.equal(out.frames.length, 0, `no frame before byte ${i}`);
    }
    assert.equal(out.frames.length, 1);
    const f = out.frames[0];
    assert.equal(f.payload.toString(), MSG);
    assert.deepEqual(f.raw, raw);
    assert.equal(f.prefixOk, true);
    assert.equal(f.suffixOk, true);
    assert.equal(typeof f.startedMono, 'number');
    assert.ok(f.completedMono >= f.startedMono);
    assert.match(f.startedTs, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.match(f.completedTs, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(d.pending().length, 0);
    assert.equal(d.framesDecoded, 1);
  });

  test('three frames in one chunk', () => {
    const d = new FrameDecoder(STD);
    const out = collect(d);
    const chunk = Buffer.concat([
      frame(Buffer.from('MSH|1\r'), STD),
      frame(Buffer.from('MSH|2\r'), STD),
      frame(Buffer.from('MSH|3\r'), STD),
    ]);
    d.push(chunk);
    assert.equal(out.frames.length, 3);
    assert.deepEqual(out.frames.map((f) => f.payload.toString()), ['MSH|1\r', 'MSH|2\r', 'MSH|3\r']);
    assert.ok(out.frames.every((f) => f.prefixOk && f.suffixOk));
    assert.equal(out.frames[0].startedMono, out.frames[2].completedMono);
    assert.equal(d.pending().length, 0);
  });

  test('chunk ending in the middle of the suffix, then back to back frame', () => {
    const d = new FrameDecoder(STD);
    const out = collect(d);
    const f1 = frame(Buffer.from('MSH|1\r'), STD);
    const f2 = frame(Buffer.from('MSH|2\r'), STD);
    d.push(f1.subarray(0, f1.length - 1)); // ends with 1C, missing 0D
    assert.equal(out.frames.length, 0);
    assert.equal(d.pending().length, f1.length - 1);
    d.push(Buffer.concat([f1.subarray(f1.length - 1), f2.subarray(0, 3)]));
    assert.equal(out.frames.length, 1);
    assert.equal(out.frames[0].payload.toString(), 'MSH|1\r');
    assert.equal(d.pending().length, 3);
    d.push(f2.subarray(3));
    assert.equal(out.frames.length, 2);
    assert.equal(out.frames[1].payload.toString(), 'MSH|2\r');
    assert.ok(out.frames[1].startedMono <= out.frames[1].completedMono);
  });

  test('started timestamp is taken from the push that delivered the first byte', async () => {
    const d = new FrameDecoder(STD);
    const out = collect(d);
    const raw = frame(Buffer.from(MSG), STD);
    d.push(raw.subarray(0, 5));
    await new Promise((r) => setTimeout(r, 30));
    d.push(raw.subarray(5));
    assert.equal(out.frames.length, 1);
    assert.ok(out.frames[0].completedMono - out.frames[0].startedMono >= 20);
  });

  test('wrong prefix: frame emitted with prefixOk=false', () => {
    const d = new FrameDecoder(STD);
    const out = collect(d);
    d.push(Buffer.concat([Buffer.from([0x00]), Buffer.from(MSG), FS_CR]));
    assert.equal(out.frames.length, 1);
    assert.equal(out.frames[0].prefixOk, false);
    assert.equal(out.frames[0].suffixOk, true);
    assert.equal(out.frames[0].payload[0], 0x00);
    assert.equal(out.frames[0].payload.toString('latin1').slice(1), MSG);
    assert.equal(out.garbage.length, 0);
  });

  test('flush on close emits incomplete and clears', () => {
    const d = new FrameDecoder(STD);
    const out = collect(d);
    d.push(Buffer.concat([VT, Buffer.from('MSH|partial')]));
    d.flush('close');
    assert.equal(out.incomplete.length, 1);
    assert.equal(out.incomplete[0].reason, 'close');
    assert.equal(out.incomplete[0].bytes.toString('latin1'), '\u000bMSH|partial');
    assert.equal(d.pending().length, 0);
    d.flush('idle');
    assert.equal(out.incomplete.length, 1, 'nothing pending, nothing emitted');
    d.push(Buffer.from('x'));
    d.flush('idle');
    assert.equal(out.incomplete[1].reason, 'idle');
  });

  test('max size: error with code E_MAX_SIZE and pending dropped', () => {
    const d = new FrameDecoder({ ...STD, maxMessageBytes: 10 });
    const out = collect(d);
    d.push(Buffer.concat([VT, Buffer.from('0123456789ABCDEF')]));
    assert.equal(out.errors.length, 1);
    assert.equal(out.errors[0].code, 'E_MAX_SIZE');
    assert.equal(d.pending().length, 0);
    assert.equal(d.lastError.code, 'E_MAX_SIZE');
    d.push(frame(Buffer.from('MSH|1\r'), STD));
    assert.equal(out.frames.length, 1, 'decoder keeps working after the error');
  });

  test('max size without an error listener does not throw', () => {
    const d = new FrameDecoder({ ...STD, maxMessageBytes: 4 });
    assert.doesNotThrow(() => d.push(Buffer.from('0123456789')));
    assert.equal(d.lastError.code, 'E_MAX_SIZE');
  });

  test('empty prefix: suffix only framing', () => {
    const d = new FrameDecoder({ prefix: Buffer.alloc(0), suffix: Buffer.from([0x0d, 0x0a]) });
    const out = collect(d);
    d.push(Buffer.from('MSH|1\r\nMSH|2\r\n'));
    assert.equal(out.frames.length, 2);
    assert.equal(out.frames[0].payload.toString(), 'MSH|1');
    assert.equal(out.frames[0].prefixOk, true);
    assert.equal(out.frames[1].raw.toString(), 'MSH|2\r\n');
  });

  test('empty suffix: every chunk is a frame', () => {
    const d = new FrameDecoder({ prefix: VT, suffix: Buffer.alloc(0) });
    const out = collect(d);
    d.push(Buffer.concat([VT, Buffer.from('MSH|1\r')]));
    d.push(Buffer.from('MSH|2\r'));
    assert.equal(out.frames.length, 2);
    assert.equal(out.frames[0].prefixOk, true);
    assert.equal(out.frames[0].payload.toString(), 'MSH|1\r');
    assert.equal(out.frames[1].prefixOk, false);
    assert.equal(out.frames[1].payload.toString(), 'MSH|2\r');
    assert.equal(d.pending().length, 0);
  });

  test('empty prefix and empty suffix', () => {
    const d = new FrameDecoder({});
    const out = collect(d);
    d.push(Buffer.from('abc'));
    assert.equal(out.frames.length, 1);
    assert.equal(out.frames[0].payload.toString(), 'abc');
    assert.equal(out.frames[0].prefixOk, true);
  });

  test('multi-byte suffix split one byte per chunk with suffix bytes repeated in payload', () => {
    const d = new FrameDecoder({ prefix: VT, suffix: Buffer.from([0x1c, 0x0d]) });
    const out = collect(d);
    const payload = Buffer.concat([Buffer.from('MSH|a'), Buffer.from([0x1c]), Buffer.from('b\r')]);
    const raw = frame(payload, STD);
    for (const b of raw) d.push(Buffer.from([b]));
    assert.equal(out.frames.length, 1);
    assert.deepEqual(out.frames[0].payload, payload);
  });

  test('accepts hex strings and ignores empty chunks, rejects non-buffers', () => {
    const d = new FrameDecoder({ prefix: '0B', suffix: '1C 0D' });
    const out = collect(d);
    d.push(Buffer.alloc(0));
    d.push(hexToBuffer('0B 41 1C 0D'));
    assert.equal(out.frames.length, 1);
    assert.equal(out.frames[0].payload.toString(), 'A');
    assert.throws(() => d.push('text'), /chunk must be a Buffer/);
  });
});
