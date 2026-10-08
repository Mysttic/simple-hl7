import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, generateControlId, formatDate, nextSeq } from '../src/hl7/templates.js';
import { parseMessage } from '../src/hl7/parser.js';

describe('formatDate', () => {
  const d = new Date(2024, 2, 5, 7, 8, 9, 42); // 2024-03-05 07:08:09.042 local

  test('all tokens', () => {
    assert.equal(formatDate(d), '20240305070809');
    assert.equal(formatDate(d, 'YYYYMMDDHHmmssSSS'), '20240305070809042');
    assert.equal(formatDate(d, 'YYYY-MM-DD HH:mm:ss.SSS'), '2024-03-05 07:08:09.042');
    assert.equal(formatDate(d, 'YYYYMMDD'), '20240305');
    assert.equal(formatDate(d, 'DD/MM/YYYY'), '05/03/2024');
    assert.equal(formatDate(d, 'plain'), 'plain');
  });

  test('invalid date falls back to now', () => {
    const out = formatDate(new Date('nope'), 'YYYY');
    assert.equal(out, String(new Date().getFullYear()));
    assert.equal(formatDate(null, 'YYYY').length, 4);
  });

});

describe('generateControlId', () => {
  test('20 digits, increasing counter, unique', () => {
    const a = generateControlId();
    const b = generateControlId();
    assert.equal(a.length, 20);
    assert.equal(b.length, 20);
    assert.match(a, /^\d{20}$/);
    assert.notEqual(a, b);
    assert.equal(parseInt(b.slice(17), 10), (parseInt(a.slice(17), 10) + 1) % 1000);
    assert.equal(a.slice(0, 4), String(new Date().getFullYear()));
  });

  test('uses the given date for the timestamp part', () => {
    const id = generateControlId(new Date(2024, 0, 2, 3, 4, 5, 6));
    assert.equal(id.slice(0, 17), '20240102030405006');
  });

  test('counter wraps and never exceeds 3 digits', () => {
    const ids = new Set();
    for (let i = 0; i < 1100; i++) {
      const id = generateControlId(new Date(2024, 0, 1));
      assert.equal(id.length, 20);
      ids.add(id.slice(17));
    }
    assert.equal(ids.size, 1000);
  });
});

describe('renderTemplate: controlId, seq', () => {
  test('{{controlId}} is the same within one render and differs between renders', () => {
    const out = renderTemplate('MSH|{{controlId}}|{{controlId}}');
    const parts = out.split('|');
    assert.equal(parts[1], parts[2]);
    assert.match(parts[1], /^\d{20}$/);
    const out2 = renderTemplate('{{controlId}}');
    assert.notEqual(out2, parts[1]);
  });

  test('ctx.controlId overrides', () => {
    assert.equal(renderTemplate('x{{controlId}}y', { controlId: 'ABC' }), 'xABCy');
    assert.equal(renderTemplate('{{controlId}}', { controlId: 123 }), '123');
    assert.match(renderTemplate('{{controlId}}', { controlId: '' }), /^\d{20}$/);
  });

  test('{{seq}} increments per render, stable within a render', () => {
    const before = nextSeq();
    const first = renderTemplate('{{seq}}-{{seq}}');
    const [a, b] = first.split('-');
    assert.equal(a, b);
    assert.equal(parseInt(a, 10), before + 1);
    const second = renderTemplate('{{seq}}');
    assert.equal(parseInt(second, 10), before + 2);
    assert.equal(renderTemplate('no seq here'), 'no seq here');
    assert.equal(nextSeq(), before + 3);
  });
});

describe('renderTemplate: now', () => {
  test('{{now}} is 14 digits of local time', () => {
    const out = renderTemplate('{{now}}');
    assert.match(out, /^\d{14}$/);
    assert.equal(out.slice(0, 4), String(new Date().getFullYear()));
  });

  test('{{now:FORMAT}}', () => {
    const now = new Date();
    assert.equal(renderTemplate('{{now:YYYY}}'), String(now.getFullYear()));
    assert.match(renderTemplate('{{now:YYYYMMDDHHmmssSSS}}'), /^\d{17}$/);
    assert.match(renderTemplate('{{now:YYYY-MM-DD}}'), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('all {{now}} in one render share the same base instant', () => {
    const out = renderTemplate('{{now:YYYYMMDDHHmmssSSS}}|{{now:YYYYMMDDHHmmssSSS}}');
    const [a, b] = out.split('|');
    assert.equal(a, b);
  });

  test('ctx.now sets the base time', () => {
    const base = new Date(2024, 0, 31, 23, 0, 0, 0);
    assert.equal(renderTemplate('{{now}}', { now: base }), '20240131230000');
    assert.equal(renderTemplate('{{now:YYYYMMDD}}', { now: base }), '20240131');
  });

  test('malformed now placeholders are left untouched', () => {
    assert.equal(renderTemplate('{{nowish}}'), '{{nowish}}');
  });

  test('removed placeholders (offsets, uuid, random, env) are left untouched', () => {
    for (const p of ['{{now+5m}}', '{{uuid}}', '{{random:1-6}}', '{{random:5}}', '{{env.PATH}}']) {
      assert.equal(renderTemplate(p, { env: { PATH: '/bin' } }), p);
    }
  });
});

describe('renderTemplate: field, vars', () => {
  const msg = parseMessage('MSH|^~\\&|APP|FAC|R|RF|20240101||ADT^A01|CTRL9|P|2.5\rPID|1||123^^^HOSP~456||Kowalski^Jan\r');

  test('{{field:PATH}} reads from ctx.msg', () => {
    assert.equal(renderTemplate('{{field:PID-3.1}}', { msg }), '123');
    assert.equal(renderTemplate('{{field:PID-3(2).1}}', { msg }), '456');
    assert.equal(renderTemplate('{{field:MSH-10}}', { msg }), 'CTRL9');
    assert.equal(renderTemplate('{{field: PID-5.2 }}', { msg }), 'Jan');
    assert.equal(renderTemplate('{{field:ZZZ-1}}', { msg }), '');
    assert.equal(renderTemplate('MSA|AA|{{field:MSH-10}}', { msg }), 'MSA|AA|CTRL9');
  });

  test('{{field:...}} without ctx.msg is empty', () => {
    assert.equal(renderTemplate('[{{field:PID-3.1}}]'), '[]');
    assert.equal(renderTemplate('[{{field:PID-3.1}}]', { msg: 'not a message' }), '[]');
    assert.equal(renderTemplate('[{{field:PID-3.1}}]', { msg: { get() { throw new Error('boom'); } } }), '[]');
  });

  test('{{vars.name}} including nested and non-string values', () => {
    const vars = { patientId: '12345', nested: { deep: 'x' }, n: 7, b: true, o: { a: 1 } };
    assert.equal(renderTemplate('{{vars.patientId}}', { vars }), '12345');
    assert.equal(renderTemplate('{{vars.nested.deep}}', { vars }), 'x');
    assert.equal(renderTemplate('{{vars.n}}', { vars }), '7');
    assert.equal(renderTemplate('{{vars.b}}', { vars }), 'true');
    assert.equal(renderTemplate('{{vars.o}}', { vars }), '{"a":1}');
  });

  test('missing vars placeholders stay untouched', () => {
    assert.equal(renderTemplate('{{vars.missing}}', { vars: {} }), '{{vars.missing}}');
    assert.equal(renderTemplate('{{vars.x}}'), '{{vars.x}}');
    assert.equal(renderTemplate('{{vars.toString}}', { vars: {} }), '{{vars.toString}}');
  });

});

describe('renderTemplate: edge cases', () => {
  test('unknown placeholders are untouched, text without placeholders unchanged', () => {
    assert.equal(renderTemplate('{{unknown}} {{ also unknown }}'), '{{unknown}} {{ also unknown }}');
    assert.equal(renderTemplate('plain text'), 'plain text');
    assert.equal(renderTemplate('{{'), '{{');
    assert.equal(renderTemplate('}}'), '}}');
    assert.equal(renderTemplate('{{}}'), '{{}}');
  });

  test('whitespace inside braces is tolerated', () => {
    assert.equal(renderTemplate('{{ controlId }}', { controlId: 'A' }), 'A');
    assert.equal(renderTemplate('{{  vars.x  }}', { vars: { x: 'y' } }), 'y');
  });

  test('non-string input', () => {
    assert.equal(renderTemplate(null), '');
    assert.equal(renderTemplate(undefined), '');
    assert.equal(renderTemplate(42), '42');
    assert.equal(renderTemplate('{{controlId}}', null).length, 20);
  });

  test('full HL7 template renders every placeholder', () => {
    const tpl = 'MSH|^~\\&|APP|FAC|GW|GWF|{{now}}||ADT^A01|{{controlId}}|P|2.5\rPID|1||{{vars.pid}}||{{vars.last}}^{{vars.first}}||{{now:YYYYMMDD}}\r';
    const out = renderTemplate(tpl, { vars: { pid: '777', last: 'Nowak', first: 'Ewa' } });
    const m = parseMessage(out);
    assert.match(m.get('MSH-7'), /^\d{14}$/);
    assert.match(m.get('MSH-10'), /^\d{20}$/);
    assert.equal(m.get('PID-3'), '777');
    assert.equal(m.get('PID-5.1'), 'Nowak');
    assert.equal(m.get('PID-5.2'), 'Ewa');
    assert.match(m.get('PID-7'), /^\d{8}$/);
    assert.ok(!out.includes('{{'));
  });
});
