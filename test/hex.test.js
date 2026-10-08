import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hexToBuffer, bufferToHex, normalizeHex, hexdump } from '../src/core/hex.js';

describe('hexToBuffer', () => {
  test('accepts every documented spelling', () => {
    const expected = Buffer.from([0x0b, 0x1c, 0x0d]);
    for (const input of ['0B1C0D', '0b1c0d', '0x0B1C0D', '0B 1C 0D', '0B,1C,0D', '0x0B 0x1C 0x0D', ' 0b , 1C  0d ', '0B:1C:0D']) {
      assert.deepEqual(hexToBuffer(input), expected, `input ${JSON.stringify(input)}`);
    }
  });

  test('single byte and empty string', () => {
    assert.deepEqual(hexToBuffer('0B'), Buffer.from([0x0b]));
    assert.deepEqual(hexToBuffer('0x0b'), Buffer.from([0x0b]));
    assert.equal(hexToBuffer('').length, 0);
    assert.equal(hexToBuffer('   ').length, 0);
  });

  test('throws Invalid hex on odd length and non-hex characters', () => {
    assert.throws(() => hexToBuffer('0B1'), /Invalid hex: 0B1/);
    assert.throws(() => hexToBuffer('0G'), /Invalid hex: 0G/);
    assert.throws(() => hexToBuffer('0x1 0x2'), /Invalid hex/);
    assert.throws(() => hexToBuffer('zz'), /Invalid hex/);
    assert.throws(() => hexToBuffer(null), /Invalid hex: null/);
    assert.throws(() => hexToBuffer(12), /Invalid hex: 12/);
  });

  test('copies buffers', () => {
    const src = Buffer.from([1, 2]);
    const out = hexToBuffer(src);
    assert.deepEqual(out, src);
    out[0] = 9;
    assert.equal(src[0], 1);
  });
});

describe('bufferToHex / normalizeHex', () => {
  test('uppercase with separator by default', () => {
    assert.equal(bufferToHex(Buffer.from([0x0b, 0x1c, 0x0d])), '0B 1C 0D');
    assert.equal(bufferToHex(Buffer.from([0x0b, 0x1c, 0x0d]), ''), '0B1C0D');
    assert.equal(bufferToHex(Buffer.from([0xff]), ':'), 'FF');
    assert.equal(bufferToHex(Buffer.from([0xab, 0xcd]), ':'), 'AB:CD');
    assert.equal(bufferToHex(Buffer.alloc(0)), '');
    assert.equal(bufferToHex(new Uint8Array([0x01, 0x02])), '01 02');
  });

  test('normalizeHex canonicalises and validates', () => {
    assert.equal(normalizeHex('0x0b 0x1c 0d'), '0B1C0D');
    assert.equal(normalizeHex(''), '');
    assert.throws(() => normalizeHex('xyz'), /Invalid hex/);
  });
});

describe('hexdump', () => {
  test('classifies prefix, suffix, ctrl, nonascii and text', () => {
    const raw = Buffer.concat([
      Buffer.from([0x0b]),
      Buffer.from('MSH|\tA', 'latin1'),
      Buffer.from([0xc5, 0x7f]),
      Buffer.from([0x1c, 0x0d]),
    ]);
    const dump = hexdump(raw, { prefixLen: 1, suffixLen: 2 });
    assert.equal(dump.length, raw.length);
    assert.equal(dump.lines.length, 1);
    const bytes = dump.lines[0].bytes;
    assert.equal(bytes[0].cls, 'prefix');
    assert.equal(bytes[0].hex, '0B');
    assert.equal(bytes[0].ascii, '.');
    assert.equal(bytes[1].cls, 'text');
    assert.equal(bytes[1].ascii, 'M');
    assert.equal(bytes[5].hex, '09');
    assert.equal(bytes[5].cls, 'ctrl');
    assert.equal(bytes[7].hex, 'C5');
    assert.equal(bytes[7].cls, 'nonascii');
    assert.equal(bytes[8].hex, '7F');
    assert.equal(bytes[8].cls, 'ctrl');
    assert.equal(bytes[9].cls, 'suffix');
    assert.equal(bytes[10].cls, 'suffix');
    assert.equal(bytes[10].offset, 10);
    assert.equal(dump.lines[0].ascii, '.MSH|.A....');
  });

  test('splits lines by bytesPerLine with offsets', () => {
    const raw = Buffer.alloc(40, 0x41);
    const dump = hexdump(raw, { bytesPerLine: 16 });
    assert.equal(dump.lines.length, 3);
    assert.deepEqual(dump.lines.map((l) => l.offset), [0, 16, 32]);
    assert.equal(dump.lines[2].bytes.length, 8);
    assert.equal(dump.lines[0].hex.split(' ').length, 16);
  });

  test('defaults and empty input', () => {
    assert.deepEqual(hexdump(Buffer.alloc(0)), { lines: [], length: 0 });
    const dump = hexdump(Buffer.alloc(20), { bytesPerLine: 'nope' });
    assert.equal(dump.lines.length, 2);
    const clamped = hexdump(Buffer.from([1, 2]), { prefixLen: 5, suffixLen: 5 });
    assert.deepEqual(clamped.lines[0].bytes.map((b) => b.cls), ['prefix', 'prefix']);
  });
});
