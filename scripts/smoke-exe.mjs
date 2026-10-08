// Smoke test of a built executable: copies it into an empty temporary folder, starts it, and checks
// that it reports the version from VERSION.md, serves the UI and the API, wrote the bundled scenarios
// next to itself, and passes one HL7 message over MLLP to its own listener and back.
//
// Usage: node scripts/smoke-exe.mjs dist/simple-hl7-<version>-<target>[.exe]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`smoke-exe: ${message}`);
  process.exitCode = 1;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.json();
}

async function main() {
  const source = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !fs.existsSync(source)) {
    fail('give the path of a built executable');
    return;
  }
  const version = fs.readFileSync(path.join(ROOT, 'VERSION.md'), 'utf8').split(/\r?\n/).find((l) => l.trim()).replace(/^[#\s]*v?/, '').trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-hl7-smoke-'));
  const exe = path.join(dir, path.basename(source));
  fs.copyFileSync(source, exe);
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);

  const reported = spawnSync(exe, ['--version'], { encoding: 'utf8' });
  if (reported.status !== 0 || reported.stdout.trim() !== version) {
    fail(`--version printed '${reported.stdout.trim()}' (exit ${reported.status}), VERSION.md holds ${version}`);
    return;
  }

  const webPort = await freePort();
  const mllpPort = await freePort();
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'app.json'), JSON.stringify({
    web: { host: '127.0.0.1', port: webPort },
    listeners: [{ id: 'default', host: '127.0.0.1', port: mllpPort }],
  }));

  const child = spawn(exe, ['--no-browser'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const base = `http://127.0.0.1:${webPort}`;
  try {
    let health = null;
    for (let i = 0; i < 60 && !health; i++) {
      try {
        health = await getJson(`${base}/api/health`);
      } catch {
        await sleep(500);
      }
    }
    if (!health) throw new Error('the program did not answer /api/health within 30 s');
    if (health.version !== version) throw new Error(`/api/health reports ${health.version}, expected ${version}`);

    const page = await (await fetch(`${base}/`)).text();
    if (!page.includes('<title>simple-hl7</title>')) throw new Error('the UI page is not served');
    const lib = await fetch(`${base}/lib/parser.js`);
    if (!lib.ok) throw new Error('/lib/parser.js is not served');

    const scenarios = await getJson(`${base}/api/scenarios`);
    if (!Array.isArray(scenarios) || scenarios.length === 0) throw new Error('no bundled scenarios were written next to the program');
    if (!fs.existsSync(path.join(dir, 'examples'))) throw new Error('examples/ was not written next to the program');

    const sent = await (await fetch(`${base}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '127.0.0.1',
        port: mllpPort,
        message: 'MSH|^~\\&|SMOKE|TEST|SIMPLE|HL7|{{now}}||ADT^A01^ADT_A01|{{controlId}}|P|2.5\rPID|1||1^^^T^PI||Test^Smoke\r',
      }),
    })).json();
    const result = sent && sent.results && sent.results[0];
    if (!result || !result.ok || !result.ack || !result.ack.validation.controlIdMatches) {
      throw new Error(`the MLLP round trip failed: ${JSON.stringify(result && (result.error || result.ack))}`);
    }
    console.log(`smoke-exe: ${path.basename(source)} ${version} OK (UI, API, ${scenarios.length} scenarios, MLLP round trip with ACK ${result.ack.validation.msa1} in ${result.timings.ackMs} ms)`);
  } catch (err) {
    fail(`${err.message}\n--- program output ---\n${output}`);
  } finally {
    child.kill();
    await sleep(500);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // the process may still hold the folder on Windows for a moment; the temp folder is cleaned by the OS
    }
  }
}

main().catch((err) => fail(err.stack || err.message));
