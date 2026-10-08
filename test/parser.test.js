import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMessage,
  summarize,
  serialize,
  setField,
  unescape,
  escape,
  parsePath,
  detectSegmentSeparator,
  splitSegments,
  detectDelimiters,
  Message,
  isMessage,
  DEFAULT_DELIMITERS
} from '../src/hl7/parser.js';

const ADT = [
  'MSH|^~\\&|SENDAPP|SENDFAC|RECVAPP|RECVFAC|20240315101500||ADT^A01^ADT_A01|MSG00001|P|2.5|||AL|NE||8859/2',
  'EVN|A01|20240315101500',
  'PID|1||12345^^^HOSP^MR~80010112345^^^NAT^PESEL||Kowalski^Jan^Maria^^^^L||19800101|M|||ul. Testowa 1^^Warszawa^^00-001^PL',
  'PV1|1|I|ONC^101^A^HOSP||||1234^Nowak^Anna|||ONC',
  'OBX|1|NM|GLU^Glucose||5.4|mmol/L|3.9-6.1|N|||F',
  'OBX|2|ST|NOTE^Note||first^second&sub2&sub3^third|||||||F',
  'NTE|1||Comment with \\F\\ escaped pipe'
];
const ADT_CR = `${ADT.join('\r')}\r`;

describe('parseMessage: basic structure', () => {
  test('splits segments and reads names', () => {
    const m = parseMessage(ADT_CR);
    assert.equal(m.segments.length, 7);
    assert.deepEqual(m.segments.map((s) => s.name), ['MSH', 'EVN', 'PID', 'PV1', 'OBX', 'OBX', 'NTE']);
    assert.equal(m.segments[2].index, 2);
    assert.equal(m.segments[2].raw, ADT[2]);
    assert.deepEqual(m.warnings, []);
    assert.ok(isMessage(m));
    assert.ok(m instanceof Message);
  });

  test('ignores empty trailing segments', () => {
    const m = parseMessage(`${ADT.join('\r')}\r\r\r`);
    assert.equal(m.segments.length, 7);
  });

  test('default delimiters when MSH uses the standard set', () => {
    const m = parseMessage(ADT_CR);
    assert.equal(m.delimiters.field, '|');
    assert.equal(m.delimiters.component, '^');
    assert.equal(m.delimiters.repetition, '~');
    assert.equal(m.delimiters.escape, '\\');
    assert.equal(m.delimiters.subcomponent, '&');
    assert.equal(m.delimiters.segment, 'CR');
  });

  test('MSH-1 and MSH-2 numbering quirk', () => {
    const m = parseMessage(ADT_CR);
    const msh = m.segments[0];
    assert.equal(msh.fields[0].value, 'MSH');
    assert.equal(msh.fields[1].value, '|');
    assert.equal(msh.fields[2].value, '^~\\&');
    assert.equal(msh.fields[3].value, 'SENDAPP');
    assert.equal(msh.fields[9].value, 'ADT^A01^ADT_A01');
    assert.equal(msh.fields[10].value, 'MSG00001');
    assert.equal(msh.fields[12].value, '2.5');
    assert.equal(msh.fields[18].value, '8859/2');
    // MSH-2 is never split into components
    assert.equal(msh.fields[2].repetitions.length, 1);
    assert.equal(msh.fields[2].repetitions[0].components.length, 1);
  });

  test('fields[0] is the segment name for non-MSH segments', () => {
    const m = parseMessage(ADT_CR);
    const pid = m.getSegment('PID');
    assert.equal(pid.fields[0].value, 'PID');
    assert.equal(pid.fields[1].value, '1');
    assert.equal(pid.fields[2].value, '');
    assert.equal(pid.fields[3].value, '12345^^^HOSP^MR~80010112345^^^NAT^PESEL');
  });

  test('repetitions, components and subcomponents', () => {
    const m = parseMessage(ADT_CR);
    const pid3 = m.getSegment('PID').fields[3];
    assert.equal(pid3.repetitions.length, 2);
    assert.equal(pid3.repetitions[0].value, '12345^^^HOSP^MR');
    assert.equal(pid3.repetitions[1].components[4].value, 'PESEL');
    const obx5 = m.getSegment('OBX', 2).fields[5];
    assert.equal(obx5.repetitions[0].components.length, 3);
    assert.deepEqual(obx5.repetitions[0].components[1].subcomponents, ['second', 'sub2', 'sub3']);
    assert.deepEqual(obx5.repetitions[0].components[0].subcomponents, ['first']);
  });
});

describe('parseMessage: segment separators', () => {
  test('LF separators', () => {
    const m = parseMessage(ADT.join('\n'));
    assert.equal(m.segments.length, 7);
    assert.equal(m.delimiters.segment, 'LF');
    assert.equal(m.get('PID-3.1'), '12345');
  });

  test('CRLF separators', () => {
    const m = parseMessage(`${ADT.join('\r\n')}\r\n`);
    assert.equal(m.segments.length, 7);
    assert.equal(m.delimiters.segment, 'CRLF');
    assert.equal(m.get('OBX[2]-1'), '2');
  });

  test('mixed separators', () => {
    const m = parseMessage(`${ADT[0]}\r${ADT[1]}\n${ADT[2]}\r\n`);
    assert.equal(m.segments.length, 3);
    assert.equal(m.delimiters.segment, 'mixed');
  });

  test('single segment has no separator', () => {
    const m = parseMessage(ADT[0]);
    assert.equal(m.segments.length, 1);
    assert.equal(m.delimiters.segment, 'none');
  });

  test('detectSegmentSeparator and splitSegments', () => {
    assert.equal(detectSegmentSeparator('a\rb\r'), 'CR');
    assert.equal(detectSegmentSeparator('a\nb'), 'LF');
    assert.equal(detectSegmentSeparator('a\r\nb'), 'CRLF');
    assert.equal(detectSegmentSeparator('a\r\nb\rc'), 'mixed');
    assert.equal(detectSegmentSeparator('abc'), 'none');
    const parts = splitSegments('MSH|x\r\nPID|y\r');
    assert.equal(parts.length, 2);
    assert.deepEqual(parts[0], { raw: 'MSH|x', start: 0, end: 5, separatorAfter: 'CRLF' });
    assert.deepEqual(parts[1], { raw: 'PID|y', start: 7, end: 12, separatorAfter: 'CR' });
  });

  test('empty line in the middle becomes ??? with warning', () => {
    const m = parseMessage(`${ADT[0]}\r\r${ADT[2]}\r`);
    assert.equal(m.segments.length, 3);
    assert.equal(m.segments[1].name, '???');
    assert.equal(m.segments[1].raw, '');
    assert.ok(m.warnings.some((w) => /Line 2 is empty/.test(w)));
  });
});

describe('parseMessage: custom delimiters', () => {
  const CUSTOM = 'MSH#*;\\%#SEND#FAC#RECV#RFAC#20240101000000##ADT*A01#CTRL1#P#2.5\rPID#1##123*4*5%6;789*x\r';

  test('reads delimiters from MSH-2', () => {
    const m = parseMessage(CUSTOM);
    assert.equal(m.delimiters.field, '#');
    assert.equal(m.delimiters.component, '*');
    assert.equal(m.delimiters.repetition, ';');
    assert.equal(m.delimiters.escape, '\\');
    assert.equal(m.delimiters.subcomponent, '%');
    assert.equal(m.get('MSH-1'), '#');
    assert.equal(m.get('MSH-2'), '*;\\%');
    assert.equal(m.get('MSH-9.1'), 'ADT');
    assert.equal(m.get('MSH-9.2'), 'A01');
    assert.equal(m.get('MSH-10'), 'CTRL1');
    assert.equal(m.get('PID-3.1'), '123');
    assert.equal(m.get('PID-3.3.2'), '6');
    assert.equal(m.get('PID-3(2)'), '789*x');
    assert.equal(m.get('PID-3(2).2'), 'x');
  });

  test('incomplete MSH-2 falls back to defaults with a warning', () => {
    const m = parseMessage('MSH|^~|A|B|C|D|20240101||ADT^A01|1|P|2.5\rPID|1||1^2&3');
    assert.equal(m.delimiters.escape, '\\');
    assert.equal(m.delimiters.subcomponent, '&');
    assert.ok(m.warnings.some((w) => /incomplete/.test(w)));
    assert.equal(m.get('PID-3.2.2'), '3');
  });

  test('conflicting delimiters are reset to defaults with a warning', () => {
    const m = parseMessage('MSH|^^\\&|A|B\rPID|1||x^y');
    assert.equal(m.delimiters.repetition, '~');
    assert.ok(m.warnings.some((w) => /Delimiter conflict/.test(w)));
  });

  test('opts.delimiters override detection', () => {
    const m = parseMessage('PID|1||a*b', { delimiters: { component: '*' } });
    assert.equal(m.get('PID-3.2'), 'b');
  });

  test('detectDelimiters exposes warnings and MSH line', () => {
    const r = detectDelimiters('PID|1');
    assert.deepEqual(r.delimiters, { ...DEFAULT_DELIMITERS });
    assert.ok(r.warnings.some((w) => /No MSH/.test(w)));
    assert.equal(r.mshLine, null);
  });
});

describe('Message.get path grammar', () => {
  const m = parseMessage(ADT_CR);

  test('segment only returns raw', () => {
    assert.equal(m.get('EVN'), ADT[1]);
    assert.equal(m.get('OBX[2]'), ADT[5]);
  });

  test('field, component, subcomponent', () => {
    assert.equal(m.get('MSH-9'), 'ADT^A01^ADT_A01');
    assert.equal(m.get('MSH-9.1'), 'ADT');
    assert.equal(m.get('MSH-9.3'), 'ADT_A01');
    assert.equal(m.get('PID-5.1'), 'Kowalski');
    assert.equal(m.get('PID-5.2'), 'Jan');
    assert.equal(m.get('PID-5.7'), 'L');
    assert.equal(m.get('OBX[2]-5.2.2'), 'sub2');
    assert.equal(m.get('OBX[2]-5.2.3'), 'sub3');
    assert.equal(m.get('OBX[2]-5.1.1'), 'first');
  });

  test('repetitions', () => {
    assert.equal(m.get('PID-3'), '12345^^^HOSP^MR~80010112345^^^NAT^PESEL');
    assert.equal(m.get('PID-3.1'), '12345');
    assert.equal(m.get('PID-3(1).1'), '12345');
    assert.equal(m.get('PID-3(2).1'), '80010112345');
    assert.equal(m.get('PID-3(2).5'), 'PESEL');
    assert.equal(m.get('PID-3(2)'), '80010112345^^^NAT^PESEL');
    assert.equal(m.get('PID-3(3).1'), '');
  });

  test('occurrences', () => {
    assert.equal(m.get('OBX-1'), '1');
    assert.equal(m.get('OBX[1]-1'), '1');
    assert.equal(m.get('OBX[2]-1'), '2');
    assert.equal(m.get('OBX[2]-5(1).1'), 'first');
    assert.equal(m.get('OBX[3]-1'), '');
    assert.equal(m.getSegment('OBX', 2).fields[2].value, 'ST');
    assert.equal(m.getSegment('OBX', 3), null);
    assert.equal(m.getSegments('OBX').length, 2);
  });

  test('MSH-1 / MSH-2 and whole-value behaviour', () => {
    assert.equal(m.get('MSH-1'), '|');
    assert.equal(m.get('MSH-2'), '^~\\&');
    assert.equal(m.get('MSH-2.1'), '^~\\&');
    assert.equal(m.get('MSH-18'), '8859/2');
    assert.equal(m.get('MSH-0'), 'MSH');
  });

  test('absent values and invalid paths return empty string', () => {
    assert.equal(m.get('ZZZ-1'), '');
    assert.equal(m.get('PID-99'), '');
    assert.equal(m.get('PID-5.99'), '');
    assert.equal(m.get('PID-5.1.9'), '');
    assert.equal(m.get('PID-3(0).1'), '');
    assert.equal(m.get('not a path'), '');
    assert.equal(m.get(''), '');
    assert.equal(m.get(null), '');
    assert.equal(m.get(42), '');
  });

  test('path is case-insensitive for the segment name and tolerates spaces', () => {
    assert.equal(m.get('pid-5.1'), 'Kowalski');
    assert.equal(m.get('  PID-5.1  '), 'Kowalski');
  });

  test('has()', () => {
    assert.equal(m.has('PID-5'), true);
    assert.equal(m.has('PID-99'), false);
    assert.equal(m.has('ZZZ'), false);
    assert.equal(m.has('OBX[2]'), true);
  });

  test('parsePath', () => {
    assert.deepEqual(parsePath('OBX[2]-5(1).3.2'), {
      segment: 'OBX', occurrence: 2, field: 5, repetition: 1, component: 3, subcomponent: 2
    });
    assert.deepEqual(parsePath('PID'), {
      segment: 'PID', occurrence: 1, field: null, repetition: null, component: null, subcomponent: null
    });
    assert.equal(parsePath('PID-'), null);
    assert.equal(parsePath('PID[0]-1'), null);
    assert.equal(parsePath('P-1'), null);
    assert.equal(parsePath(undefined), null);
  });
});

describe('parseMessage: robustness', () => {
  test('never throws on weird input', () => {
    for (const input of [null, undefined, '', 42, {}, [], true, '\r\n', 'garbage', '|||', 'MSH', 'MSH|']) {
      assert.doesNotThrow(() => parseMessage(input));
    }
    assert.equal(parseMessage(null).segments.length, 0);
    assert.equal(parseMessage('').segments.length, 0);
    assert.ok(parseMessage('').warnings.includes('Message is empty'));
    assert.equal(parseMessage(42).segments[0].name, '???');
  });

  test('lines not starting with a segment name become ??? with a warning', () => {
    const m = parseMessage(`${ADT[0]}\rhello world|x\r`);
    assert.equal(m.segments[1].name, '???');
    assert.equal(m.segments[1].fields[0].value, '???');
    assert.equal(m.segments[1].fields[1].value, 'hello world');
    assert.equal(m.get('???-2'), 'x');
    assert.ok(m.warnings.some((w) => /Line 2 does not start with a segment name/.test(w)));
  });

  test('lowercase or too long names are not segment names', () => {
    const m = parseMessage(`${ADT[0]}\rpid|1\rPIDX|2\r`);
    assert.equal(m.segments[1].name, '???');
    assert.equal(m.segments[2].name, '???');
  });

  test('no MSH segment: default delimiters and warning', () => {
    const m = parseMessage('PID|1||123^^^HOSP\rPV1|1|O');
    assert.equal(m.segments.length, 2);
    assert.equal(m.get('PID-3.4'), 'HOSP');
    assert.ok(m.warnings.some((w) => /No MSH segment/.test(w)));
  });

  test('first segment not MSH warning', () => {
    const m = parseMessage(`EVN|A01\r${ADT[0]}\r`);
    assert.ok(m.warnings.some((w) => /First segment is EVN, expected MSH/.test(w)));
    assert.equal(m.get('MSH-10'), 'MSG00001');
  });

  test('leaked MLLP framing bytes are stripped with warnings', () => {
    const m = parseMessage(`\x0B${ADT_CR}\x1C\r`);
    assert.equal(m.segments[0].name, 'MSH');
    assert.equal(m.segments.length, 7);
    assert.ok(m.warnings.some((w) => /0x0B/.test(w)));
    assert.ok(m.warnings.some((w) => /0x1C/.test(w)));
  });

  test('leading byte order mark is stripped with a warning', () => {
    const m = parseMessage(`${String.fromCharCode(0xfeff)}${ADT_CR}`);
    assert.equal(m.segments[0].name, 'MSH');
    assert.equal(m.get('MSH-10'), 'MSG00001');
    assert.ok(m.warnings.some((w) => /byte order mark/.test(w)));
  });

  test('truncated MSH', () => {
    const m = parseMessage('MSH');
    assert.equal(m.segments[0].name, 'MSH');
    assert.equal(m.segments[0].fields.length, 1);
    assert.ok(m.warnings.some((w) => /truncated/.test(w)));
  });

  test('Z segments are accepted', () => {
    const m = parseMessage(`${ADT[0]}\rZPI|1|custom^data\r`);
    assert.equal(m.segments[1].name, 'ZPI');
    assert.equal(m.get('ZPI-2.2'), 'data');
  });
});

describe('toJSON', () => {
  test('plain object with nested arrays, survives JSON.stringify', () => {
    const m = parseMessage(ADT_CR);
    const json = JSON.parse(JSON.stringify(m));
    assert.equal(json.segments.length, 7);
    assert.equal(json.delimiters.field, '|');
    assert.equal(json.delimiters.segment, 'CR');
    assert.deepEqual(json.warnings, []);
    const pid = json.segments[2];
    assert.equal(pid.name, 'PID');
    assert.equal(pid.index, 2);
    assert.equal(pid.raw, ADT[2]);
    assert.equal(pid.values[3], '12345^^^HOSP^MR~80010112345^^^NAT^PESEL');
    // fields[n] = repetitions -> components -> subcomponents
    assert.deepEqual(pid.fields[3][0][0], ['12345']);
    assert.deepEqual(pid.fields[3][1][4], ['PESEL']);
    assert.deepEqual(json.segments[5].fields[5][0][1], ['second', 'sub2', 'sub3']);
    assert.deepEqual(json.segments[0].fields[2], [[['^~\\&']]]);
    assert.deepEqual(json.segments[0].fields[1], [[['|']]]);
    assert.equal(typeof m.toJSON().segments[0].fields[0][0][0][0], 'string');
    assert.equal(json.segments[0].get, undefined);
  });
});

describe('serialize', () => {
  test('round trip with CR', () => {
    const m = parseMessage(ADT_CR);
    assert.equal(serialize(m), ADT_CR);
    assert.equal(serialize(m, '\r'), ADT_CR);
  });

  test('round trip normalises LF input to CR', () => {
    const m = parseMessage(ADT.join('\n'));
    assert.equal(serialize(m), ADT_CR);
    const again = parseMessage(serialize(m));
    assert.deepEqual(again.toJSON().segments, m.toJSON().segments);
  });

  test('custom separator and empty message', () => {
    const m = parseMessage(ADT_CR);
    assert.equal(serialize(m, '\n'), `${ADT.join('\n')}\n`);
    assert.equal(serialize(parseMessage('')), '');
    assert.equal(serialize(ADT_CR), ADT_CR);
  });
});

describe('setField', () => {
  test('sets MSH-10 keeping raw and value in sync', () => {
    const m = parseMessage(ADT_CR);
    setField(m, 'MSH-10', 'NEWCTRL');
    assert.equal(m.get('MSH-10'), 'NEWCTRL');
    assert.equal(m.segments[0].fields[10].value, 'NEWCTRL');
    assert.ok(m.segments[0].raw.includes('|NEWCTRL|P|2.5|'));
    assert.equal(m.segments[0].raw, ADT[0].replace('MSG00001', 'NEWCTRL'));
    assert.ok(serialize(m).includes('NEWCTRL'));
    assert.equal(m.get('MSH-18'), '8859/2');
  });

  test('sets a component and keeps the other components', () => {
    const m = parseMessage(ADT_CR);
    setField(m, 'PID-5.2', 'Adam');
    assert.equal(m.get('PID-5.2'), 'Adam');
    assert.equal(m.get('PID-5.1'), 'Kowalski');
    assert.equal(m.get('PID-5'), 'Kowalski^Adam^Maria^^^^L');
    assert.ok(m.getSegment('PID').raw.includes('Kowalski^Adam^Maria^^^^L'));
  });

  test('sets a repetition component and a subcomponent', () => {
    const m = parseMessage(ADT_CR);
    setField(m, 'PID-3(2).1', '99999');
    assert.equal(m.get('PID-3(2).1'), '99999');
    assert.equal(m.get('PID-3(1).1'), '12345');
    setField(m, 'OBX[2]-5.2.3', 'changed');
    assert.equal(m.get('OBX[2]-5.2.3'), 'changed');
    assert.equal(m.get('OBX[2]-5.2.2'), 'sub2');
    assert.equal(m.get('OBX[2]-5'), 'first^second&sub2&changed^third');
  });

  test('pads missing fields, components and repetitions', () => {
    const m = parseMessage('MSH|^~\\&|A|B|C|D|20240101||ADT^A01|1|P|2.5\rPID|1\r');
    setField(m, 'PID-5.1', 'Nowak');
    assert.equal(m.get('PID-5.1'), 'Nowak');
    assert.equal(m.getSegment('PID').raw, 'PID|1||||Nowak');
    setField(m, 'PID-3(2).4', 'NAT');
    assert.equal(m.getSegment('PID').raw, 'PID|1||~^^^NAT||Nowak');
    setField(m, 'PID-5.3', 'X');
    assert.equal(m.get('PID-5'), 'Nowak^^X');
    setField(m, 'MSH-18', 'UNICODE UTF-8');
    assert.equal(m.get('MSH-18'), 'UNICODE UTF-8');
    assert.equal(m.segments[0].raw, 'MSH|^~\\&|A|B|C|D|20240101||ADT^A01|1|P|2.5||||||UNICODE UTF-8');
  });

  test('null value clears, numbers are stringified', () => {
    const m = parseMessage(ADT_CR);
    setField(m, 'PID-8', null);
    assert.equal(m.get('PID-8'), '');
    setField(m, 'PID-1', 7);
    assert.equal(m.get('PID-1'), '7');
  });

  test('errors are readable', () => {
    const m = parseMessage(ADT_CR);
    assert.throws(() => setField(m, 'ZZZ-1', 'x'), /not found/);
    assert.throws(() => setField(m, 'MSH-1', '#'), /MSH-1 and MSH-2/);
    assert.throws(() => setField(m, 'MSH-2', '#'), /MSH-1 and MSH-2/);
    assert.throws(() => setField(m, 'PID', 'x'), /invalid field path/);
    assert.throws(() => setField(m, 'PID-0', 'x'), /segment name/);
    assert.throws(() => setField(m, 'bad path', 'x'), /invalid field path/);
    assert.throws(() => setField(null, 'PID-1', 'x'), /parsed Message/);
  });

  test('works with custom delimiters', () => {
    const m = parseMessage('MSH#*;\\%#A#B#C#D#20240101##ADT*A01#1#P#2.5\rPID#1##x*y\r');
    setField(m, 'PID-3.2', 'z');
    assert.equal(m.getSegment('PID').raw, 'PID#1##x*z');
    setField(m, 'MSH-10', 'C2');
    assert.equal(m.segments[0].raw, 'MSH#*;\\%#A#B#C#D#20240101##ADT*A01#C2#P#2.5');
  });
});

describe('unescape / escape', () => {
  test('standard escape sequences', () => {
    assert.equal(unescape('a\\F\\b'), 'a|b');
    assert.equal(unescape('a\\S\\b'), 'a^b');
    assert.equal(unescape('a\\T\\b'), 'a&b');
    assert.equal(unescape('a\\R\\b'), 'a~b');
    assert.equal(unescape('a\\E\\b'), 'a\\b');
    assert.equal(unescape('line\\.br\\next'), 'line\nnext');
    assert.equal(unescape('\\H\\bold\\N\\'), 'bold');
  });

  test('hex escapes', () => {
    assert.equal(unescape('a\\X0D\\b'), 'a\rb');
    assert.equal(unescape('a\\X0D0A\\b'), 'a\r\nb');
    assert.equal(unescape('\\XC5BC\\'), 'ż');
    assert.equal(unescape('\\XBF\\'), '¿');
  });

  test('unknown or unterminated sequences are left untouched', () => {
    assert.equal(unescape('a\\Zxx\\b'), 'a\\Zxx\\b');
    assert.equal(unescape('a\\b'), 'a\\b');
    assert.equal(unescape('a\\\\b'), 'a\\\\b');
    assert.equal(unescape(''), '');
    assert.equal(unescape(null), '');
  });

  test('custom delimiters', () => {
    const d = { field: '#', component: '*', repetition: ';', escape: '!', subcomponent: '%' };
    assert.equal(unescape('a!F!b!S!c!E!d', d), 'a#b*c!d');
    assert.equal(escape('a#b*c!d;e%f', d), 'a!F!b!S!c!E!d!R!e!T!f');
  });

  test('escape encodes delimiters and line breaks', () => {
    assert.equal(escape('a|b^c&d~e\\f'), 'a\\F\\b\\S\\c\\T\\d\\R\\e\\E\\f');
    assert.equal(escape('x\r\ny\nz\rw'), 'x\\.br\\y\\.br\\z\\.br\\w');
    assert.equal(unescape(escape('a|b^c&d~e\\f')), 'a|b^c&d~e\\f');
    assert.equal(escape(null), '');
    assert.equal(escape(12), '12');
  });
});

describe('summarize', () => {
  test('full summary from ADT', () => {
    const s = summarize(parseMessage(ADT_CR));
    assert.deepEqual(s, {
      messageType: 'ADT',
      triggerEvent: 'A01',
      messageStructure: 'ADT_A01',
      controlId: 'MSG00001',
      sendingApplication: 'SENDAPP',
      sendingFacility: 'SENDFAC',
      receivingApplication: 'RECVAPP',
      receivingFacility: 'RECVFAC',
      timestamp: '20240315101500',
      version: '2.5',
      processingId: 'P',
      characterSet: '8859/2',
      segmentNames: ['MSH', 'EVN', 'PID', 'PV1', 'OBX', 'OBX', 'NTE'],
      segmentCount: 7,
      description: 'Admit/visit notification'
    });
  });

  test('accepts raw text and handles ACK / unknown types', () => {
    const ack = summarize('MSH|^~\\&|A|B|C|D|20240101||ACK|1|P|2.3\rMSA|AA|X\r');
    assert.equal(ack.messageType, 'ACK');
    assert.equal(ack.triggerEvent, '');
    assert.equal(ack.description, 'General acknowledgment message');
    assert.equal(ack.version, '2.3');
    const unknown = summarize('MSH|^~\\&|A|B|C|D|20240101||XYZ^Q99|1|P^T|2.5.1^PL\r');
    assert.equal(unknown.description, '');
    assert.equal(unknown.processingId, 'P');
    assert.equal(unknown.version, '2.5.1');
  });

  test('message without MSH yields empty summary fields, no throw', () => {
    const s = summarize(parseMessage('PID|1||123\r'));
    assert.equal(s.messageType, '');
    assert.equal(s.controlId, '');
    assert.deepEqual(s.segmentNames, ['PID']);
    assert.equal(s.segmentCount, 1);
    assert.equal(s.description, '');
    assert.doesNotThrow(() => summarize(null));
    assert.equal(summarize(null).segmentCount, 0);
  });
});
