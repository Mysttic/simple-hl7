// Captures one screenshot per UI element (tile, form, dialog, inspector view) for the user manual
// into docs/instrukcja/img/ and checks that every manual page in docs/instrukcja shows its screenshots.
//
// The app runs from source with a throwaway config; all traffic goes to its own listener.
// Run: node scripts/manual-shots.mjs        (needs Edge or Chrome)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ROOT, sleep, startApp, openBrowser, example, run } from './lib/devtools.mjs';

const WORK = path.join(ROOT, 'build', 'manual-shots');
const DOCS = path.join(ROOT, 'docs', 'instrukcja');
const IMG = path.join(DOCS, 'img');
const APP_PORT = 8796;
const LISTENER_PORT = 2595;
const LAB_PORT = 2597;
const BUSY_PORT = 2598;

// Planned manual subpages: group, file slug, title, what the screenshot shows (identification only).
const PAGES = [
  { group: 'Ogólne', slug: '01-ekran-glowny', title: 'Ekran główny', shows: 'Cały ekran: panele po lewej, oś czasu na środku, inspektor po prawej.' },
  { group: 'Ogólne', slug: '02-gorny-pasek', title: 'Górny pasek', shows: 'Nazwa i wersja, stan połączenia, zegar serwera, licznik zdarzeń, przyciski.' },
  { group: 'Ogólne', slug: '03-menu-eksport', title: 'Menu Eksport', shows: 'Rozwinięte menu eksportu zdarzeń (CSV, NDJSON).' },
  { group: 'Ogólne', slug: '04-okno-ustawien', title: 'Okno Ustawienia', shows: 'Progi kolorowania czasów, zdarzenia bajtów, strefa czasu.' },
  { group: 'Ogólne', slug: '05-czyszczenie-zdarzen', title: 'Czyszczenie zdarzeń', shows: 'Okno potwierdzenia po kliknięciu Wyczyść.' },
  { group: 'Ogólne', slug: '06-brak-polaczenia', title: 'Brak połączenia z serwerem', shows: 'Czerwony pasek, gdy przeglądarka straciła połączenie z programem.' },
  { group: 'Ogólne', slug: '07-powiadomienia', title: 'Powiadomienia', shows: 'Komunikaty w prawym dolnym rogu ekranu: informacja (niebieski) i błąd (czerwony).' },
  { group: 'Serwer', slug: '10-kafelek-serwera', title: 'Kafelek serwera', shows: 'Karta działającego listenera: adres, ramka, kodowanie, ACK, liczniki, czasy, przyciski.' },
  { group: 'Serwer', slug: '11-stany-serwera', title: 'Stany kafelka serwera', shows: 'Listener zatrzymany oraz listener z błędem (port zajęty).' },
  { group: 'Serwer', slug: '12-formularz-serwera', title: 'Formularz serwera: dodawanie', shows: 'Okno „Dodaj” z wartościami domyślnymi, wszystkie sekcje.' },
  { group: 'Serwer', slug: '13-formularz-serwera-ack', title: 'Formularz serwera: własny ACK', shows: 'Okno edycji z trybem ACK custom i polem szablonu.' },
  { group: 'Serwer', slug: '14-usuwanie-serwera', title: 'Usuwanie serwera', shows: 'Okno potwierdzenia usunięcia listenera.' },
  { group: 'Klient', slug: '20-formularz-klienta', title: 'Formularz klienta', shows: 'Adres bramki, ramka, ramka ACK, kodowanie, timeouty, powtórzenia, przełączniki.' },
  { group: 'Klient', slug: '21-edytor-wiadomosci', title: 'Edytor wiadomości', shows: 'Wybór celu i przykładu, edytor z kolorowaniem, linia stanu, przyciski.' },
  { group: 'Klient', slug: '22-podglad-wiadomosci', title: 'Podgląd wiadomości', shows: 'Okno „Podgląd szablonu”: wiadomość po podstawieniu placeholderów.' },
  { group: 'Klient', slug: '23-wynik-wysylki', title: 'Wynik wysyłki', shows: 'Karta udanej wysyłki: MSA-1, MSA-2, ramka ACK, pasek czasów.' },
  { group: 'Klient', slug: '24-wynik-wysylki-blad', title: 'Wynik wysyłki: brak ACK', shows: 'Karta nieudanej wysyłki (zły sufiks, timeout ACK).' },
  { group: 'Klient', slug: '25-wynik-serii', title: 'Wynik serii wysyłek', shows: 'Podsumowanie powtórzeń: liczba, udane, czasy min, średni, max, p95.' },
  { group: 'Scenariusze', slug: '30-adres-bramki', title: 'Adres bramki dla scenariuszy', shows: 'Pola Host i Port nad listą scenariuszy.' },
  { group: 'Scenariusze', slug: '31-kafelek-scenariusza', title: 'Kafelek scenariusza', shows: 'Nazwa, opis, liczba kroków, plik, przycisk Uruchom.' },
  { group: 'Scenariusze', slug: '32-scenariusz-w-trakcie', title: 'Scenariusz w trakcie', shows: 'Kafelek scenariusza podczas wykonywania.' },
  { group: 'Scenariusze', slug: '33-ostatnie-uruchomienia', title: 'Ostatnie uruchomienia', shows: 'Lista przebiegów ze statusem, godziną i czasem trwania.' },
  { group: 'Scenariusze', slug: '34-wynik-scenariusza', title: 'Wynik scenariusza', shows: 'Szczegóły nieudanego przebiegu: kroki i tabela asercji.' },
  { group: 'Oś czasu', slug: '40-os-czasu', title: 'Oś czasu', shows: 'Tabela zdarzeń: kolumny, łańcuchy wiadomość i ACK, kolory typów i czasów.' },
  { group: 'Oś czasu', slug: '41-pasek-filtrow', title: 'Pasek filtrów', shows: 'Filtry typu, punktu, tekstu i poziomu z licznikiem.' },
  { group: 'Oś czasu', slug: '42-filtr-typow', title: 'Filtr typów zdarzeń', shows: 'Rozwinięta lista typów z licznikami i szybkimi grupami.' },
  { group: 'Oś czasu', slug: '43-wstrzymane-przewijanie', title: 'Wstrzymane przewijanie', shows: 'Przycisk „N nowych” po wstrzymaniu autoprzewijania.' },
  { group: 'Oś czasu', slug: '44-powiazane-zdarzenia', title: 'Podświetlanie powiązanych zdarzeń', shows: 'Wiersz pod kursorem i podświetlone zdarzenia z tego samego połączenia i control id.' },
  { group: 'Inspektor', slug: '50-wiadomosc-odebrana', title: 'Inspektor: wiadomość odebrana', shows: 'Nagłówek msg.in: dane z MSH, kodowanie, rozmiar, znaczki ramki, powiązany ACK, odbiór.' },
  { group: 'Inspektor', slug: '51-znaczki-ramki', title: 'Znaczki ramki', shows: 'Znaczki poprawnej ramki i ramki ze złym sufiksem.', images: ['51-znaczki-ramki-ok', '51-znaczki-ramki-blad'] },
  { group: 'Inspektor', slug: '52-zakladka-czytelny', title: 'Zakładka Czytelny', shows: 'Segmenty z kolorowaniem i legendą.' },
  { group: 'Inspektor', slug: '53-zakladka-drzewo', title: 'Zakładka Drzewo', shows: 'Segmenty, pola z nazwami, składowe (wynik ORU^R01).' },
  { group: 'Inspektor', slug: '54-zakladka-hex', title: 'Zakładka Hex', shows: 'Zrzut bajtów z zaznaczonym prefiksem, sufiksem i znakami sterującymi.' },
  { group: 'Inspektor', slug: '55-ack-wyslany', title: 'Inspektor: ACK wysłany przez serwer', shows: 'Nagłówek ack.out: tryb, opóźnienie, czas przetwarzania.' },
  { group: 'Inspektor', slug: '56-wiadomosc-wyslana', title: 'Inspektor: wiadomość wysłana', shows: 'Nagłówek msg.out wysłanej przez klienta.' },
  { group: 'Inspektor', slug: '57-ack-otrzymany', title: 'Inspektor: ACK otrzymany', shows: 'Nagłówek ack.in: walidacja ACK i rozkład czasów.' },
  { group: 'Inspektor', slug: '58-brak-ack', title: 'Inspektor: brak ACK', shows: 'Zdarzenie ack.timeout.' },
  { group: 'Inspektor', slug: '59-niekompletna-ramka', title: 'Inspektor: niekompletna ramka', shows: 'Zdarzenie frame.incomplete z analizą sufiksu.' },
  { group: 'Inspektor', slug: '60-zdarzenie-polaczenia', title: 'Inspektor: zdarzenie połączenia', shows: 'Zdarzenie conn.close: czas trwania, bajty, liczba wiadomości.' },
  { group: 'Inspektor', slug: '61-krok-scenariusza', title: 'Inspektor: krok scenariusza', shows: 'Zdarzenie scenario.step z tabelą asercji.' },
  { group: 'Inspektor', slug: '62-podglad-ack', title: 'Okno Podgląd ACK', shows: 'ACK, jaki serwer zbudowałby dla wybranej wiadomości i kodu.' },
];

const imagesOf = (p) => p.images || [p.slug];

function busyPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function traffic(api) {
  const target = { host: '127.0.0.1', port: LISTENER_PORT, ackTimeoutMs: 5000 };
  await api('PUT', '/api/listeners/default', { encoding: 'iso88592', ack: { mode: 'AA', delayMs: 40 } });
  await api('POST', '/api/scenarios/04_polskie_znaki_iso8859_2/run', { overrides: { target } });
  await api('POST', '/api/scenarios/03_hospitalizacja_a01_a08_a03/run', { overrides: { target } });
  await api('POST', '/api/scenarios/09_zly_sufiks/run', { overrides: { target: { ...target, ackTimeoutMs: 1500 } } });
  const loop = api('POST', '/api/scenarios/06_zlecenie_i_wynik/run', { overrides: { target } });
  await sleep(300);
  await api('POST', '/api/send', { ...target, message: example('oru_r01.hl7'), autoControlId: true });
  await loop;
  // 05 expects AE / AR, the listener answers AA: a failed run with assertions to show
  await api('POST', '/api/scenarios/05_bledna_wiadomosc/run', { overrides: { target } });
  // a stopped listener and one that cannot start because its port is taken
  await api('POST', '/api/listeners', { id: 'lab', name: 'Wyniki z laboratorium', host: '127.0.0.1', port: LAB_PORT, encoding: 'cp1250', autoStart: false });
  await api('POST', '/api/listeners', { id: 'zajety', name: 'Port zajęty', host: '127.0.0.1', port: BUSY_PORT });
}

/** Every planned page must exist in docs/instrukcja and show its screenshots; prints what is missing. */
function checkManual() {
  const problems = [];
  for (const p of PAGES) {
    const file = path.join(DOCS, `${p.slug}.md`);
    if (!fs.existsSync(file)) {
      problems.push(`missing page docs/instrukcja/${p.slug}.md`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const img of imagesOf(p)) {
      if (!text.includes(`img/${img}.png`)) problems.push(`docs/instrukcja/${p.slug}.md does not show img/${img}.png`);
    }
  }
  for (const line of problems) console.warn(`  warning: ${line}`);
}

run(async () => {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  fs.rmSync(IMG, { recursive: true, force: true });
  fs.mkdirSync(IMG, { recursive: true });
  const configFile = path.join(WORK, 'app.json');
  fs.writeFileSync(configFile, JSON.stringify({
    web: { host: '127.0.0.1', port: APP_PORT },
    events: { maxEvents: 5000, ndjsonPath: null },
    listeners: [{ id: 'default', name: 'Bramka ADT (test)', host: '127.0.0.1', port: LISTENER_PORT }],
  }, null, 2));

  console.log('starting the app and producing traffic');
  const blocker = await busyPort(BUSY_PORT);
  const app = await startApp(configFile, APP_PORT);
  const { api, base } = app;
  await traffic(api);

  const page = await openBrowser({ profile: path.join(WORK, 'browser-profile'), cdpPort: 9335, width: 1920, height: 1080 });
  const shot = (name, opts) => page.shot(path.join(IMG, `${name}.png`), opts);
  const select = async (id) => {
    await page.click(`#timeline tr.ev[data-id="${id}"]`);
    await page.until(`document.querySelector('.insp-header:not([hidden])')`, 'the inspector');
    await sleep(100);
  };
  const tab = async (name) => {
    await page.clickText('.insp-tabs', name);
    await sleep(100);
  };
  const closeModal = async () => {
    await page.click('.modal .modal-close');
    await page.until(`!document.querySelector('.modal')`, 'the dialog to close');
  };
  // The top bar is full width with an empty middle: for its screenshots the button group is moved
  // next to the status, and the reconnect banner gets the same width.
  const collapseTopbar = async (on) => {
    await page.eval(on
      ? `(() => {
          const s = document.createElement('style');
          s.id = 'shot-collapse';
          s.textContent = '#topbar { width: max-content; } #topbar .topbar-actions { margin-left: 40px; }';
          document.head.append(s);
          document.querySelector('#ws-banner').style.width = document.querySelector('#topbar').getBoundingClientRect().width + 'px';
        })()`
      : `(() => { document.querySelector('#shot-collapse')?.remove(); document.querySelector('#ws-banner').style.width = ''; })()`);
    await sleep(100);
  };

  console.log('capturing');
  await page.goto(`${base}/`);
  await page.eval(`localStorage.setItem('hl7t.sender.form.v1', ${JSON.stringify(JSON.stringify({
    host: '127.0.0.1', port: LISTENER_PORT, encoding: 'iso88592', autoControlId: true, message: example('adt_a01.hl7').replace('UNICODE UTF-8', '8859/2'),
  }))})`);
  await page.goto(`${base}/`);
  await page.until(`document.querySelectorAll('#timeline tr.ev').length > 20`, 'the timeline');
  await page.until(`document.querySelector('.listener-card[data-id="zajety"]')`, 'the listener cards');

  const events = (await api('GET', '/api/events?limit=5000')).events;
  const find = (pred, what) => {
    const e = events.find(pred);
    if (!e) throw new Error(`no event for ${what}`);
    return e;
  };
  const adt = find((e) => e.type === 'msg.in' && e.data?.summary?.triggerEvent === 'A01' && e.data?.encoding === 'iso88592', 'ADT^A01 msg.in');
  const adtAck = find((e) => e.type === 'ack.out' && e.connId === adt.connId, 'ack.out');
  const out = find((e) => e.type === 'msg.out' && e.data?.summary?.controlId === adt.data.summary.controlId, 'msg.out');
  const ackIn = find((e) => e.type === 'ack.in' && e.connId === out.connId, 'ack.in');
  const oru = find((e) => e.type === 'msg.in' && e.data?.summary?.messageType === 'ORU', 'ORU msg.in');
  const timeout = find((e) => e.type === 'ack.timeout', 'ack.timeout');
  const broken = find((e) => e.type === 'frame.incomplete', 'frame.incomplete');
  const closed = find((e) => e.type === 'conn.close' && e.connId === adt.connId, 'conn.close');
  const failedStep = find((e) => e.type === 'scenario.step' && e.data?.status === 'failed', 'failed scenario.step');

  // ---- general (normal window) ----
  await select(adt.id);
  await shot('01-ekran-glowny');

  // everything else: tall window so long panels fit, double pixel density for sharp crops
  await page.resize(1920, 2400, 2);
  await collapseTopbar(true);
  await shot('02-gorny-pasek', { selectors: ['#topbar'], pad: 0 });
  await collapseTopbar(false);
  await page.click('#btn-export');
  await shot('03-menu-eksport', { selectors: ['#btn-export', '#export-menu'], pad: 10 });
  await page.click('#btn-export');
  await page.click('#btn-settings');
  await shot('04-okno-ustawien', { selectors: ['.modal'], pad: 0 });
  await closeModal();
  await page.click('#btn-clear');
  await shot('05-czyszczenie-zdarzen', { selectors: ['.modal'], pad: 0 });
  await closeModal();

  // ---- server ----
  await shot('10-kafelek-serwera', { selectors: ['.listener-card[data-id="default"]'], pad: 6 });
  await shot('11-stany-serwera', { selectors: ['.listener-card[data-id="lab"]', '.listener-card[data-id="zajety"]'], pad: 6 });
  await page.click('#btn-add-listener');
  await shot('12-formularz-serwera', { selectors: ['.modal'], pad: 0 });
  await closeModal();
  await page.eval(`__h.button('.listener-card[data-id="default"]', 'Edytuj').click()`);
  await page.until(`document.querySelector('.modal')`, 'the edit dialog');
  await page.eval(`__h.set('.modal', 'Tryb', 'custom')`);
  await page.eval(`__h.set('.modal', 'Szablon ACK (tryb custom)', ${JSON.stringify('MSH|^~\\&|{{field:MSH-5}}|{{field:MSH-6}}|{{field:MSH-3}}|{{field:MSH-4}}|{{now}}||ACK|{{controlId}}|P|2.5\nMSA|AA|{{field:MSH-10}}')})`);
  await shot('13-formularz-serwera-ack', { selectors: ['.modal'], pad: 0 });
  await closeModal();
  await page.eval(`__h.button('.listener-card[data-id="lab"]', 'Usuń').click()`);
  await page.until(`document.querySelector('.modal')`, 'the delete dialog');
  await shot('14-usuwanie-serwera', { selectors: ['.modal'], pad: 0 });
  await closeModal();

  // ---- client ----
  await shot('20-formularz-klienta', { selectors: ['#panel-sender .panel-header', '#panel-sender .form-grid', '#panel-sender .check-row'], pad: 6 });
  await shot('21-edytor-wiadomosci', { selectors: ['#panel-sender .picker-row', '#panel-sender .sender-actions'], pad: 6 });
  await page.clickText('#panel-sender', 'Podgląd szablonu');
  await page.until(`document.querySelector('.modal')`, 'the preview dialog');
  await shot('22-podglad-wiadomosci', { selectors: ['.modal'], pad: 0 });
  await closeModal();
  const sendAndWait = async (selector) => {
    await page.clickText('#panel-sender .sender-actions', 'Wyślij');
    await page.until(`document.querySelector('#panel-sender .sender-result ${selector}')`, `the send result ${selector}`, 200);
    await sleep(200);
  };
  await sendAndWait('.result.ok');
  await shot('23-wynik-wysylki', { selectors: ['#panel-sender .sender-result'], pad: 6 });
  await page.eval(`__h.set('#panel-sender', 'Suffix (hex)', '0D0A'); __h.set('#panel-sender', 'Timeout ACK (ms)', '1500')`);
  await sendAndWait('.result.fail');
  await shot('24-wynik-wysylki-blad', { selectors: ['#panel-sender .sender-result'], pad: 6 });
  await page.eval(`__h.set('#panel-sender', 'Suffix (hex)', '1C0D'); __h.set('#panel-sender', 'Timeout ACK (ms)', '5000');
    __h.set('#panel-sender', 'Powtórzenia', '5'); __h.set('#panel-sender', 'Odstęp (ms)', '100'); __h.set('#panel-sender', 'Jedno połączenie (keepAlive)', true)`);
  await sendAndWait('.result.summary');
  await shot('25-wynik-serii', { selectors: ['#panel-sender .sender-result'], pad: 6 });
  await page.eval(`__h.set('#panel-sender', 'Powtórzenia', '1'); __h.set('#panel-sender', 'Jedno połączenie (keepAlive)', false)`);

  // ---- scenarios ----
  await shot('30-adres-bramki', { selectors: ['.scenario-target'], pad: 6 });
  await shot('31-kafelek-scenariusza', { selectors: ['.scenario-item'], pad: 6 });
  await page.eval(`(() => {
    const item = [...document.querySelectorAll('.scenario-item')].find((i) => i.textContent.includes('08 Czas odpowiedzi'));
    __h.button(item, 'Uruchom').click();
  })()`);
  await sleep(700);
  await shot('32-scenariusz-w-trakcie', { selectors: ['.scenario-item.running'], pad: 6 });
  await page.until(`!document.querySelector('.scenario-item.running')`, 'the scenario to finish', 200);
  await shot('33-ostatnie-uruchomienia', { selectors: ['.scenario-runs'], pad: 6 });
  await page.eval(`(() => { const it = [...document.querySelectorAll('.run-item')].find((i) => i.textContent.includes('05 Błędna')); it.click(); })()`);
  await sleep(200);
  await shot('34-wynik-scenariusza', { selectors: ['.scenario-details'], pad: 6 });

  // notifications: running 05 from the panel gives an info toast (start) and an error toast (failed)
  await page.eval(`(() => {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const item = [...document.querySelectorAll('.scenario-item')].find((i) => i.textContent.includes('05 Błędna'));
    __h.button(item, 'Uruchom').click();
  })()`);
  await page.until(`document.querySelector('.toast.toast-error')`, 'the error notification', 200);
  await sleep(300);
  await shot('07-powiadomienia', { selectors: ['.toasts'], pad: 8 });

  // ---- timeline ----
  await select(adt.id);
  await shot('40-os-czasu', {
    rect: `(() => {
      const row = document.querySelector('#timeline tr.ev[data-id="${out.id}"]');
      row.scrollIntoView({ block: 'center' });
      const c = document.querySelector('#center').getBoundingClientRect();
      const head = document.querySelector('#timeline thead').getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return { x: c.left, y: head.top, width: c.width, height: Math.max(560, r.bottom - head.top + 360) };
    })()`,
  });
  await page.click('#btn-filters');
  await page.until(`!document.querySelector('#filters').hidden`, 'the filter bar');
  await shot('41-pasek-filtrow', { selectors: ['#filters'], pad: 4 });
  await page.click('#filters .dd-toggle');
  await page.until(`!document.querySelector('#filters .dd-menu').hidden`, 'the type list');
  await shot('42-filtr-typow', { selectors: ['#filters .dd-toggle', '#filters .dd-menu'], pad: 8 });
  await page.click('#filters .dd-toggle');
  await page.click('#btn-filters');
  // scrolling up pauses autoscroll by itself; the button then means Resume, so click it only when running
  await page.eval(`(() => { const b = document.querySelector('#btn-pause'); if (!b.classList.contains('active')) b.click(); })()`);
  for (let i = 0; i < 3; i++) {
    await api('POST', '/api/send', { host: '127.0.0.1', port: LISTENER_PORT, message: example('adt_a08.hl7'), autoControlId: true });
  }
  await page.until(`!document.querySelector('.new-pill').hidden`, 'the new events button');
  await shot('43-wstrzymane-przewijanie', {
    rect: `(() => {
      const c = document.querySelector('#center').getBoundingClientRect();
      const p = document.querySelector('.new-pill').getBoundingClientRect();
      return { x: c.left, y: p.top - 140, width: c.width, height: p.height + 170 };
    })()`,
  });
  await page.click('.new-pill');
  // hover needs a still timeline: pause again, bring the row to the middle, then move the mouse onto it
  await page.click('#btn-pause');
  await page.eval(`document.querySelector('#timeline tr.ev[data-id="${adt.id}"]').scrollIntoView({ block: 'center' })`);
  await sleep(200);
  await page.hover(`#timeline tr.ev[data-id="${adt.id}"]`);
  await page.until(`document.querySelectorAll('#timeline tr.related').length > 1`, 'the related rows');
  await shot('44-powiazane-zdarzenia', {
    rect: `(() => {
      const c = document.querySelector('#center').getBoundingClientRect();
      const rows = [...document.querySelectorAll('#timeline tr.related, #timeline tr.ev[data-id="${adt.id}"]')].map((r) => r.getBoundingClientRect());
      const top = Math.min(...rows.map((r) => r.top)) - 100;
      const bottom = Math.max(...rows.map((r) => r.bottom)) + 100;
      return { x: c.left, y: top, width: c.width, height: bottom - top };
    })()`,
  });
  await page.click('#btn-pause');

  // ---- inspector ----
  await select(adt.id);
  await shot('50-wiadomosc-odebrana', { selectors: ['.insp-header'], pad: 0 });
  await shot('51-znaczki-ramki-ok', { selectors: ['.insp-header .insp-badges'], pad: 6 });
  await tab('Czytelny');
  await shot('52-zakladka-czytelny', { selectors: ['.insp-tabs', '.insp-content'], pad: 0 });
  await tab('Hex');
  await shot('54-zakladka-hex', { selectors: ['.insp-tabs', '.insp-content'], pad: 0 });
  await page.clickText('.insp-actions', 'Podgląd ACK');
  await page.until(`document.querySelector('.modal')`, 'the ACK preview');
  await sleep(300);
  await shot('62-podglad-ack', { selectors: ['.modal'], pad: 0 });
  await closeModal();
  await select(oru.id);
  await tab('Drzewo');
  await shot('53-zakladka-drzewo', { selectors: ['.insp-tabs', '.insp-content'], pad: 0 });
  await select(broken.id);
  await shot('51-znaczki-ramki-blad', { selectors: ['.insp-header .insp-badges'], pad: 6 });
  await shot('59-niekompletna-ramka', { selectors: ['.insp-header'], pad: 0 });
  await select(adtAck.id);
  await shot('55-ack-wyslany', { selectors: ['.insp-header'], pad: 0 });
  await select(out.id);
  await shot('56-wiadomosc-wyslana', { selectors: ['.insp-header'], pad: 0 });
  await select(ackIn.id);
  await shot('57-ack-otrzymany', { selectors: ['.insp-header'], pad: 0 });
  await select(timeout.id);
  await shot('58-brak-ack', { selectors: ['.insp-header'], pad: 0 });
  await select(closed.id);
  await shot('60-zdarzenie-polaczenia', { selectors: ['.insp-header'], pad: 0 });
  await select(failedStep.id);
  await shot('61-krok-scenariusza', { selectors: ['.insp-header'], pad: 0 });

  // ---- connection lost: stop the app, the page shows the banner ----
  app.process.kill();
  await page.until(`!document.querySelector('#ws-banner').hidden`, 'the reconnect banner', 200);
  await collapseTopbar(true);
  await shot('06-brak-polaczenia', { selectors: ['#topbar', '#ws-banner'], pad: 0 });
  blocker.close();

  checkManual();
  const missing = PAGES.flatMap(imagesOf).filter((n) => !fs.existsSync(path.join(IMG, `${n}.png`)));
  if (missing.length) throw new Error(`missing screenshots: ${missing.join(', ')}`);
  console.log(`done, ${PAGES.flatMap(imagesOf).length} screenshots`);
});
