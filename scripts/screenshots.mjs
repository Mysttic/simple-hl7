// Captures the screenshots used by README.md into docs/img/ and copies six of them to the project
// page in site/simple-hl7/img/. The main screenshot shows the view a new user gets (Prosty), the
// second one the same moment in the full view; the detail shots are taken in the full view.
//
// Starts the app from source with a throwaway config, produces realistic traffic against its own
// listener (scenarios, a wrong suffix, a loop with a result coming back), drives a headless Edge or
// Chrome and writes PNGs. Element screenshots for the user manual: scripts/manual-shots.mjs.
//
// Run: node scripts/screenshots.mjs        (needs Edge or Chrome)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sleep, startApp, openBrowser, example, run } from './lib/devtools.mjs';

const WORK = path.join(ROOT, 'build', 'shots');
const OUT = path.join(ROOT, 'docs', 'img');
const APP_PORT = 8795;
const LISTENER_PORT = 2595;

async function traffic(api) {
  const target = { host: '127.0.0.1', port: LISTENER_PORT, ackTimeoutMs: 5000 };
  // the listener answers after 40 ms, so the timings look like a real gateway
  await api('PUT', '/api/listeners/default', { encoding: 'iso88592', ack: { mode: 'AA', delayMs: 40 } });
  await api('POST', '/api/scenarios/04_polskie_znaki_iso8859_2/run', { overrides: { target } });
  await api('POST', '/api/scenarios/03_hospitalizacja_a01_a08_a03/run', { overrides: { target } });
  await api('POST', '/api/scenarios/09_zly_sufiks/run', { overrides: { target: { ...target, ackTimeoutMs: 1500 } } });
  // 06: the "laboratory" sends the result back to the listener while the scenario waits
  const loop = api('POST', '/api/scenarios/06_zlecenie_i_wynik/run', { overrides: { target } });
  await sleep(300);
  await api('POST', '/api/send', { ...target, message: example('oru_r01.hl7'), autoControlId: true });
  await loop;
}

run(async () => {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  const configFile = path.join(WORK, 'app.json');
  fs.writeFileSync(configFile, JSON.stringify({
    web: { host: '127.0.0.1', port: APP_PORT },
    events: { maxEvents: 5000, ndjsonPath: null },
    listeners: [{ id: 'default', name: 'Bramka ADT (test)', host: '127.0.0.1', port: LISTENER_PORT }],
  }, null, 2));

  console.log('starting the app and producing traffic');
  const { api, base } = await startApp(configFile, APP_PORT);
  await traffic(api);

  const page = await openBrowser({ profile: path.join(WORK, 'browser-profile'), cdpPort: 9334, width: 1920, height: 1080 });
  const shot = (name, opts) => page.shot(path.join(OUT, name), opts);
  // the view switch in the top bar (public/js/view.js)
  const setView = (preset) => page.eval(`(() => {
    const s = document.getElementById('view-select');
    s.value = ${JSON.stringify(preset)};
    s.dispatchEvent(new Event('change'));
  })()`);

  console.log('capturing');
  // sender form prepared like an operator would fill it, gateway = the local listener; the view a new user gets.
  // Only visible fields differ from the defaults, so Prosty shows no hint about hidden values
  // (the example has {{controlId}} in MSH-10 anyway).
  await page.goto(`${base}/`);
  await page.eval(`localStorage.setItem('hl7t.sender.form.v1', ${JSON.stringify(JSON.stringify({
    host: '127.0.0.1', port: LISTENER_PORT, encoding: 'iso88592', message: example('adt_a01.hl7').replace('UNICODE UTF-8', '8859/2'),
  }))})`);
  await page.eval(`localStorage.setItem('hl7t.ui.settings.v1', ${JSON.stringify(JSON.stringify({ view: { preset: 'simple', custom: null } }))})`);
  await page.goto(`${base}/`);
  await page.until(`document.querySelectorAll('#timeline tr.ev').length > 20`, 'the timeline');

  const events = (await api('GET', '/api/events?types=msg.in,frame.incomplete&limit=500')).events;
  const adt = events.find((e) => e.type === 'msg.in' && e.data?.summary?.messageType === 'ADT' && e.data?.summary?.triggerEvent === 'A01');
  const broken = events.find((e) => e.type === 'frame.incomplete');
  const oru = events.find((e) => e.type === 'msg.in' && e.data?.summary?.messageType === 'ORU');

  // 1. main view in Prosty: timeline, ADT^A01 in the inspector with coloured segments
  await page.click(`#timeline tr.ev[data-id="${adt.id}"]`);
  await page.until(`document.querySelector('.insp-tabs button')`, 'the inspector');
  await shot('glowny.png');
  // the same moment in the full view (README, section on views); everything below needs it too
  await setView('full');
  await sleep(300);
  await shot('glowny-pelny.png');
  // 2. hex dump of the same frame with the prefix and suffix marked
  await page.clickText('.insp-tabs', 'Hex');
  await shot('inspektor-hex.png', { selectors: ['#inspector'], pad: 0 });
  // 3. tree view of the ORU result
  await page.click(`#timeline tr.ev[data-id="${oru.id}"]`);
  await page.clickText('.insp-tabs', 'Drzewo');
  await shot('inspektor-drzewo.png', { selectors: ['#inspector'], pad: 0 });
  // 4. wrong suffix detected by the listener
  await page.click(`#timeline tr.ev[data-id="${broken.id}"]`);
  await shot('zly-sufiks.png', { selectors: ['#inspector'], pad: 0 });
  // 5. client panel after a send
  await page.clickText('#panel-sender', 'Wyślij');
  await page.until(`document.querySelector('#panel-sender .sender-result .result:not(.pending)')`, 'the send result');
  await shot('klient.png', { selectors: ['#panel-sender'], pad: 0 });
  await shot('klient-wynik.png', { selectors: ['#panel-sender .sender-result'], pad: 6 });
  // 6. scenarios panel with the loop scenario opened
  await page.eval(`document.querySelector('#panel-listeners .panel-toggle').click(); document.querySelector('#panel-sender .panel-toggle').click();`);
  await page.until(`document.querySelector('.run-item')`, 'the scenario runs');
  await page.eval(`(() => { const items = [...document.querySelectorAll('.run-item')]; const it = items.find((i) => i.textContent.includes('06')) || items[0]; it.click(); })()`);
  await sleep(200);
  await page.eval(`document.querySelector('#left').scrollTop = 0`);
  await shot('scenariusze.png', { selectors: ['#panel-scenarios'], pad: 0 });
  await shot('scenariusz-wynik.png', { selectors: ['.scenario-details'], pad: 6 });

  // the project page on the site (site/simple-hl7) shows some of the same screenshots under English names
  const SITE_IMG = path.join(ROOT, 'site', 'simple-hl7', 'img');
  for (const [from, to] of [['glowny.png', 'promo.png'], ['inspektor-hex.png', 'hex.png'], ['zly-sufiks.png', 'framing.png'],
    ['scenariusze.png', 'scenarios.png'], ['klient-wynik.png', 'client.png'], ['inspektor-drzewo.png', 'tree.png']]) {
    fs.copyFileSync(path.join(OUT, from), path.join(SITE_IMG, to));
  }
  console.log('  site/simple-hl7/img (6 files)');
  console.log('done');
});
