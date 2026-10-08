import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENCODINGS,
  encode,
  decode,
  encodingFromMsh18,
  msh18ForEncoding,
  checkEncodingConsistency,
  normalizeEncoding,
  isSupportedEncoding,
  analyzeUtf8,
  toBuffer
} from '../src/hl7/encoding.js';

const POLISH = 'Zażółć gęślą jaźń';
const HL7_PL = `MSH|^~\\&|A|B|C|D|20240101||ADT^A01|1|P|2.5||||||8859/2\rPID|1||1||${POLISH}\r`;

describe('ENCODINGS and normalisation', () => {
  test('ENCODINGS list', () => {
    assert.deepEqual(ENCODINGS, ['utf8', 'cp1250', 'iso88592', 'latin1', 'windows1252', 'ascii']);
    for (const e of ENCODINGS) assert.equal(normalizeEncoding(e), e);
  });

  test('aliases', () => {
    assert.equal(normalizeEncoding('UTF-8'), 'utf8');
    assert.equal(normalizeEncoding('utf-8'), 'utf8');
    assert.equal(normalizeEncoding('UNICODE UTF-8'), 'utf8');
    assert.equal(normalizeEncoding('windows-1250'), 'cp1250');
    assert.equal(normalizeEncoding('WINDOWS1250'), 'cp1250');
    assert.equal(normalizeEncoding('CP1250'), 'cp1250');
    assert.equal(normalizeEncoding('win1250'), 'cp1250');
    assert.equal(normalizeEncoding('ISO-8859-2'), 'iso88592');
    assert.equal(normalizeEncoding('iso_8859_2'), 'iso88592');
    assert.equal(normalizeEncoding('8859/2'), 'iso88592');
    assert.equal(normalizeEncoding('latin2'), 'iso88592');
    assert.equal(normalizeEncoding('ISO-8859-1'), 'latin1');
    assert.equal(normalizeEncoding('8859/1'), 'latin1');
    assert.equal(normalizeEncoding('windows-1252'), 'windows1252');
    assert.equal(normalizeEncoding('cp1252'), 'windows1252');
    assert.equal(normalizeEncoding('US-ASCII'), 'ascii');
    assert.equal(normalizeEncoding(' ascii '), 'ascii');
  });

  test('unknown encodings', () => {
    assert.equal(normalizeEncoding('cp1251'), null);
    assert.equal(normalizeEncoding('ebcdic'), null);
    assert.equal(normalizeEncoding(''), null);
    assert.equal(normalizeEncoding(null), null);
    assert.equal(normalizeEncoding(42), null);
    assert.equal(isSupportedEncoding('cp1250'), true);
    assert.equal(isSupportedEncoding('koi8r'), false);
  });

  test('encode/decode throw a readable error for unsupported encodings', () => {
    assert.throws(() => encode('x', 'cp1251'), /Unsupported encoding: cp1251/);
    assert.throws(() => decode(Buffer.from('x'), 'nope'), /Unsupported encoding: nope/);
    assert.throws(() => encode('x', ''), /Unsupported encoding/);
    assert.equal(encode('x', undefined).toString(), 'x');
    try {
      encode('x', 'bad');
    } catch (err) {
      assert.equal(err.code, 'E_ENCODING');
    }
  });
});

describe('cp1250', () => {
  test('round trip of Polish text', () => {
    const buf = encode(POLISH, 'cp1250');
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.length, POLISH.length);
    assert.equal(decode(buf, 'cp1250'), POLISH);
  });

  test('exact byte values', () => {
    const buf = encode('ążśźęćńółŻ', 'cp1250');
    assert.equal(buf.toString('hex').toUpperCase(), 'B9BF9C9FEAE6F1F3B3AF');
    assert.equal(buf[0], 0xb9); // ą
    assert.equal(buf[1], 0xbf); // ż
    assert.equal(buf[2], 0x9c); // ś
    assert.equal(buf[3], 0x9f); // ź
    assert.equal(buf[4], 0xea); // ę
    assert.equal(buf[5], 0xe6); // ć
    assert.equal(buf[6], 0xf1); // ń
    assert.equal(buf[7], 0xf3); // ó
    assert.equal(buf[8], 0xb3); // ł
    assert.equal(buf[9], 0xaf); // Ż
  });

  test('whole HL7 message round trip', () => {
    const buf = encode(HL7_PL, 'cp1250');
    assert.equal(decode(buf, 'cp1250'), HL7_PL);
    assert.equal(buf[buf.length - 1], 0x0d);
  });

  test('unmappable characters become ?', () => {
    assert.equal(decode(encode('a€b中', 'cp1250'), 'cp1250'), 'a€b?');
    assert.equal(decode(encode('Ѐ', 'cp1250'), 'cp1250'), '?');
  });
});

describe('iso88592 / latin1 / windows1252 / utf8 / ascii', () => {
  test('iso88592 byte values and round trip', () => {
    const buf = encode('ążśźęćńół', 'iso88592');
    assert.deepEqual([...buf], [0xb1, 0xbf, 0xb6, 0xbc, 0xea, 0xe6, 0xf1, 0xf3, 0xb3]);
    assert.equal(decode(buf, 'iso88592'), 'ążśźęćńół');
    assert.equal(decode(encode(POLISH, 'ISO-8859-2'), '8859/2'), POLISH);
  });

  test('cp1250 and iso88592 differ for some letters (ś, ź, ą)', () => {
    const a = encode('śźą', 'cp1250');
    const b = encode('śźą', 'iso88592');
    assert.notDeepEqual([...a], [...b]);
    assert.deepEqual([...a], [0x9c, 0x9f, 0xb9]);
    assert.deepEqual([...b], [0xb6, 0xbc, 0xb1]);
    assert.notEqual(decode(a, 'iso88592'), 'śźą');
  });

  test('latin1', () => {
    const buf = encode('café ñ', 'latin1');
    assert.deepEqual([...buf], [0x63, 0x61, 0x66, 0xe9, 0x20, 0xf1]);
    assert.equal(decode(buf, 'latin1'), 'café ñ');
    assert.equal(decode(encode('ł', 'latin1'), 'latin1'), '?');
  });

  test('windows1252', () => {
    const buf = encode('€ café', 'windows1252');
    assert.equal(buf[0], 0x80);
    assert.equal(decode(buf, 'windows1252'), '€ café');
    assert.equal(decode(Buffer.from([0x80]), 'cp1252'), '€');
  });

  test('utf8 round trip and multibyte lengths', () => {
    const buf = encode(POLISH, 'utf8');
    assert.equal(buf.length, Buffer.byteLength(POLISH, 'utf8'));
    assert.ok(buf.length > POLISH.length);
    assert.equal(decode(buf, 'utf8'), POLISH);
    assert.equal(decode(encode('中文 😀', 'UTF-8'), 'utf-8'), '中文 😀');
  });

  test('utf8 BOM is kept visible', () => {
    const withBom = Buffer.from([0xef, 0xbb, 0xbf, 0x4d, 0x53, 0x48]);
    const text = decode(withBom, 'utf8');
    assert.equal(text.length, 4);
    assert.equal(text.charCodeAt(0), 0xfeff);
    assert.equal(text.slice(1), 'MSH');
  });

  test('invalid utf8 decodes to replacement characters, no throw', () => {
    const cp = encode('ż', 'cp1250');
    const text = decode(cp, 'utf8');
    assert.equal(text, '�');
  });

  test('ascii replaces non-ASCII on encode and decode', () => {
    const buf = encode('aż€b', 'ascii');
    assert.deepEqual([...buf], [0x61, 0x3f, 0x3f, 0x62]);
    assert.equal(decode(Buffer.from([0x41, 0xc5, 0x42]), 'ascii'), 'A�B');
    assert.equal(decode(encode('plain MSH|^~\\&|', 'ascii'), 'ascii'), 'plain MSH|^~\\&|');
    assert.deepEqual([...encode('a😀b', 'ascii')], [0x61, 0x3f, 0x62]);
  });

  test('inputs: null text, Uint8Array, ArrayBuffer, byte array, string', () => {
    assert.equal(encode(null, 'utf8').length, 0);
    assert.equal(encode(undefined, 'cp1250').length, 0);
    assert.equal(encode(123, 'utf8').toString(), '123');
    const u8 = new Uint8Array([0x41, 0xbf]);
    assert.equal(decode(u8, 'cp1250'), 'Aż');
    assert.equal(decode(u8.buffer, 'cp1250'), 'Aż');
    assert.equal(decode([0x41, 0xbf], 'cp1250'), 'Aż');
    assert.equal(decode(null, 'utf8'), '');
    const sliced = new Uint8Array([0x00, 0x41, 0xbf, 0x00]).subarray(1, 3);
    assert.equal(decode(sliced, 'cp1250'), 'Aż');
    assert.throws(() => toBuffer(42), TypeError);
    assert.throws(() => decode({}, 'utf8'), TypeError);
  });
});

describe('encodingFromMsh18 / msh18ForEncoding', () => {
  test('standard HL7 table 0211 values', () => {
    assert.equal(encodingFromMsh18('8859/2'), 'iso88592');
    assert.equal(encodingFromMsh18('8859/1'), 'latin1');
    assert.equal(encodingFromMsh18('UNICODE UTF-8'), 'utf8');
    assert.equal(encodingFromMsh18('UTF-8'), 'utf8');
    assert.equal(encodingFromMsh18('UNICODE'), 'utf8');
    assert.equal(encodingFromMsh18('CP1250'), 'cp1250');
    assert.equal(encodingFromMsh18('WINDOWS-1250'), 'cp1250');
    assert.equal(encodingFromMsh18('ASCII'), 'ascii');
    assert.equal(encodingFromMsh18('ISO IR87'), null);
    assert.equal(encodingFromMsh18('8859/5'), null);
    assert.equal(encodingFromMsh18(''), null);
    assert.equal(encodingFromMsh18(null), null);
    assert.equal(encodingFromMsh18(undefined), null);
    assert.equal(encodingFromMsh18(5), null);
  });

  test('repetitions and whitespace', () => {
    assert.equal(encodingFromMsh18('8859/2~UNICODE UTF-8'), 'iso88592');
    assert.equal(encodingFromMsh18('~8859/1'), 'latin1');
    assert.equal(encodingFromMsh18('  unicode utf-8  '), 'utf8');
  });

  test('reverse mapping', () => {
    assert.equal(msh18ForEncoding('utf8'), 'UNICODE UTF-8');
    assert.equal(msh18ForEncoding('iso88592'), '8859/2');
    assert.equal(msh18ForEncoding('latin1'), '8859/1');
    assert.equal(msh18ForEncoding('cp1250'), 'CP1250');
    assert.equal(msh18ForEncoding('windows1252'), 'CP1252');
    assert.equal(msh18ForEncoding('ascii'), 'ASCII');
    assert.equal(msh18ForEncoding('nope'), '');
    for (const e of ENCODINGS) assert.equal(encodingFromMsh18(msh18ForEncoding(e)), e);
  });
});

describe('analyzeUtf8', () => {
  test('counts', () => {
    assert.deepEqual(analyzeUtf8(Buffer.from('abc')), { highBytes: 0, validMultibyte: 0, invalidBytes: 0, length: 3 });
    const utf = analyzeUtf8(encode('żółw', 'utf8'));
    assert.equal(utf.validMultibyte, 3);
    assert.equal(utf.invalidBytes, 0);
    assert.equal(utf.highBytes, 6);
    const cp = analyzeUtf8(encode('żółw', 'cp1250'));
    assert.equal(cp.validMultibyte, 0);
    assert.equal(cp.invalidBytes, 3);
    assert.equal(cp.highBytes, 3);
    const emoji = analyzeUtf8(encode('😀', 'utf8'));
    assert.equal(emoji.validMultibyte, 1);
    assert.equal(emoji.highBytes, 4);
  });

  test('truncated and overlong sequences are invalid', () => {
    assert.equal(analyzeUtf8(Buffer.from([0xc5])).invalidBytes, 1);
    assert.equal(analyzeUtf8(Buffer.from([0xe2, 0x82])).invalidBytes, 2);
    assert.equal(analyzeUtf8(Buffer.from([0xc0, 0x80])).invalidBytes, 2);
    assert.equal(analyzeUtf8(Buffer.from([0xed, 0xa0, 0x80])).invalidBytes, 3);
    assert.equal(analyzeUtf8(Buffer.from([0xe2, 0x82, 0xac])).validMultibyte, 1);
    assert.equal(analyzeUtf8(Buffer.from([0xf4, 0x90, 0x80, 0x80])).invalidBytes, 4);
  });
});

describe('checkEncodingConsistency', () => {
  test('pure ASCII payload never warns about charset', () => {
    const buf = encode('MSH|^~\\&|A|B|C|D|20240101||ADT^A01|1|P|2.5||||||8859/2\r', 'utf8');
    assert.deepEqual(checkEncodingConsistency(buf, '8859/2', 'utf8'), []);
    assert.deepEqual(checkEncodingConsistency(buf, 'UNICODE UTF-8', 'cp1250'), []);
    assert.deepEqual(checkEncodingConsistency(buf, '', 'utf8'), []);
    assert.deepEqual(checkEncodingConsistency(buf, null, null), []);
  });

  test('consistent declared/used/bytes gives no warnings', () => {
    assert.deepEqual(checkEncodingConsistency(encode(HL7_PL, 'iso88592'), '8859/2', 'iso88592'), []);
    assert.deepEqual(checkEncodingConsistency(encode(HL7_PL, 'utf8'), 'UNICODE UTF-8', 'utf8'), []);
    assert.deepEqual(checkEncodingConsistency(encode(HL7_PL, 'cp1250'), 'CP1250', 'cp1250'), []);
    assert.deepEqual(checkEncodingConsistency(encode(HL7_PL, 'cp1250'), '', 'cp1250'), []);
    assert.deepEqual(checkEncodingConsistency(encode(HL7_PL, 'utf8'), undefined, 'utf8'), []);
  });

  test('declared 8859/2 but payload is UTF-8', () => {
    const w = checkEncodingConsistency(encode(HL7_PL, 'utf8'), '8859/2', 'iso88592');
    assert.equal(w.length, 2);
    assert.match(w[0], /MSH-18 declares 8859\/2 but payload contains \d+ valid UTF-8 multibyte sequences/);
    assert.match(w[1], /Decoded as iso88592 but payload looks like UTF-8/);
  });

  test('used utf8 but payload is cp1250', () => {
    const w = checkEncodingConsistency(encode(HL7_PL, 'cp1250'), 'CP1250', 'utf8');
    assert.ok(w.some((x) => /MSH-18 declares CP1250 \(cp1250\) but payload was decoded as utf8/.test(x)));
    assert.ok(w.some((x) => /Decoded as utf8 but payload contains \d+ invalid UTF-8 bytes/.test(x)));
    assert.equal(w.length, 2);
  });

  test('declared UTF-8 but payload is single-byte', () => {
    const w = checkEncodingConsistency(encode(HL7_PL, 'iso88592'), 'UNICODE UTF-8', 'iso88592');
    assert.ok(w.some((x) => /MSH-18 declares UNICODE UTF-8 \(utf8\) but payload was decoded as iso88592/.test(x)));
    assert.ok(w.some((x) => /MSH-18 declares UNICODE UTF-8 but payload contains \d+ invalid UTF-8 bytes/.test(x)));
  });

  test('declared cp1250, decoded as iso88592: mismatch only', () => {
    const w = checkEncodingConsistency(encode(HL7_PL, 'cp1250'), 'CP1250', 'iso88592');
    assert.deepEqual(w, ['MSH-18 declares CP1250 (cp1250) but payload was decoded as iso88592']);
  });

  test('ASCII declared or used with non-ASCII bytes', () => {
    const w1 = checkEncodingConsistency(encode(POLISH, 'cp1250'), 'ASCII', 'cp1250');
    assert.ok(w1.some((x) => /MSH-18 declares ASCII but payload contains 9 non-ASCII bytes/.test(x)));
    const w2 = checkEncodingConsistency(encode(POLISH, 'utf8'), '', 'ascii');
    assert.ok(w2.some((x) => /Decoded as ascii but payload contains 18 non-ASCII bytes/.test(x)));
  });

  test('unknown MSH-18 or configured encoding is reported', () => {
    const w = checkEncodingConsistency(encode('abc', 'utf8'), 'ISO IR87', 'utf8');
    assert.deepEqual(w, ['Unknown character set in MSH-18: "ISO IR87"']);
    const w2 = checkEncodingConsistency(encode('abc', 'utf8'), '', 'koi8r');
    assert.deepEqual(w2, ['Unknown encoding configured: "koi8r"']);
    const w3 = checkEncodingConsistency(encode(POLISH, 'utf8'), 'ISO IR87', 'utf8');
    assert.equal(w3.length, 1);
  });

  test('bad buffer input returns a warning instead of throwing', () => {
    const w = checkEncodingConsistency({ not: 'bytes' }, '8859/2', 'utf8');
    assert.equal(w.length, 1);
    assert.match(w[0], /Cannot analyze payload bytes/);
    assert.deepEqual(checkEncodingConsistency(null, '8859/2', 'utf8'), []);
    assert.deepEqual(checkEncodingConsistency(new Uint8Array([0x41]), '8859/2', 'utf8'), []);
  });
});
