import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, joinTokens, controlGlyph, isControlCode } from '../src/hl7/tokenize.js';

const MSH = 'MSH|^~\\&|SENDAPP|SENDFAC|RECVAPP|RECVFAC|20240315101500||ADT^A01^ADT_A01|MSG00001|P|2.5';
const PID = 'PID|1||12345^^^HOSP^MR~80010112345^^^NAT^PESEL||Kowalski^Jan&Maria^^^^^L';
const NTE = 'NTE|1||Comment with \\F\\ escaped pipe and \\XC5BC\\ hex';
const TEXT = `${MSH}\r${PID}\r${NTE}\r`;

function types(segment) {
  return segment.tokens.map((t) => t.type);
}

describe('tokenize: positions and coverage', () => {
  test('tokens cover every character of every segment', () => {
    const { segments } = tokenize(TEXT);
    assert.equal(segments.length, 3);
    for (const seg of segments) {
      assert.equal(joinTokens(seg), seg.raw);
      let pos = seg.start;
      for (const tok of seg.tokens) {
        assert.equal(tok.start, pos, `token ${tok.type} "${tok.text}" starts at ${pos}`);
        assert.equal(tok.end, pos + tok.text.length);
        assert.equal(TEXT.slice(tok.start, tok.end), tok.text);
        pos = tok.end;
      }
      assert.equal(pos, seg.end);
    }
  });

  test('segment start/end and separatorAfter are exact', () => {
    const { segments } = tokenize(TEXT);
    assert.equal(segments[0].start, 0);
    assert.equal(segments[0].end, MSH.length);
    assert.equal(segments[0].separatorAfter, 'CR');
    assert.equal(segments[1].start, MSH.length + 1);
    assert.equal(segments[1].end, MSH.length + 1 + PID.length);
    assert.equal(segments[2].separatorAfter, 'CR');
    assert.equal(segments[1].index, 1);
    assert.equal(segments[2].name, 'NTE');
  });

  test('separatorAfter reflects LF, CRLF and missing trailing separator', () => {
    const r = tokenize(`${MSH}\n${PID}\r\n${NTE}`);
    assert.equal(r.segments[0].separatorAfter, 'LF');
    assert.equal(r.segments[1].separatorAfter, 'CRLF');
    assert.equal(r.segments[2].separatorAfter, null);
    assert.equal(r.segments[1].start, MSH.length + 1);
    assert.equal(r.segments[2].start, MSH.length + 1 + PID.length + 2);
  });

  test('trailing empty segments are dropped, empty input gives no segments', () => {
    assert.equal(tokenize(`${MSH}\r\r\r`).segments.length, 1);
    assert.equal(tokenize('').segments.length, 0);
    assert.equal(tokenize(null).segments.length, 0);
    assert.equal(tokenize(undefined).segments.length, 0);
    assert.deepEqual(tokenize('').delimiters, { field: '|', component: '^', repetition: '~', escape: '\\', subcomponent: '&' });
  });
});

describe('tokenize: token types and indices', () => {
  test('MSH: separator token is field 1, encoding chars one text token for field 2', () => {
    const seg = tokenize(MSH).segments[0];
    const t = seg.tokens;
    assert.deepEqual(t[0], { type: 'segname', text: 'MSH', fieldIndex: 0, repIndex: 0, componentIndex: 0, subIndex: 0, start: 0, end: 3 });
    assert.equal(t[1].type, 'fieldsep');
    assert.equal(t[1].fieldIndex, 1);
    assert.equal(t[2].type, 'text');
    assert.equal(t[2].text, '^~\\&');
    assert.equal(t[2].fieldIndex, 2);
    assert.equal(t[3].type, 'fieldsep');
    assert.equal(t[3].fieldIndex, 3);
    assert.equal(t[4].text, 'SENDAPP');
    assert.equal(t[4].fieldIndex, 3);
    const msh9 = t.filter((x) => x.fieldIndex === 9);
    assert.deepEqual(msh9.map((x) => x.type), ['fieldsep', 'text', 'compsep', 'text', 'compsep', 'text']);
    assert.deepEqual(msh9.map((x) => x.componentIndex), [1, 1, 2, 2, 3, 3]);
    const ctrl = t.find((x) => x.text === 'MSG00001');
    assert.equal(ctrl.fieldIndex, 10);
    assert.equal(t[t.length - 1].text, '2.5');
    assert.equal(t[t.length - 1].fieldIndex, 12);
    // no escape token inside the encoding characters
    assert.ok(!t.some((x) => x.type === 'escape'));
  });

  test('PID: field, repetition, component and subcomponent indices', () => {
    const seg = tokenize(PID).segments[0];
    const t = seg.tokens;
    assert.equal(t[0].type, 'segname');
    assert.equal(t[0].text, 'PID');
    assert.equal(t[1].type, 'fieldsep');
    assert.equal(t[1].fieldIndex, 1);
    assert.equal(t[2].text, '1');
    assert.equal(t[2].fieldIndex, 1);
    assert.equal(t[3].type, 'fieldsep');
    assert.equal(t[3].fieldIndex, 2);
    assert.equal(t[4].type, 'fieldsep');
    assert.equal(t[4].fieldIndex, 3);
    const f3 = t.filter((x) => x.fieldIndex === 3);
    assert.deepEqual(f3.map((x) => x.type), [
      'fieldsep', 'text', 'compsep', 'compsep', 'compsep', 'text', 'compsep', 'text',
      'repsep', 'text', 'compsep', 'compsep', 'compsep', 'text', 'compsep', 'text'
    ]);
    const rep = f3.find((x) => x.type === 'repsep');
    assert.equal(rep.repIndex, 2);
    assert.equal(rep.componentIndex, 1);
    const pesel = f3.find((x) => x.text === 'PESEL');
    assert.equal(pesel.repIndex, 2);
    assert.equal(pesel.componentIndex, 5);
    assert.equal(pesel.subIndex, 1);
    const hosp = f3.find((x) => x.text === 'HOSP');
    assert.equal(hosp.repIndex, 1);
    assert.equal(hosp.componentIndex, 4);
    const f5 = t.filter((x) => x.fieldIndex === 5);
    const sub = f5.find((x) => x.type === 'subsep');
    assert.equal(sub.text, '&');
    assert.equal(sub.componentIndex, 2);
    assert.equal(sub.subIndex, 2);
    const maria = f5.find((x) => x.text === 'Maria');
    assert.equal(maria.componentIndex, 2);
    assert.equal(maria.subIndex, 2);
    const jan = f5.find((x) => x.text === 'Jan');
    assert.equal(jan.subIndex, 1);
    const l = f5.find((x) => x.text === 'L');
    assert.equal(l.componentIndex, 7);
    assert.equal(l.subIndex, 1);
  });

  test('component index resets after a repetition separator, sub index after component', () => {
    const t = tokenize('OBX|1|ST|X||a&b^c~d&e').segments[0].tokens;
    const f5 = t.filter((x) => x.fieldIndex === 5);
    const e = f5.find((x) => x.text === 'e');
    assert.equal(e.repIndex, 2);
    assert.equal(e.componentIndex, 1);
    assert.equal(e.subIndex, 2);
    const c = f5.find((x) => x.text === 'c');
    assert.equal(c.componentIndex, 2);
    assert.equal(c.subIndex, 1);
  });

  test('escape sequences are single tokens', () => {
    const t = tokenize(NTE).segments[0].tokens;
    const escapes = t.filter((x) => x.type === 'escape');
    assert.deepEqual(escapes.map((x) => x.text), ['\\F\\', '\\XC5BC\\']);
    assert.equal(escapes[0].fieldIndex, 3);
    const texts = t.filter((x) => x.fieldIndex === 3 && x.type === 'text').map((x) => x.text);
    assert.deepEqual(texts, ['Comment with ', ' escaped pipe and ', ' hex']);
  });

  test('unterminated or empty escapes are plain text', () => {
    const t1 = tokenize('NTE|1||a\\b').segments[0].tokens;
    assert.ok(!t1.some((x) => x.type === 'escape'));
    assert.equal(t1[t1.length - 1].text, 'a\\b');
    const t2 = tokenize('NTE|1||a\\\\b').segments[0].tokens;
    assert.ok(!t2.some((x) => x.type === 'escape'));
    const t3 = tokenize('NTE|1||a\\F|b\\').segments[0].tokens;
    assert.ok(!t3.some((x) => x.type === 'escape'));
    assert.equal(joinTokens(tokenize('NTE|1||a\\F|b\\').segments[0]), 'NTE|1||a\\F|b\\');
  });
});

describe('tokenize: control characters', () => {
  test('control chars become ctrl tokens with glyphs', () => {
    const line = 'PID|1|\x0Bx\x1Cy\x09z\x00w\x7Fv\x1E';
    const t = tokenize(line).segments[0].tokens;
    const ctrl = t.filter((x) => x.type === 'ctrl');
    assert.equal(ctrl.length, 6);
    assert.deepEqual(ctrl.map((x) => x.glyph), ['␋', '␜', '␉', '␀', '␡', '␞']);
    assert.deepEqual(ctrl.map((x) => x.code), [0x0b, 0x1c, 0x09, 0x00, 0x7f, 0x1e]);
    assert.deepEqual(ctrl.map((x) => x.text), ['\x0B', '\x1C', '\x09', '\x00', '\x7F', '\x1E']);
    assert.equal(ctrl[0].fieldIndex, 2);
    assert.equal(joinTokens(tokenize(line).segments[0]), line);
  });

  test('controlGlyph and isControlCode', () => {
    assert.equal(controlGlyph(0x0d), '␍');
    assert.equal(controlGlyph(0x0a), '␊');
    assert.equal(controlGlyph(0x1c), '␜');
    assert.equal(controlGlyph(0x0b), '␋');
    assert.equal(controlGlyph(0x7f), '␡');
    assert.equal(controlGlyph(0x41), '');
    assert.equal(isControlCode(0x1f), true);
    assert.equal(isControlCode(0x20), false);
    assert.equal(isControlCode(0x7f), true);
  });

  test('byte order mark is a ctrl token with glyph BOM and does not hide the MSH', () => {
    const text = String.fromCharCode(0xfeff) + MSH + '\r' + PID;
    const { segments } = tokenize(text);
    assert.equal(segments[0].name, 'MSH');
    assert.equal(segments[0].tokens[0].type, 'ctrl');
    assert.equal(segments[0].tokens[0].glyph, 'BOM');
    assert.equal(segments[0].tokens[0].code, 0xfeff);
    assert.equal(segments[0].tokens[1].type, 'segname');
    assert.equal(segments[0].tokens[1].start, 1);
    assert.equal(joinTokens(segments[0]), String.fromCharCode(0xfeff) + MSH);
    assert.equal(controlGlyph(0xfeff), 'BOM');
  });

  test('leaked MLLP bytes around the message stay visible with exact positions', () => {
    const text = `\x0B${MSH}\r${PID}\r\x1C\r`;
    const { segments } = tokenize(text);
    assert.equal(segments.length, 3);
    assert.equal(segments[0].name, 'MSH');
    assert.equal(segments[0].tokens[0].type, 'ctrl');
    assert.equal(segments[0].tokens[0].glyph, '␋');
    assert.equal(segments[0].tokens[0].start, 0);
    assert.equal(segments[0].tokens[1].type, 'segname');
    assert.equal(segments[0].tokens[1].start, 1);
    assert.equal(segments[0].tokens[2].fieldIndex, 1);
    assert.equal(joinTokens(segments[0]), `\x0B${MSH}`);
    assert.equal(segments[2].name, '???');
    assert.equal(segments[2].tokens.length, 1);
    assert.equal(segments[2].tokens[0].type, 'ctrl');
    assert.equal(segments[2].tokens[0].glyph, '␜');
    // delimiters still detected from the MSH behind the VT
    assert.equal(segments[1].tokens.filter((t) => t.type === 'compsep').length > 0, true);
  });
});

describe('tokenize: delimiters and odd lines', () => {
  test('custom delimiters auto-detected from MSH', () => {
    const text = 'MSH#*;!%#A#B#C#D#20240101##ADT*A01#1#P#2.5\rPID#1##x*y%z;w!F!q';
    const { segments, delimiters } = tokenize(text);
    assert.deepEqual(delimiters, { field: '#', component: '*', repetition: ';', escape: '!', subcomponent: '%' });
    const pid = segments[1];
    assert.deepEqual(types(pid), ['segname', 'fieldsep', 'text', 'fieldsep', 'fieldsep', 'text', 'compsep', 'text', 'subsep', 'text', 'repsep', 'text', 'escape', 'text']);
    assert.equal(pid.tokens[12].text, '!F!');
    assert.equal(segments[0].tokens[2].text, '*;!%');
    assert.equal(segments[0].tokens[2].type, 'text');
  });

  test('explicit delimiters override detection', () => {
    const r = tokenize('PID|1||a*b', { component: '*' });
    assert.deepEqual(types(r.segments[0]), ['segname', 'fieldsep', 'text', 'fieldsep', 'fieldsep', 'text', 'compsep', 'text']);
    assert.equal(r.delimiters.component, '*');
    assert.equal(r.delimiters.field, '|');
    const r2 = tokenize('PID|1||a*b', { component: 'invalid' });
    assert.equal(r2.delimiters.component, '^');
  });

  test('line without a segment name has no segname token and starts at field 1', () => {
    const r = tokenize('hello world|second');
    const seg = r.segments[0];
    assert.equal(seg.name, '???');
    assert.deepEqual(types(seg), ['text', 'fieldsep', 'text']);
    assert.equal(seg.tokens[0].fieldIndex, 1);
    assert.equal(seg.tokens[2].fieldIndex, 2);
    assert.equal(joinTokens(seg), 'hello world|second');
  });

  test('empty middle line is an empty ??? segment', () => {
    const r = tokenize(`${MSH}\r\r${PID}\r`);
    assert.equal(r.segments.length, 3);
    assert.equal(r.segments[1].name, '???');
    assert.deepEqual(r.segments[1].tokens, []);
    assert.equal(r.segments[1].start, MSH.length + 1);
    assert.equal(r.segments[1].end, MSH.length + 1);
    assert.equal(r.segments[2].start, MSH.length + 2);
  });

  test('segment name only and MSH only', () => {
    const r = tokenize('PID');
    assert.deepEqual(types(r.segments[0]), ['segname']);
    const m = tokenize('MSH');
    assert.deepEqual(types(m.segments[0]), ['segname']);
    const m2 = tokenize('MSH|');
    assert.deepEqual(types(m2.segments[0]), ['segname', 'fieldsep']);
    assert.equal(m2.segments[0].tokens[1].fieldIndex, 1);
  });

  test('Z segments and lowercase names', () => {
    assert.equal(tokenize('ZPI|1').segments[0].name, 'ZPI');
    assert.equal(tokenize('ZPI|1').segments[0].tokens[0].type, 'segname');
    assert.equal(tokenize('pid|1').segments[0].name, '???');
    assert.equal(tokenize('pid|1').segments[0].tokens[0].type, 'text');
  });

  test('non-ASCII text stays in text tokens', () => {
    const seg = tokenize('PID|1||Zażółć^gęślą').segments[0];
    const texts = seg.tokens.filter((t) => t.type === 'text').map((t) => t.text);
    assert.deepEqual(texts, ['1', 'Zażółć', 'gęślą']);
    assert.equal(joinTokens(seg), 'PID|1||Zażółć^gęślą');
  });
});
