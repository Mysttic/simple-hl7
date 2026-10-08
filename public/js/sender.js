// Sender panel: full SendRequest form, live coloured mirror under the textarea, example picker,
// result cards with timings bar and repeat summary, localStorage persistence.

import { renderTemplate } from '/lib/templates.js';
import { renderHl7 } from './highlight.js';
import { renderTimingsBar } from './inspector.js';
import {
  el, clear, badge, kv, formatMs, formatBytes, latencyClass, parseHexInput, inputEl, selectEl, checkboxEl, formField,
  setFieldError, toInt, debounce, ENCODINGS, ENCODING_LABELS, ACK_CODE_LABELS, phaseLabel, hexOrNone, errorPl, messagePl,
} from './format.js';
import { parseAckHex } from './listeners.js';

const FORM_KEY = 'hl7t.sender.form.v1';
const MAX_PERSISTED_MESSAGE = 200000;

// On a first start the editor holds a message that can be sent as it is, to the tester's own listener.
const DEFAULT_MESSAGE = 'MSH|^~\\&|APP|FAC|GW|HOSP|{{now}}||ADT^A01^ADT_A01|{{controlId}}|P|2.5\nEVN|A01|{{now}}\nPID|1||12345^^^HIS^PI||Kowalski^Jan||19800101|M';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 2575,
  prefixHex: '0B',
  suffixHex: '1C0D',
  encoding: 'utf8',
  message: DEFAULT_MESSAGE,
  normalizeSegmentSeparator: true,
  autoControlId: false,
  renderTemplate: true,
  connectTimeoutMs: 5000,
  ackTimeoutMs: 5000,
  expectAck: true,
  ackPrefixHex: '',
  ackSuffixHex: '',
  repeat: 1,
  intervalMs: 0,
  keepAlive: false,
  logBytes: true,
};

function loadForm() {
  try {
    const raw = localStorage.getItem(FORM_KEY);
    if (!raw) return { form: { ...DEFAULTS }, stored: false };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { form: { ...DEFAULTS }, stored: false };
    return { form: { ...DEFAULTS, ...parsed }, stored: true };
  } catch (err) {
    return { form: { ...DEFAULTS }, stored: false };
  }
}

function msh(text) {
  const firstLine = String(text || '').split(/\r\n|\r|\n/).find((l) => l.length > 0) || '';
  if (!firstLine.startsWith('MSH') || firstLine.length < 4) return null;
  const sepChar = firstLine[3];
  const f = firstLine.split(sepChar);
  return { type: f[8] || '', controlId: f[9] || '', version: f[11] || '' };
}

export function createSenderPanel({ root, ctx }) {
  const loaded = loadForm();
  const form = loaded.form;
  let defaultsApplied = loaded.stored;
  let sending = false;
  let examplesList = [];
  let listenersList = [];

  // ---- form inputs -------------------------------------------------------------------

  const f = {
    host: inputEl({ value: form.host, class: 'mono', placeholder: '127.0.0.1' }),
    port: inputEl({ type: 'number', min: '1', max: '65535', value: String(form.port), class: 'mono' }),
    prefixHex: inputEl({ value: form.prefixHex ?? '', class: 'mono', placeholder: '0B' }),
    suffixHex: inputEl({ value: form.suffixHex ?? '', class: 'mono', placeholder: '1C0D' }),
    ackPrefixHex: inputEl({ value: form.ackPrefixHex ?? '', class: 'mono', placeholder: 'jak wysyłka' }),
    ackSuffixHex: inputEl({ value: form.ackSuffixHex ?? '', class: 'mono', placeholder: 'jak wysyłka' }),
    encoding: selectEl(ENCODINGS.map((e) => [e, ENCODING_LABELS[e] || e]), form.encoding || 'utf8'),
    ackTimeoutMs: inputEl({ type: 'number', min: '0', value: String(form.ackTimeoutMs), class: 'mono' }),
    connectTimeoutMs: inputEl({ type: 'number', min: '0', value: String(form.connectTimeoutMs), class: 'mono' }),
    repeat: inputEl({ type: 'number', min: '1', max: '100000', value: String(form.repeat), class: 'mono' }),
    intervalMs: inputEl({ type: 'number', min: '0', value: String(form.intervalMs), class: 'mono' }),
    keepAlive: checkboxEl(!!form.keepAlive),
    expectAck: checkboxEl(form.expectAck !== false),
    renderTemplate: checkboxEl(form.renderTemplate !== false),
    autoControlId: checkboxEl(!!form.autoControlId),
    normalizeSegmentSeparator: checkboxEl(form.normalizeSegmentSeparator !== false),
    logBytes: checkboxEl(form.logBytes !== false),
  };

  const targetSel = el('select', { class: 'target-select', title: 'Wypełnij host, port i ramkowanie na podstawie lokalnego nasłuchu' });
  const exampleSel = el('select', { class: 'example-select', title: 'Wstaw przykładową wiadomość' });
  const textarea = el('textarea', {
    class: 'editor-input mono',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    wrap: 'soft',
    placeholder: 'Wklej wiadomość HL7 albo wybierz przykład z listy powyżej',
    'aria-label': 'Treść wiadomości HL7',
  });
  textarea.value = form.message || '';
  const mirror = el('div', { class: 'editor-mirror', 'aria-hidden': 'true' });
  const editor = el('div', { class: 'editor' }, mirror, textarea);
  const statusLine = el('div', { class: 'editor-status mono dim' });
  const sendBtn = el('button', { class: 'btn btn-primary', type: 'button', title: 'Wyślij (Ctrl+Enter)' }, 'Wyślij');
  const previewBtn = el('button', { class: 'btn', type: 'button', title: 'Pokaż wiadomość po renderowaniu szablonu (bez wysyłania)' }, 'Podgląd szablonu');
  const clearBtn = el('button', { class: 'btn btn-ghost', type: 'button', title: 'Wyczyść treść wiadomości' }, 'Wyczyść');
  const resultEl = el('div', { class: 'sender-result' });

  root.append(
    el('div', { class: 'form-grid cols-2 compact' },
      formField('Host', f.host),
      formField('Port', f.port),
      formField('Prefix (hex)', f.prefixHex, '0B = VT. Puste = bez prefiksu.'),
      formField('Suffix (hex)', f.suffixHex, '1C0D = FS CR. Np. "0D0A" do testu złej ramki.'),
      formField('Prefix ACK (hex)', f.ackPrefixHex, 'Oczekiwany w ACK. Puste = jak wysyłka, "brak" = bez.'),
      formField('Suffix ACK (hex)', f.ackSuffixHex, 'Oczekiwany w ACK. Puste = jak wysyłka, "brak" = bez.'),
      formField('Kodowanie', f.encoding),
      formField('Timeout ACK (ms)', f.ackTimeoutMs),
      formField('Timeout połączenia (ms)', f.connectTimeoutMs),
      formField('Powtórzenia', f.repeat, 'Więcej niż 1 = test obciążeniowy z podsumowaniem.'),
      formField('Odstęp (ms)', f.intervalMs, 'Przerwa między powtórzeniami.'),
      formField('Jedno połączenie (keepAlive)', f.keepAlive, 'Wszystkie powtórzenia przez jedno TCP.'),
    ),
    el('div', { class: 'check-row' },
      formField('Oczekuj ACK', f.expectAck, null, { class: 'inline' }),
      formField('Szablony {{...}}', f.renderTemplate, null, { class: 'inline' }),
      formField('Auto MSH-10', f.autoControlId, null, { class: 'inline' }),
      formField('Normalizuj CR', f.normalizeSegmentSeparator, null, { class: 'inline' }),
      formField('Loguj bajty', f.logBytes, null, { class: 'inline' }),
    ),
    el('div', { class: 'picker-row' },
      el('label', { class: 'picker' }, el('span', { class: 'dim' }, 'Cel:'), targetSel),
      el('label', { class: 'picker' }, el('span', { class: 'dim' }, 'Przykład:'), exampleSel),
    ),
    editor,
    statusLine,
    el('div', { class: 'sender-actions' }, sendBtn, previewBtn, clearBtn, el('span', { class: 'dim small' }, 'Ctrl+Enter wysyła')),
    resultEl,
  );

  // ---- mirror / status -----------------------------------------------------------------

  let mirrorScheduled = false;
  function updateMirror() {
    if (mirrorScheduled) return;
    mirrorScheduled = true;
    requestAnimationFrame(() => {
      mirrorScheduled = false;
      clear(mirror);
      mirror.append(renderHl7(textarea.value, { mirror: true, maxChars: 400000 }));
      syncScroll();
      updateStatus();
    });
  }

  function syncScroll() {
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  }

  function updateStatus() {
    const text = textarea.value;
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
    const m = msh(text);
    const parts = [`${text.length} znaków`, `${lines.length} segm.`];
    if (m) {
      if (m.type) parts.push(`MSH-9 ${m.type}`);
      if (m.controlId) parts.push(`MSH-10 ${m.controlId}`);
      if (m.version) parts.push(`v${m.version}`);
    } else if (text.trim()) {
      parts.push('brak segmentu MSH na początku');
    }
    if (/\{\{[^}]+\}\}/.test(text)) parts.push(f.renderTemplate.checked ? 'szablon: tak' : 'szablon: wyłączony');
    clear(statusLine);
    statusLine.append(parts.join(' · '));
    statusLine.classList.toggle('warn', !!text.trim() && !m);
  }

  textarea.addEventListener('input', () => {
    updateMirror();
    saveFormDebounced();
  });
  textarea.addEventListener('scroll', syncScroll, { passive: true });
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });

  // ---- persistence ------------------------------------------------------------------

  function readFormValues() {
    return {
      host: f.host.value.trim(),
      port: toInt(f.port.value, 2575),
      prefixHex: f.prefixHex.value.trim(),
      suffixHex: f.suffixHex.value.trim(),
      ackPrefixHex: f.ackPrefixHex.value.trim(),
      ackSuffixHex: f.ackSuffixHex.value.trim(),
      encoding: f.encoding.value,
      ackTimeoutMs: toInt(f.ackTimeoutMs.value, 5000),
      connectTimeoutMs: toInt(f.connectTimeoutMs.value, 5000),
      repeat: toInt(f.repeat.value, 1),
      intervalMs: toInt(f.intervalMs.value, 0),
      keepAlive: f.keepAlive.checked,
      expectAck: f.expectAck.checked,
      renderTemplate: f.renderTemplate.checked,
      autoControlId: f.autoControlId.checked,
      normalizeSegmentSeparator: f.normalizeSegmentSeparator.checked,
      logBytes: f.logBytes.checked,
      message: textarea.value.length <= MAX_PERSISTED_MESSAGE ? textarea.value : '',
    };
  }

  function saveForm() {
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(readFormValues()));
      defaultsApplied = true;
    } catch (err) {
      // localStorage may be unavailable (private mode / quota); form still works without persistence
    }
  }
  const saveFormDebounced = debounce(saveForm, 300);

  for (const input of Object.values(f)) {
    input.addEventListener('change', () => {
      saveForm();
      updateStatus();
    });
  }

  function applyValues(values) {
    if (values.host !== undefined) f.host.value = values.host;
    if (values.port !== undefined) f.port.value = String(values.port);
    if (values.prefixHex !== undefined) f.prefixHex.value = values.prefixHex ?? '';
    if (values.suffixHex !== undefined) f.suffixHex.value = values.suffixHex ?? '';
    if (values.ackPrefixHex !== undefined) f.ackPrefixHex.value = values.ackPrefixHex ?? '';
    if (values.ackSuffixHex !== undefined) f.ackSuffixHex.value = values.ackSuffixHex ?? '';
    if (values.encoding !== undefined) f.encoding.value = values.encoding;
    if (values.ackTimeoutMs !== undefined) f.ackTimeoutMs.value = String(values.ackTimeoutMs);
    if (values.connectTimeoutMs !== undefined) f.connectTimeoutMs.value = String(values.connectTimeoutMs);
    if (values.repeat !== undefined) f.repeat.value = String(values.repeat);
    if (values.intervalMs !== undefined) f.intervalMs.value = String(values.intervalMs);
    if (values.keepAlive !== undefined) f.keepAlive.checked = !!values.keepAlive;
    if (values.expectAck !== undefined) f.expectAck.checked = !!values.expectAck;
    if (values.renderTemplate !== undefined) f.renderTemplate.checked = !!values.renderTemplate;
    if (values.autoControlId !== undefined) f.autoControlId.checked = !!values.autoControlId;
    if (values.normalizeSegmentSeparator !== undefined) f.normalizeSegmentSeparator.checked = !!values.normalizeSegmentSeparator;
    if (values.logBytes !== undefined) f.logBytes.checked = !!values.logBytes;
  }

  /** Server senderDefaults are applied only when nothing was persisted locally yet. */
  function setDefaults(senderDefaults) {
    if (defaultsApplied || !senderDefaults || typeof senderDefaults !== 'object') return;
    const values = { ...senderDefaults };
    delete values.message;
    if (values.ackPrefixHex === null) values.ackPrefixHex = '';
    if (values.ackSuffixHex === null) values.ackSuffixHex = '';
    applyValues(values);
    defaultsApplied = true;
  }

  // ---- target (local listeners) and examples ---------------------------------------------

  function setListeners(list) {
    const arr = Array.isArray(list) ? list : [];
    const key = JSON.stringify(arr.map((l) => [l.id, l.port, l.config && l.config.prefixHex, l.config && l.config.suffixHex, l.config && l.config.encoding, l.state]));
    if (key === setListeners.lastKey) return;
    setListeners.lastKey = key;
    listenersList = arr;
    clear(targetSel);
    targetSel.append(el('option', { value: '' }, 'wpisz ręcznie lub wybierz nasłuch...'));
    for (const l of arr) {
      targetSel.append(el('option', { value: l.id }, `${l.name || l.id} (127.0.0.1:${l.port}${l.state === 'listening' ? '' : ', zatrzymany'})`));
    }
  }
  setListeners.lastKey = null;

  targetSel.addEventListener('change', () => {
    const l = listenersList.find((x) => x.id === targetSel.value);
    if (!l) return;
    const cfg = l.config || {};
    applyValues({
      host: '127.0.0.1',
      port: l.port || cfg.port,
      prefixHex: cfg.prefixHex ?? '',
      suffixHex: cfg.suffixHex ?? '',
      encoding: cfg.encoding || 'utf8',
      ackPrefixHex: cfg.ack && cfg.ack.prefixHex !== null && cfg.ack.prefixHex !== undefined ? cfg.ack.prefixHex : '',
      ackSuffixHex: cfg.ack && cfg.ack.suffixHex !== null && cfg.ack.suffixHex !== undefined ? cfg.ack.suffixHex : '',
    });
    saveForm();
    targetSel.value = '';
    ctx.notify(`Wypełniono cel na podstawie nasłuchu ${l.id}`, 'info');
  });

  async function loadExamples() {
    clear(exampleSel);
    exampleSel.append(el('option', { value: '' }, 'wybierz przykład...'));
    try {
      const list = await ctx.api.examples();
      examplesList = Array.isArray(list) ? list : [];
      examplesList.forEach((ex, i) => {
        exampleSel.append(el('option', { value: String(i), title: ex.description || '' }, `${ex.name || ex.file}${ex.description ? `: ${ex.description}` : ''}`));
      });
      if (!examplesList.length) exampleSel.append(el('option', { value: '', disabled: true }, 'brak przykładów w examples/'));
    } catch (err) {
      exampleSel.append(el('option', { value: '', disabled: true }, `błąd: ${err.message}`));
    }
  }

  exampleSel.addEventListener('change', () => {
    const ex = examplesList[Number(exampleSel.value)];
    if (!ex) return;
    loadMessage(ex.text || '', { source: `przykład ${ex.name || ex.file}` });
    exampleSel.value = '';
  });

  function loadMessage(text, opts = {}) {
    const normalized = String(text ?? '').replace(/\r\n|\r/g, '\n');
    textarea.value = normalized;
    updateMirror();
    saveForm();
    editor.classList.remove('flash');
    void editor.offsetWidth;
    editor.classList.add('flash');
    if (opts.focus !== false) textarea.focus();
    if (opts.source) ctx.notify(`Załadowano: ${opts.source}`, 'info');
  }

  clearBtn.addEventListener('click', () => {
    textarea.value = '';
    updateMirror();
    saveForm();
    textarea.focus();
  });

  previewBtn.addEventListener('click', () => {
    const text = textarea.value;
    if (!text.trim()) {
      ctx.notify('Brak treści do podglądu.', 'warn');
      return;
    }
    let rendered = text;
    let error = null;
    if (f.renderTemplate.checked) {
      try {
        rendered = renderTemplate(text, { vars: {}, env: {} });
      } catch (err) {
        error = err && err.message ? err.message : String(err);
      }
    }
    const body = el('div', {},
      el('div', { class: 'dim small' }, f.renderTemplate.checked
        ? 'Podgląd lokalny: serwer wygeneruje własny {{controlId}} i {{now}} w momencie wysyłki, więc wartości będą się różnić.'
        : 'Renderowanie szablonów jest wyłączone, wiadomość zostanie wysłana dosłownie.'),
      error ? el('div', { class: 'text-error' }, `Błąd renderowania: ${error}`) : null,
      renderHl7(rendered));
    ctx.openModal({
      title: 'Podgląd wiadomości',
      body,
      wide: true,
      actions: [
        { label: 'Kopiuj', onClick: () => ctx.copy(rendered, 'Wiadomość') },
        { label: 'Zamknij', onClick: (close) => close(), primary: true },
      ],
    });
  });

  // ---- sending ----------------------------------------------------------------------------

  function readRequest() {
    let ok = true;
    for (const input of Object.values(f)) setFieldError(input, '');
    const values = readFormValues();
    if (!values.host) {
      setFieldError(f.host, 'Podaj host.');
      ok = false;
    }
    if (!Number.isFinite(values.port) || values.port < 1 || values.port > 65535) {
      setFieldError(f.port, 'Port 1 do 65535.');
      ok = false;
    }
    const pre = parseHexInput(values.prefixHex);
    if (!pre.ok) {
      setFieldError(f.prefixHex, pre.error);
      ok = false;
    }
    const suf = parseHexInput(values.suffixHex);
    if (!suf.ok) {
      setFieldError(f.suffixHex, suf.error);
      ok = false;
    }
    const ackPre = parseAckHex(values.ackPrefixHex);
    if (!ackPre.ok) {
      setFieldError(f.ackPrefixHex, ackPre.error);
      ok = false;
    }
    const ackSuf = parseAckHex(values.ackSuffixHex);
    if (!ackSuf.ok) {
      setFieldError(f.ackSuffixHex, ackSuf.error);
      ok = false;
    }
    if (values.repeat < 1) {
      setFieldError(f.repeat, 'Minimum 1.');
      ok = false;
    }
    if (values.intervalMs < 0) {
      setFieldError(f.intervalMs, 'Nie może być ujemny.');
      ok = false;
    }
    if (values.ackTimeoutMs < 0) {
      setFieldError(f.ackTimeoutMs, 'Nie może być ujemny.');
      ok = false;
    }
    if (values.connectTimeoutMs < 0) {
      setFieldError(f.connectTimeoutMs, 'Nie może być ujemny.');
      ok = false;
    }
    const message = textarea.value;
    if (!message.trim()) {
      ctx.notify('Treść wiadomości jest pusta.', 'warn');
      editor.classList.add('has-error');
      ok = false;
    } else {
      editor.classList.remove('has-error');
    }
    if (!ok) return null;
    return {
      host: values.host,
      port: values.port,
      prefixHex: pre.hex,
      suffixHex: suf.hex,
      encoding: values.encoding,
      message,
      normalizeSegmentSeparator: values.normalizeSegmentSeparator,
      autoControlId: values.autoControlId,
      renderTemplate: values.renderTemplate,
      connectTimeoutMs: values.connectTimeoutMs,
      ackTimeoutMs: values.ackTimeoutMs,
      expectAck: values.expectAck,
      ackPrefixHex: ackPre.hex,
      ackSuffixHex: ackSuf.hex,
      repeat: values.repeat,
      intervalMs: values.intervalMs,
      keepAlive: values.keepAlive,
      logBytes: values.logBytes,
    };
  }

  async function send() {
    if (sending) return;
    const req = readRequest();
    if (!req) return;
    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = req.repeat > 1 ? `Wysyłanie 0/${req.repeat}...` : 'Wysyłanie...';
    clear(resultEl);
    resultEl.append(el('div', { class: 'result pending' }, el('span', { class: 'spinner' }), ` Wysyłanie do ${req.host}:${req.port}${req.repeat > 1 ? ` (${req.repeat} razy)` : ''}...`));
    saveForm();
    try {
      const res = await ctx.api.send(req);
      renderResult(res, req);
      const summary = res && res.summary ? res.summary : null;
      if (summary && summary.failed > 0) ctx.notify(`Wysyłka: ${summary.ok}/${summary.count} OK, ${summary.failed} nieudanych`, 'warn');
    } catch (err) {
      clear(resultEl);
      resultEl.append(el('div', { class: 'result fail' }, el('div', { class: 'result-head' }, badge('BŁĄD', 'bad'), el('span', {}, ` ${err.message}`))));
      ctx.notify(`Wysyłka nieudana: ${err.message}`, 'error');
    } finally {
      sending = false;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Wyślij';
    }
  }

  sendBtn.addEventListener('click', send);

  function eventLink(label, eventIds, types, title) {
    const ids = Array.isArray(eventIds) ? eventIds : [];
    if (!ids.length) return null;
    return el('a', {
      href: '#',
      class: 'link',
      title,
      onClick: (e) => {
        e.preventDefault();
        ctx.selectEventByTypes(ids, types);
      },
    }, label);
  }

  function renderSingle(r, index, total) {
    const ok = !!r.ok;
    const card = el('div', { class: `result ${ok ? 'ok' : 'fail'}` });
    const ack = r.ack || null;
    const v = ack && ack.validation ? ack.validation : null;
    const t = r.timings || {};
    const head = el('div', { class: 'result-head' });
    head.append(badge(ok ? 'OK' : 'BŁĄD', ok ? 'ok' : 'bad'));
    if (total > 1) head.append(el('span', { class: 'dim mono' }, ` #${index + 1}/${total}`));
    if (r.error) head.append(el('span', { class: 'result-error' }, ` ${errorPl(r.error)}${r.errorPhase ? ` (faza: ${phaseLabel(r.errorPhase)})` : ''}`));
    else if (v) head.append(el('span', {}, ' ACK '), badge(v.msa1 || '?', v.accepted ? 'ok' : 'bad', ACK_CODE_LABELS[v.msa1] || ''), Number.isFinite(t.ackMs) ? el('span', { class: 'dim' }, ` po ${formatMs(t.ackMs)}`) : null);
    else head.append(el('span', { class: 'dim' }, ' wysłano bez oczekiwania na ACK'));
    card.append(head);

    const grid = el('div', { class: 'insp-grid' });
    grid.append(kv('Control ID (MSH-10)', r.controlId || '(brak)', { mono: true }));
    if (v) {
      grid.append(kv('MSA-1', [badge(v.msa1 || '?', v.accepted ? 'ok' : 'bad'), el('span', { class: 'dim' }, ` ${ACK_CODE_LABELS[v.msa1] || ''}`)]));
      grid.append(kv('MSA-2', [el('span', { class: 'mono' }, v.msa2 || '(brak)'), ' ', badge(v.controlIdMatches ? 'zgodny' : 'NIEZGODNY', v.controlIdMatches ? 'ok' : 'bad')]));
      if (v.msa3) grid.append(kv('MSA-3', v.msa3, { mono: true }));
      grid.append(kv('Ramkowanie ACK', [
        badge(v.framingOk ? 'OK' : 'BŁĄD', v.framingOk ? 'ok' : 'bad'),
        ack.framing && !v.framingOk ? el('span', { class: 'dim mono' }, ` prefix ${hexOrNone(ack.framing.prefixHexActual)} / suffix ${hexOrNone(ack.framing.suffixHexActual)}`) : null,
      ]));
    }
    grid.append(kv('Wysłano', `${formatBytes(r.sentHex ? r.sentHex.length / 2 : 0)} ramka`));
    card.append(grid);

    if (t && (Number.isFinite(t.connectMs) || Number.isFinite(t.ackMs) || Number.isFinite(t.totalMs))) {
      card.append(renderTimingsBar(t, ctx.settings));
    }
    if (v && Array.isArray(v.problems) && v.problems.length) {
      card.append(el('ul', { class: 'insp-problems' }, ...v.problems.map((p) => el('li', {}, messagePl(p)))));
    }
    const links = el('div', { class: 'result-links' });
    if (ack) {
      const ackLink = eventLink('Pokaż ack.in w osi czasu', r.eventIds, ['ack.in'], 'Zaznacz zdarzenie ACK na osi czasu');
      if (ackLink) links.append(ackLink);
    } else if (r.errorPhase === 'ack') {
      const timeoutLink = eventLink('Pokaż ack.timeout w osi czasu', r.eventIds, ['ack.timeout', 'ack.in'], 'Zaznacz zdarzenie timeoutu na osi czasu');
      if (timeoutLink) links.append(timeoutLink);
    }
    const outLink = eventLink('Pokaż msg.out', r.eventIds, ['msg.out'], 'Zaznacz wysłaną wiadomość na osi czasu');
    if (outLink) links.append(outLink);
    const errLink = !ok && r.errorPhase !== 'ack' ? eventLink('Pokaż błąd', r.eventIds, ['sender.error', 'conn.error', 'sender.connect'], 'Zaznacz zdarzenie błędu') : null;
    if (errLink) links.append(errLink);
    if (links.children.length) card.append(links);

    if (ack && typeof ack.text === 'string' && ack.text) {
      const det = el('details', { class: 'result-ack' }, el('summary', {}, 'Treść ACK'), renderHl7(ack.text));
      card.append(det);
    }
    return card;
  }

  function renderSummary(summary, results) {
    const s = summary || {};
    const grid = el('div', { class: 'stat-grid wide' });
    const statEl = (label, value, cls = '') => el('div', { class: `stat ${cls}`.trim() }, el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value mono' }, value));
    grid.append(statEl('Wysłano', String(s.count ?? results.length)));
    grid.append(statEl('OK', String(s.ok ?? results.filter((r) => r.ok).length), 'ok'));
    grid.append(statEl('Błędy', String(s.failed ?? results.filter((r) => !r.ok).length), (s.failed ?? 0) > 0 ? 'bad' : ''));
    grid.append(statEl('min ACK', Number.isFinite(s.minAckMs) ? formatMs(s.minAckMs) : 'brak', latencyClass(s.minAckMs, ctx.settings)));
    grid.append(statEl('śr. ACK', Number.isFinite(s.avgAckMs) ? formatMs(s.avgAckMs) : 'brak', latencyClass(s.avgAckMs, ctx.settings)));
    grid.append(statEl('max ACK', Number.isFinite(s.maxAckMs) ? formatMs(s.maxAckMs) : 'brak', latencyClass(s.maxAckMs, ctx.settings)));
    grid.append(statEl('p95 ACK', Number.isFinite(s.p95AckMs) ? formatMs(s.p95AckMs) : 'brak', latencyClass(s.p95AckMs, ctx.settings)));
    return el('div', { class: 'result summary' }, el('div', { class: 'result-head' }, badge((s.failed ?? 0) > 0 ? 'CZĘŚCIOWO' : 'OK', (s.failed ?? 0) > 0 ? 'warn' : 'ok'), el('span', {}, ` Podsumowanie ${s.count ?? results.length} wysyłek`)), grid);
  }

  function renderResult(res, req) {
    clear(resultEl);
    const results = res && Array.isArray(res.results) ? res.results : [];
    if (!results.length) {
      resultEl.append(el('div', { class: 'result fail' }, el('div', { class: 'result-head' }, badge('BŁĄD', 'bad'), ' Serwer nie zwrócił wyników.')));
      return;
    }
    if (results.length === 1) {
      resultEl.append(renderSingle(results[0], 0, 1));
      return;
    }
    resultEl.append(renderSummary(res.summary, results));
    const detail = el('div', { class: 'result-detail' });
    const table = el('table', { class: 'result-table' },
      el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Wynik'), el('th', {}, 'MSA-1'), el('th', {}, 'MSA-2'), el('th', {}, 'ACK ms'), el('th', {}, 'Błąd'))));
    const tbody = el('tbody');
    results.forEach((r, i) => {
      const v = r.ack && r.ack.validation ? r.ack.validation : null;
      const ackMs = r.timings ? r.timings.ackMs : null;
      const tr = el('tr', { class: r.ok ? 'ok' : 'bad', title: 'Kliknij, aby zobaczyć szczegóły' },
        el('td', { class: 'mono' }, String(i + 1)),
        el('td', {}, badge(r.ok ? 'OK' : 'BŁĄD', r.ok ? 'ok' : 'bad')),
        el('td', { class: 'mono' }, v ? v.msa1 || '?' : ''),
        el('td', {}, v ? badge(v.controlIdMatches ? 'zgodny' : 'niezgodny', v.controlIdMatches ? 'ok' : 'bad') : ''),
        el('td', {}, Number.isFinite(ackMs) ? badge(formatMs(ackMs), `lat ${latencyClass(ackMs, ctx.settings)}`) : ''),
        el('td', { class: 'result-error small' }, errorPl(r.error || '')));
      tr.addEventListener('click', () => {
        clear(detail);
        detail.append(renderSingle(r, i, results.length));
        tbody.querySelectorAll('tr').forEach((x) => x.classList.remove('selected'));
        tr.classList.add('selected');
      });
      tbody.append(tr);
    });
    table.append(tbody);
    resultEl.append(el('div', { class: 'result-table-wrap' }, table), detail);
    const firstFail = results.findIndex((r) => !r.ok);
    const showIdx = firstFail >= 0 ? firstFail : results.length - 1;
    detail.append(renderSingle(results[showIdx], showIdx, results.length));
    tbody.children[showIdx].classList.add('selected');
  }

  // ---- init ----------------------------------------------------------------------------------

  updateMirror();
  loadExamples();

  return {
    loadMessage,
    setDefaults,
    setListeners,
    reloadExamples: loadExamples,
    focus: () => textarea.focus(),
    isSending: () => sending,
  };
}
