// Scenario runner tests: YAML parsing / validation and runs against a test listener.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, sleep } from './helpers.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { App } from '../src/app.js';
import { parseScenario, loadScenarios, runScenario, substituteVars } from '../src/scenarios/runner.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ADT_INLINE = [
  'MSH|^~\\&|HIS|SZPITAL|BRAMKA|LAB|{{now}}||ADT^A01^ADT_A01|{{controlId}}|P|2.5',
  'EVN|A01|{{now}}',
  'PID|1||{{vars.patientId}}^^^SZPITAL^PI||Zażółć^Gęślą^Jaźń||19850102|M',
  'PV1|1|I|ODDZ^SALA^LOZKO'
].join('\n');

let app;
let listenerPort;

before(async () => {
  listenerPort = await freePort();
  const config = structuredClone(DEFAULT_CONFIG);
  config.web = { host: '127.0.0.1', port: 0 };
  config.events.ndjsonPath = null;
  config.listeners = [{ ...structuredClone(DEFAULT_CONFIG.listeners[0]), id: 'default', host: '127.0.0.1', port: listenerPort }];
  app = new App(config, { configPath: null, rootDir });
  await app.start();
});

after(async () => {
  if (app) await app.stop();
});

function yamlRoundtrip(extraTarget = '') {
  return `
name: Test roundtrip
description: test
continueOnFailure: false
target:
  host: 127.0.0.1
  port: ${listenerPort}
  prefixHex: "0B"
  suffixHex: "1C0D"
  ackTimeoutMs: 5000
${extraTarget}
vars:
  patientId: "85010212345"
steps:
  - name: send ADT^A01 from file
    send:
      file: examples/adt_a01.hl7
      autoControlId: true
    expect:
      ack:
        msa1: [AA, CA]
        controlIdMatches: true
        maxAckMs: 5000
        timeout: false
      framing: { prefixOk: true, suffixOk: true }
      fields: { "MSA-1": "AA", "MSH-9.1": "ACK" }
  - name: pause
    wait: { ms: 10 }
`;
}

test('parseScenario validates the shape with readable errors', () => {
  assert.throws(() => parseScenario('name: x\n', { file: 'x.yaml' }), /steps/);
  assert.throws(() => parseScenario('steps:\n  - send: { message: "MSH|" }\n    receive: { listenerId: a }\n', { file: 'x.yaml' }), /exactly one of/);
  assert.throws(() => parseScenario('steps:\n  - send: { message: "MSH|" }\n    expect: { bogus: 1 }\n', { file: 'x.yaml' }), /unknown key 'bogus'/);
  assert.throws(() => parseScenario('steps:\n  - send: { file: a.hl7, message: "MSH|" }\n', { file: 'x.yaml' }), /exactly one of 'file' or 'message'/);
  assert.throws(() => parseScenario('steps:\n  - receive: { listenerId: default }\n    expect: { ack: { msa1: AA } }\n', { file: 'x.yaml' }), /only valid for send steps/);
  assert.throws(() => parseScenario('steps:\n  - send: { message: "MSH|" }\n    expect: { fields: { "not a path": 1 } }\n', { file: 'x.yaml' }), /invalid HL7 path/);
  assert.throws(() => parseScenario('steps:\n  - wait: { ms: -1 }\n', { file: 'x.yaml' }), /wait\.ms/);
  assert.throws(() => parseScenario('steps: [\n', { file: 'broken.yaml' }), /broken\.yaml: invalid YAML/);
  assert.throws(() => parseScenario('target: { port: 99999 }\nsteps:\n  - wait: 1\n', { file: 'x.yaml' }), /target\.port/);
});

test('parseScenario normalises defaults', () => {
  const scenario = parseScenario(yamlRoundtrip(), { file: 'scenarios/test.yaml' });
  assert.equal(scenario.name, 'Test roundtrip');
  assert.equal(scenario.file, 'scenarios/test.yaml');
  assert.equal(scenario.continueOnFailure, false);
  assert.equal(scenario.target.port, listenerPort);
  assert.deepEqual(scenario.vars, { patientId: '85010212345' });
  assert.equal(scenario.steps.length, 2);
  assert.equal(scenario.steps[0].kind, 'send');
  assert.deepEqual(scenario.steps[0].expect.ack.msa1, ['AA', 'CA']);
  assert.equal(scenario.steps[1].kind, 'wait');
  assert.equal(scenario.steps[1].wait.ms, 10);

  const receive = parseScenario('steps:\n  - receive: {}\n', { file: 'r.yaml' });
  assert.equal(receive.name, 'r');
  assert.equal(receive.steps[0].receive.listenerId, 'default');
  assert.equal(receive.steps[0].receive.timeoutMs, 10000);
  assert.deepEqual(receive.steps[0].receive.match, {});

  const single = parseScenario('steps:\n  - send: { message: "MSH|^~\\\\&|A" }\n    expect: { ack: { msa1: ae } }\n', { file: 's.yaml' });
  assert.deepEqual(single.steps[0].expect.ack.msa1, ['AE']);
});

test('substituteVars replaces only {{vars.*}} placeholders', () => {
  assert.equal(substituteVars('PID|{{vars.patientId}}|{{controlId}}|{{vars.missing}}', { patientId: '1' }), 'PID|1|{{controlId}}|{{vars.missing}}');
});

test('loadScenarios lists the bundled scenarios without errors', () => {
  const infos = loadScenarios(path.join(rootDir, 'scenarios'));
  const ids = infos.map((i) => i.id);
  for (const id of ['01_czy_bramka_odpowiada', '02_przyjecie_pacjenta_a01', '03_hospitalizacja_a01_a08_a03', '04_polskie_znaki_iso8859_2', '05_bledna_wiadomosc', '06_zlecenie_i_wynik', '07_odbior_z_bramki', '08_czas_odpowiedzi_20x', '09_zly_sufiks']) {
    assert.ok(ids.includes(id), `${id} expected`);
  }
  for (const info of infos) {
    assert.equal(info.error, undefined, `${info.file}: ${info.error}`);
    assert.equal(typeof info.name, 'string');
    assert.ok(info.stepCount >= 1);
  }
  assert.deepEqual(loadScenarios(path.join(rootDir, 'does-not-exist')), []);
});

test('runScenario: ADT roundtrip against the test listener passes', async () => {
  const scenario = parseScenario(yamlRoundtrip(), { file: 'scenarios/test.yaml' });
  const run = await runScenario(scenario, app);
  assert.equal(run.status, 'passed', JSON.stringify(run.steps.map((s) => ({ status: s.status, error: s.error, assertions: s.assertions }))));
  assert.equal(typeof run.runId, 'string');
  assert.equal(run.name, 'Test roundtrip');
  assert.match(run.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(run.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(run.durationMs >= 0);
  assert.equal(run.steps.length, 2);

  const send = run.steps[0];
  assert.equal(send.kind, 'send');
  assert.equal(send.status, 'passed');
  assert.ok(send.assertions.length >= 6);
  assert.ok(send.assertions.every((a) => a.ok), JSON.stringify(send.assertions));
  const names = send.assertions.map((a) => a.name);
  for (const name of ['send.ok', 'ack.msa1', 'ack.controlIdMatches', 'ack.maxAckMs', 'framing.prefixOk', 'framing.suffixOk', 'fields.MSA-1', 'fields.MSH-9.1']) {
    assert.ok(names.includes(name), `assertion ${name} expected in ${names.join(', ')}`);
  }
  assert.equal(send.result.summary.count, 1);
  assert.equal(send.result.results[0].ok, true);
  assert.ok(send.result.results[0].timings.ackMs >= 0);

  assert.equal(run.steps[1].kind, 'wait');
  assert.equal(run.steps[1].status, 'passed');
  assert.ok(run.steps[1].durationMs >= 5);

  const events = app.events.list({ endpointId: run.runId, limit: 100 });
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['scenario.start', 'scenario.step', 'scenario.step', 'scenario.end']);
  assert.equal(events[0].data.stepCount, 2);
  assert.equal(events[3].data.status, 'passed');
  assert.equal(events[3].data.passed, 2);
  assert.equal(events[3].data.failed, 0);
  assert.ok(events.every((e) => e.source === 'scenario'));
});

test('runScenario: inline message with vars and overrides', async () => {
  const scenario = parseScenario(`
name: inline
vars: { patientId: "000" }
steps:
  - name: inline send
    send:
      message: |
        ${ADT_INLINE.split('\n').join('\n        ')}
    expect:
      ack: { msa1: AA }
      fields: { "MSA-2": "{{vars.ignored}}" }
`, { file: 'inline.yaml' });
  const run = await runScenario(scenario, app, {
    overrides: { target: { host: '127.0.0.1', port: listenerPort, ackTimeoutMs: 5000 }, vars: { patientId: '12345678901' } }
  });
  const step = run.steps[0];
  const sent = step.result.results[0];
  assert.equal(sent.ok, true, sent.error ?? '');
  assert.match(sent.sentText, /PID\|1\|\|12345678901\^/);
  assert.doesNotMatch(sent.sentText, /\{\{controlId\}\}/);
  const msa1 = step.assertions.find((a) => a.name === 'ack.msa1');
  assert.equal(msa1.ok, true);
  const msa2 = step.assertions.find((a) => a.name === 'fields.MSA-2');
  assert.equal(msa2.ok, false);
  assert.equal(msa2.expected, '{{vars.ignored}}');
  assert.equal(msa2.actual, sent.controlId);
  assert.equal(run.status, 'failed');
});

test('runScenario: unknown override keys are rejected instead of silently ignored', async () => {
  const scenario = parseScenario(`
name: overrides shape
steps:
  - name: pause
    wait: { ms: 1 }
`, { file: 'overrides.yaml' });
  await assert.rejects(
    () => runScenario(scenario, app, { overrides: { host: '127.0.0.1', port: 1 } }),
    /overrides\.host is not supported.*overrides\.target/
  );
  await assert.rejects(
    () => runScenario(scenario, app, { overrides: { target: 'nope' } }),
    /overrides\.target must be a mapping/
  );
  const run = await runScenario(scenario, app, { overrides: { continueOnFailure: true, vars: { a: 1 } } });
  assert.equal(run.status, 'passed');
});

test('runScenario: failed step skips the rest unless continueOnFailure', async () => {
  const text = (cont) => `
name: fail
continueOnFailure: ${cont}
target: { host: 127.0.0.1, port: ${listenerPort}, ackTimeoutMs: 5000 }
steps:
  - send: { file: examples/adt_a08.hl7, autoControlId: true }
    expect: { ack: { msa1: AE } }
  - wait: 5
`;
  const stopRun = await runScenario(parseScenario(text(false), { file: 'f.yaml' }), app);
  assert.equal(stopRun.status, 'failed');
  assert.equal(stopRun.steps[0].status, 'failed');
  const msa1 = stopRun.steps[0].assertions.find((a) => a.name === 'ack.msa1');
  assert.equal(msa1.expected, 'AE');
  assert.equal(msa1.actual, 'AA');
  assert.equal(stopRun.steps[1].status, 'skipped');

  const contRun = await runScenario(parseScenario(text(true), { file: 'f.yaml' }), app);
  assert.equal(contRun.status, 'failed');
  assert.equal(contRun.steps[0].status, 'failed');
  assert.equal(contRun.steps[1].status, 'passed');
});

test('runScenario: wrong suffix is detected as ack.timeout', async () => {
  const scenario = parseScenario(`
name: wrong suffix
target: { host: 127.0.0.1, port: ${listenerPort}, prefixHex: "0B", suffixHex: "0D0A", ackTimeoutMs: 500 }
steps:
  - name: send with CRLF suffix
    send: { file: examples/adt_a01.hl7, autoControlId: true }
    expect: { ack: { timeout: true } }
`, { file: 'w.yaml' });
  const run = await runScenario(scenario, app);
  assert.equal(run.status, 'passed', JSON.stringify(run.steps[0].assertions));
  const timeout = run.steps[0].assertions.find((a) => a.name === 'ack.timeout');
  assert.equal(timeout.ok, true);
  assert.equal(run.steps[0].result.results[0].ok, false);
  assert.equal(run.steps[0].result.results[0].errorPhase, 'ack');
});

test('runScenario: receive step waits for an inbound message', async () => {
  const scenario = parseScenario(`
name: inbound
vars: { patientId: "85010212345" }
steps:
  - name: wait for ADT
    receive:
      listenerId: default
      timeoutMs: 5000
      match: { "MSH-9.1": "ADT" }
    expect:
      fields: { "PID-3.1": "{{vars.patientId}}", "MSH-9.2": "A01" }
      framing: { prefixOk: true, suffixOk: true, segmentSeparator: CR }
      maxReceiveMs: 5000
`, { file: 'in.yaml' });
  const runPromise = runScenario(scenario, app);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const sent = await app.send({ host: '127.0.0.1', port: listenerPort, message: ADT_INLINE.replace('{{vars.patientId}}', '85010212345'), autoControlId: true, ackTimeoutMs: 5000 });
  assert.equal(sent.results[0].ok, true, sent.results[0].error ?? '');
  const run = await runPromise;
  assert.equal(run.status, 'passed', JSON.stringify(run.steps[0].assertions));
  const step = run.steps[0];
  assert.equal(step.kind, 'receive');
  assert.equal(step.result.type, 'msg.in');
  assert.equal(step.result.data.summary.messageType, 'ADT');
  assert.ok(step.assertions.every((a) => a.ok));
});

test('runScenario: receive timeout fails the step, unknown listener is an error', async () => {
  const timeoutRun = await runScenario(parseScenario('steps:\n  - receive: { listenerId: default, timeoutMs: 100 }\n', { file: 't.yaml' }), app);
  assert.equal(timeoutRun.status, 'failed');
  assert.equal(timeoutRun.steps[0].status, 'failed');
  assert.equal(timeoutRun.steps[0].assertions[0].name, 'receive.message');
  assert.match(String(timeoutRun.steps[0].assertions[0].actual), /Timeout/);

  const errorRun = await runScenario(parseScenario('steps:\n  - receive: { listenerId: nope, timeoutMs: 100 }\n', { file: 'e.yaml' }), app);
  assert.equal(errorRun.status, 'error');
  assert.equal(errorRun.steps[0].status, 'error');
  assert.match(errorRun.steps[0].error, /not found/);
});

test('runScenario: send.file outside the project root is rejected', async () => {
  const run = await runScenario(parseScenario(`
target: { host: 127.0.0.1, port: ${listenerPort} }
steps:
  - send: { file: ../../outside.hl7 }
`, { file: 'o.yaml' }), app);
  assert.equal(run.status, 'error');
  assert.equal(run.steps[0].status, 'error');
  assert.match(run.steps[0].error, /inside the project root/);
  const end = app.events.list({ endpointId: run.runId, types: ['scenario.end'] })[0];
  assert.equal(end.level, 'error');
});

test('app.scenarios.run executes a bundled scenario by id and remembers runs', async () => {
  const run = await app.scenarios.run('02_przyjecie_pacjenta_a01', { target: { host: '127.0.0.1', port: listenerPort, ackTimeoutMs: 5000 } });
  assert.equal(run.status, 'passed', JSON.stringify(run.steps.map((s) => s.assertions)));
  assert.equal(app.scenarios.get(run.runId), run);
  assert.equal(app.scenarios.runs[0], run);
  const byTitle = await app.scenarios.run('02 Przyjęcie pacjenta (ADT^A01)', { target: { host: '127.0.0.1', port: listenerPort, ackTimeoutMs: 5000 } });
  assert.equal(byTitle.status, 'passed');
  await assert.rejects(app.scenarios.run('does_not_exist'), /not found/);
  await assert.rejects(app.scenarios.run('../etc/passwd'), /not found/);
});

test('bundled scenarios pass against a local listener that answers AA', async () => {
  const target = { host: '127.0.0.1', port: listenerPort, ackTimeoutMs: 5000 };
  for (const id of ['01_czy_bramka_odpowiada', '02_przyjecie_pacjenta_a01', '03_hospitalizacja_a01_a08_a03', '04_polskie_znaki_iso8859_2']) {
    const run = await app.scenarios.run(id, { target });
    assert.equal(run.status, 'passed', `${id}: ${JSON.stringify(run.steps.map((st) => st.assertions.filter((a) => !a.ok)))}`);
  }
  // 09 sends a broken suffix: the listener never completes the frame, so no ACK is the expected outcome
  const broken = await app.scenarios.run('09_zly_sufiks', { target: { host: '127.0.0.1', port: listenerPort, ackTimeoutMs: 800 } });
  assert.equal(broken.status, 'passed', JSON.stringify(broken.steps.map((st) => st.assertions)));
  // 05 expects AE / AR, a listener that accepts everything must make it fail
  const lax = await app.scenarios.run('05_bledna_wiadomosc', { target });
  assert.equal(lax.status, 'failed');
});

test('06 order and result: the ORU sent back to the listener completes the loop', async () => {
  const oru = [
    'MSH|^~\\&|LIS|LAB|HIS|SZPITAL|20260101120000||ORU^R01^ORU_R01|ORU0001|P|2.5',
    'PID|1||78030398765^^^SZPITAL^PI||Jaźń^Zażółć',
    'OBR|1|ZL-2026-004522^HIS|LAB-1^LIS|58410-2^Morfologia krwi^LN',
    'OBX|1|NM|718-7^Hemoglobina^LN||13.8|g/dL|12.0-16.0|N|||F'
  ].join('\r');
  const runPromise = app.scenarios.run('06_zlecenie_i_wynik', { target: { host: '127.0.0.1', port: listenerPort, ackTimeoutMs: 5000 } });
  // the "laboratory" answers right away, possibly before the receive step starts waiting
  await sleep(50);
  const sent = await app.send({ host: '127.0.0.1', port: listenerPort, message: oru, renderTemplate: false });
  assert.equal(sent.results[0].ok, true);
  const run = await runPromise;
  assert.equal(run.status, 'passed', JSON.stringify(run.steps.map((st) => st.assertions)));
  assert.equal(run.steps[1].result.data.summary.controlId, 'ORU0001');
});

test('app.scenarios.stop ends a waiting run at once and a series after the message in flight', async () => {
  assert.throws(() => app.scenarios.stop('07_odbior_z_bramki'), /not running/);
  const waiting = app.scenarios.run('07_odbior_z_bramki');
  await sleep(100);
  assert.equal(app.scenarios.list().find((s) => s.id === '07_odbior_z_bramki').running, true);
  assert.deepEqual(app.scenarios.stop('07_odbior_z_bramki'), { stopped: 1 });
  const run = await waiting;
  assert.equal(run.status, 'stopped');
  assert.equal(run.steps[0].status, 'stopped');
  assert.ok(run.durationMs < 1000, `stopped after ${run.durationMs} ms`);
  assert.equal(app.scenarios.list().find((s) => s.id === '07_odbior_z_bramki').running, false);
  const end = app.events.list({ endpointId: run.runId, types: ['scenario.end'] })[0];
  assert.equal(end.level, 'warn');

  // 08 sends 20 messages 200 ms apart; stopped by its display name after the first few
  const series = app.scenarios.run('08_czas_odpowiedzi_20x', { target: { host: '127.0.0.1', port: listenerPort, ackTimeoutMs: 5000 } });
  await sleep(500);
  app.scenarios.stop('08 Czas odpowiedzi przy 20 wiadomościach');
  const cut = await series;
  assert.equal(cut.status, 'stopped');
  const sent = cut.steps[0].result.results.length;
  assert.ok(sent >= 1 && sent < 20, `${sent} messages sent`);
});
