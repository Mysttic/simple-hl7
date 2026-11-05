// Listener cards (live stats from state updates) and the add / edit modal with every config field.

import {
  el, clear, badge, formatMs, formatBytes, formatTime, hexOrNone, latencyClass, parseHexInput, inputEl, selectEl,
  checkboxEl, formField, setFieldError, toInt, ENCODINGS, ENCODING_LABELS,
} from './format.js';

const ACK_MODES = [
  ['AA', 'AA: Application Accept'],
  ['AE', 'AE: Application Error'],
  ['AR', 'AR: Application Reject'],
  ['none', 'none: nie wysyłaj ACK'],
  ['custom', 'custom: własny szablon'],
];

const STATE_LABELS = { stopped: 'zatrzymany', starting: 'uruchamianie', listening: 'nasłuchuje', error: 'błąd' };

const DEFAULTS = {
  id: '',
  name: '',
  host: '0.0.0.0',
  port: 2575,
  prefixHex: '0B',
  suffixHex: '1C0D',
  encoding: 'utf8',
  ack: { mode: 'AA', delayMs: 0, template: null, prefixHex: null, suffixHex: null, textMessage: '', errorCode: null },
  keepConnection: true,
  idleTimeoutMs: 0,
  frameTimeoutMs: 3000,
  maxMessageBytes: 10485760,
  autoStart: true,
  logBytes: true,
};

const ID_RE = /^[A-Za-z0-9_.-]+$/;

/** ACK framing input: '' -> null (same as inbound), 'brak' -> '' (no bytes), otherwise hex. */
export function parseAckHex(value) {
  const v = String(value ?? '').trim();
  if (v === '') return { ok: true, hex: null };
  if (/^(brak|none|-)$/i.test(v)) return { ok: true, hex: '' };
  return parseHexInput(v);
}

function ackModeClass(mode) {
  switch (mode) {
    case 'AA': return 'ok';
    case 'AE':
    case 'AR': return 'bad';
    case 'none': return 'warn';
    default: return 'info';
  }
}

export function createListenersPanel({ root, ctx }) {
  let statuses = [];
  const busy = new Set();
  const cards = new Map();
  const cardJson = new Map();

  function sep() {
    return el('span', { class: 'sep' }, '·');
  }

  function stat(label, value, cls = '', title = null, opts = {}) {
    return el('div', { class: `stat ${cls}`.trim(), title, 'data-view': opts.view || null },
      el('div', { class: 'stat-label' }, label),
      el('div', { class: 'stat-value mono' }, value));
  }

  function btn(label, onClick, title, disabled = false, cls = 'btn btn-sm') {
    return el('button', { class: cls, type: 'button', title, disabled: disabled ? true : null, onClick }, label);
  }

  function renderCard(st) {
    const cfg = st.config || {};
    const ack = cfg.ack || {};
    const stats = st.stats || {};
    const state = st.state || 'stopped';
    const isBusy = busy.has(st.id);
    const card = el('div', { class: `card listener-card state-${state}`, 'data-id': st.id });

    card.append(el('div', { class: 'card-head' },
      el('span', { class: `state-dot ${state}`, title: STATE_LABELS[state] || state }),
      el('span', { class: 'card-title', title: st.name || st.id }, st.name || st.id),
      el('span', { class: 'dim mono small' }, st.id),
      badge(STATE_LABELS[state] || state, `state-badge ${state}`),
    ));

    card.append(el('div', { class: 'card-line mono' },
      el('span', { title: 'Adres i port nasłuchu' }, `${st.host || cfg.host}:${st.port || cfg.port}`),
      el('span', { 'data-view': 'listeners.framing' }, sep(),
        el('span', { title: 'Oczekiwany prefix ramki (hex)' }, `prefix ${hexOrNone(cfg.prefixHex)}`), sep(),
        el('span', { title: 'Oczekiwany suffix ramki (hex)' }, `suffix ${hexOrNone(cfg.suffixHex)}`), sep(),
        el('span', { title: 'Kodowanie dekodowania payloadu' }, cfg.encoding || 'utf8')),
    ));

    card.append(el('div', { class: 'card-line', 'data-view': 'listeners.ack' },
      el('span', {}, 'ACK: '),
      badge(ack.mode || 'AA', ackModeClass(ack.mode), 'Tryb odpowiedzi ACK'),
      ack.delayMs > 0 ? el('span', { class: 'dim', title: 'Celowe opóźnienie ACK' }, ` +${formatMs(ack.delayMs)}`) : null,
      ack.prefixHex !== null && ack.prefixHex !== undefined || ack.suffixHex !== null && ack.suffixHex !== undefined
        ? el('span', { class: 'dim mono', title: 'Ramkowanie ACK inne niż wejściowe' }, ` [${hexOrNone(ack.prefixHex ?? cfg.prefixHex)} / ${hexOrNone(ack.suffixHex ?? cfg.suffixHex)}]`)
        : null,
      sep(),
      el('span', { title: 'Otwarte połączenia TCP' }, `połączeń: ${st.connections ?? 0}`), sep(),
      el('span', { class: 'dim' }, cfg.keepConnection === false ? 'zamyka po ACK' : 'utrzymuje połączenie'),
      cfg.idleTimeoutMs > 0 ? el('span', { class: 'dim' }, `, idle ${formatMs(cfg.idleTimeoutMs)}`) : null,
      cfg.logBytes === false ? [sep(), el('span', { class: 'dim' }, 'bez bytes.*')] : null,
    ));

    if (st.error) card.append(el('div', { class: 'card-error' }, String(st.error)));

    // the first two stay in every view, the rest are the detailed statistics
    const more = { view: 'listeners.stats' };
    const grid = el('div', { class: 'stat-grid' });
    grid.append(stat('Wiadomości', String(stats.messages ?? 0), '', 'Odebrane kompletne ramki'));
    grid.append(stat('ACK', String(stats.acksSent ?? 0), '', 'Wysłane ACK'));
    grid.append(stat('Błędy ramki', String(stats.framingErrors ?? 0), stats.framingErrors > 0 ? 'bad' : '', 'Ramki z niezgodnym prefiksem lub sufiksem', more));
    grid.append(stat('Śmieci', formatBytes(stats.garbageBytes ?? 0), stats.garbageBytes > 0 ? 'warn' : '', 'Bajty poza ramką', more));
    grid.append(stat('In / Out', `${formatBytes(stats.bytesIn ?? 0)} / ${formatBytes(stats.bytesOut ?? 0)}`, '', 'Bajty odebrane / wysłane', more));
    const avg = stats.avgProcessingMs;
    grid.append(stat('Przetw. śr.', Number.isFinite(avg) ? formatMs(avg) : 'brak', Number.isFinite(avg) ? latencyClass(avg, ctx.settings) : '', 'Średni czas od kompletnej ramki do wysłania ACK', more));
    const min = stats.minProcessingMs;
    const max = stats.maxProcessingMs;
    grid.append(stat('min / max', Number.isFinite(min) || Number.isFinite(max) ? `${Number.isFinite(min) ? formatMs(min) : '?'} / ${Number.isFinite(max) ? formatMs(max) : '?'}` : 'brak', Number.isFinite(max) ? latencyClass(max, ctx.settings) : '', 'Minimalny / maksymalny czas przetwarzania', more));
    grid.append(stat('Ostatnia', stats.lastMessageTs ? formatTime(stats.lastMessageTs, ctx.settings.utc) : 'brak', '', stats.lastMessageTs || 'Czas ostatniej wiadomości', more));
    card.append(grid);

    const actions = el('div', { class: 'card-actions' });
    if (state === 'listening' || state === 'starting') {
      actions.append(btn('Stop', () => doAction(st.id, 'stop'), 'Zatrzymaj nasłuch i zamknij połączenia', isBusy));
    } else {
      actions.append(btn('Start', () => doAction(st.id, 'start'), 'Uruchom nasłuch', isBusy, 'btn btn-sm btn-primary'));
    }
    actions.append(btn('Edytuj', () => openEditor(st), 'Edytuj konfigurację nasłuchu', isBusy));
    actions.append(btn('Usuń', () => remove(st), 'Usuń nasłuch (z potwierdzeniem)', isBusy, 'btn btn-sm btn-danger'));
    const eventsBtn = btn('Zdarzenia', () => ctx.setEndpointFilter(st.id), 'Pokaż na osi czasu tylko zdarzenia tego nasłuchu', false, 'btn btn-sm btn-ghost');
    // it opens the filter bar, so it goes away with it
    eventsBtn.dataset.view = 'top.filters';
    actions.append(eventsBtn);
    card.append(actions);
    return card;
  }

  function render(list) {
    if (Array.isArray(list)) statuses = list;
    const ids = new Set(statuses.map((s) => s.id));
    for (const [id, card] of cards) {
      if (!ids.has(id)) {
        card.remove();
        cards.delete(id);
        cardJson.delete(id);
      }
    }
    let emptyEl = root.querySelector('.panel-empty');
    if (!statuses.length) {
      if (!emptyEl) {
        emptyEl = el('div', { class: 'panel-empty' }, 'Brak nasłuchów. Dodaj pierwszy przyciskiem "+ Dodaj".');
        root.append(emptyEl);
      }
      return;
    }
    if (emptyEl) emptyEl.remove();
    let prev = null;
    for (const st of statuses) {
      const key = JSON.stringify([st, busy.has(st.id), ctx.settings.utc, ctx.settings.warnMs, ctx.settings.badMs]);
      let card = cards.get(st.id);
      if (!card || cardJson.get(st.id) !== key) {
        const fresh = renderCard(st);
        if (card) card.replaceWith(fresh);
        else if (prev) prev.after(fresh);
        else root.prepend(fresh);
        card = fresh;
        cards.set(st.id, card);
        cardJson.set(st.id, key);
      } else if (prev && prev.nextElementSibling !== card) {
        prev.after(card);
      }
      prev = card;
    }
  }

  function updateStatus(st) {
    if (!st || !st.id) return;
    const idx = statuses.findIndex((s) => s.id === st.id);
    if (idx >= 0) statuses[idx] = st;
    else statuses.push(st);
    render();
  }

  async function doAction(id, action) {
    busy.add(id);
    render();
    try {
      const st = action === 'start' ? await ctx.api.startListener(id) : await ctx.api.stopListener(id);
      updateStatus(st);
      ctx.notify(action === 'start' ? `Nasłuch ${id} uruchomiony na ${st.host}:${st.port}` : `Nasłuch ${id} zatrzymany`, 'info');
    } catch (err) {
      ctx.notify(`Nie udało się ${action === 'start' ? 'uruchomić' : 'zatrzymać'} nasłuchu ${id}: ${err.message}`, 'error');
    } finally {
      busy.delete(id);
      render();
      ctx.refreshState();
    }
  }

  async function remove(st) {
    const ok = await ctx.confirm({
      title: 'Usunąć nasłuch?',
      message: `Nasłuch "${st.name || st.id}" (${st.host}:${st.port}) zostanie zatrzymany i usunięty z konfiguracji.`,
      okLabel: 'Usuń',
      danger: true,
    });
    if (!ok) return;
    busy.add(st.id);
    render();
    try {
      await ctx.api.deleteListener(st.id);
      statuses = statuses.filter((s) => s.id !== st.id);
      busy.delete(st.id);
      render();
      ctx.notify(`Usunięto nasłuch ${st.id}`, 'info');
    } catch (err) {
      busy.delete(st.id);
      render();
      ctx.notify(`Nie udało się usunąć nasłuchu ${st.id}: ${err.message}`, 'error');
    } finally {
      ctx.refreshState();
    }
  }

  function suggestPort() {
    const ports = statuses.map((s) => Number(s.port)).filter((p) => Number.isFinite(p));
    return ports.length ? Math.max(...ports) + 1 : 2575;
  }

  function suggestId() {
    const ids = new Set(statuses.map((s) => s.id));
    let n = statuses.length + 1;
    while (ids.has(`listener${n}`)) n += 1;
    return `listener${n}`;
  }

  // ---- editor modal ------------------------------------------------------------------

  function openEditor(existing) {
    const base = existing ? existing.config || {} : {};
    const cfg = {
      ...DEFAULTS,
      ...base,
      id: existing ? existing.id : suggestId(),
      ack: { ...DEFAULTS.ack, ...(base.ack || {}) },
    };
    if (!existing) {
      cfg.port = suggestPort();
      cfg.name = '';
    }

    const f = {
      id: inputEl({ value: cfg.id, disabled: existing ? true : null, placeholder: 'np. his_in', class: 'mono' }),
      name: inputEl({ value: cfg.name || '', placeholder: 'np. Brama HIS (wejście)' }),
      host: inputEl({ value: cfg.host || '0.0.0.0', class: 'mono' }),
      port: inputEl({ type: 'number', min: '1', max: '65535', value: String(cfg.port), class: 'mono' }),
      prefixHex: inputEl({ value: cfg.prefixHex ?? '', placeholder: '0B', class: 'mono' }),
      suffixHex: inputEl({ value: cfg.suffixHex ?? '', placeholder: '1C0D', class: 'mono' }),
      encoding: selectEl(ENCODINGS.map((e) => [e, ENCODING_LABELS[e] || e]), cfg.encoding || 'utf8'),
      ackMode: selectEl(ACK_MODES, cfg.ack.mode || 'AA'),
      ackDelay: inputEl({ type: 'number', min: '0', value: String(cfg.ack.delayMs ?? 0), class: 'mono' }),
      ackText: inputEl({ value: cfg.ack.textMessage || '', placeholder: 'np. Message accepted' }),
      ackError: inputEl({ value: cfg.ack.errorCode ?? '', placeholder: 'np. 207', class: 'mono' }),
      ackPrefix: inputEl({ value: cfg.ack.prefixHex ?? '', placeholder: 'jak wejście', class: 'mono' }),
      ackSuffix: inputEl({ value: cfg.ack.suffixHex ?? '', placeholder: 'jak wejście', class: 'mono' }),
      ackTemplate: el('textarea', { rows: '4', spellcheck: 'false', class: 'mono', placeholder: 'MSH|^~\\&|{{field:MSH-5}}|{{field:MSH-6}}|{{field:MSH-3}}|{{field:MSH-4}}|{{now}}||ACK|{{controlId}}|P|2.5\rMSA|AA|{{field:MSH-10}}' }, cfg.ack.template || ''),
      keepConnection: checkboxEl(cfg.keepConnection !== false),
      idleTimeout: inputEl({ type: 'number', min: '0', value: String(cfg.idleTimeoutMs ?? 0), class: 'mono' }),
      frameTimeout: inputEl({ type: 'number', min: '0', value: String(cfg.frameTimeoutMs ?? 3000), class: 'mono' }),
      maxMessageBytes: inputEl({ type: 'number', min: '1', value: String(cfg.maxMessageBytes ?? 10485760), class: 'mono' }),
      autoStart: checkboxEl(cfg.autoStart !== false),
      logBytes: checkboxEl(cfg.logBytes !== false),
    };

    const templateField = formField('Szablon ACK (tryb custom)', f.ackTemplate,
      'Placeholdery: {{controlId}}, {{now}}, {{now:YYYYMMDDHHmmss}}, {{field:MSH-10}}, {{seq}}. Segmenty rozdziel CR (\\r) lub nową linią.');
    const errorField = formField('Kod błędu (ERR)', f.ackError, 'Tylko dla AE / AR: dodaje segment ERR z tym kodem.');

    function syncMode() {
      const mode = f.ackMode.value;
      templateField.hidden = mode !== 'custom';
      errorField.classList.toggle('dimmed', !(mode === 'AE' || mode === 'AR'));
    }
    f.ackMode.addEventListener('change', syncMode);
    syncMode();

    const body = el('div', { class: 'listener-form' },
      el('h3', { class: 'form-section' }, 'Podstawowe'),
      el('div', { class: 'form-grid cols-2' },
        formField('Identyfikator', f.id, existing ? 'Identyfikatora nie można zmienić.' : 'Litery, cyfry, kropka, myślnik, podkreślenie.'),
        formField('Nazwa', f.name, 'Wyświetlana na karcie i w zdarzeniach.'),
        formField('Host', f.host, '0.0.0.0 = wszystkie interfejsy, 127.0.0.1 = tylko lokalnie.'),
        formField('Port', f.port, 'TCP 1 do 65535. Standardowy port MLLP: 2575.'),
      ),
      el('h3', { class: 'form-section' }, 'Ramkowanie i kodowanie'),
      el('div', { class: 'form-grid cols-3' },
        formField('Prefix (hex)', f.prefixHex, '0B = VT (standard MLLP). Puste = brak prefiksu.'),
        formField('Suffix (hex)', f.suffixHex, '1C0D = FS CR (standard MLLP). Akceptowane: "1C 0D", "0x1C 0x0D".'),
        formField('Kodowanie', f.encoding, 'Dekodowanie payloadu. MSH-18 jest porównywane z tym ustawieniem.'),
      ),
      el('h3', { class: 'form-section' }, 'Odpowiedź ACK'),
      el('div', { class: 'form-grid cols-3' },
        formField('Tryb', f.ackMode, 'none = brak odpowiedzi (test timeoutu nadawcy).'),
        formField('Opóźnienie (ms)', f.ackDelay, 'Celowe opóźnienie przed wysłaniem ACK.'),
        formField('Tekst MSA-3', f.ackText, 'Opcjonalny komunikat w MSA-3.'),
        errorField,
        formField('Prefix ACK (hex)', f.ackPrefix, 'Puste = jak wejście. Wpisz "brak", aby wysłać bez prefiksu (test odporności bramki).'),
        formField('Suffix ACK (hex)', f.ackSuffix, 'Puste = jak wejście. Wpisz "brak", aby wysłać bez sufiksu.'),
      ),
      templateField,
      el('h3', { class: 'form-section' }, 'Zaawansowane'),
      el('div', { class: 'form-grid cols-2' },
        formField('Limit wiadomości (B)', f.maxMessageBytes, 'Ramka większa niż limit jest odrzucana (E_MAX_SIZE).'),
        formField('Timeout bezczynności (ms)', f.idleTimeout, '0 = wyłączony. Po upływie: niekompletna ramka jest raportowana, a gniazdo zamykane.'),
        formField('Timeout ramki (ms)', f.frameTimeout, 'Ramka bez sufiksu jest raportowana jako niekompletna po tylu ms ciszy, połączenie zostaje otwarte. Wykrywa zły sufiks bramki. 0 = wyłączony.'),
      ),
      el('div', { class: 'form-grid cols-2' },
        formField('Utrzymuj połączenie po ACK', f.keepConnection, 'Wyłączone = zamyka gniazdo po każdym ACK.'),
        formField('Uruchamiaj automatycznie', f.autoStart, 'Start przy uruchomieniu aplikacji i po dodaniu.'),
        formField('Loguj zdarzenia bytes.in / bytes.out', f.logBytes, 'Wyłącz przy dużym ruchu.'),
      ),
    );

    const modal = ctx.openModal({
      title: existing ? `Edycja nasłuchu ${existing.id}` : 'Nowy nasłuch MLLP',
      body,
      wide: true,
      actions: [
        { label: 'Anuluj', onClick: (close) => close() },
        { label: existing ? 'Zapisz' : 'Dodaj i uruchom', primary: true, onClick: (close) => submit(close) },
      ],
    });

    function validate() {
      let ok = true;
      const out = {};
      for (const input of Object.values(f)) setFieldError(input, '');

      const id = f.id.value.trim();
      if (!ID_RE.test(id)) {
        setFieldError(f.id, 'Wymagany identyfikator: litery, cyfry, ".", "_", "-".');
        ok = false;
      }
      out.id = id;
      out.name = f.name.value.trim() || id;
      out.host = f.host.value.trim() || '0.0.0.0';
      const port = toInt(f.port.value, NaN);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        setFieldError(f.port, 'Port musi być liczbą od 1 do 65535.');
        ok = false;
      }
      out.port = port;

      const pre = parseHexInput(f.prefixHex.value);
      if (!pre.ok) {
        setFieldError(f.prefixHex, pre.error);
        ok = false;
      }
      out.prefixHex = pre.hex || '';
      const suf = parseHexInput(f.suffixHex.value);
      if (!suf.ok) {
        setFieldError(f.suffixHex, suf.error);
        ok = false;
      }
      out.suffixHex = suf.hex || '';
      out.encoding = f.encoding.value;

      const mode = f.ackMode.value;
      const delay = toInt(f.ackDelay.value, 0);
      if (delay < 0) {
        setFieldError(f.ackDelay, 'Opóźnienie nie może być ujemne.');
        ok = false;
      }
      const ackPre = parseAckHex(f.ackPrefix.value);
      if (!ackPre.ok) {
        setFieldError(f.ackPrefix, ackPre.error);
        ok = false;
      }
      const ackSuf = parseAckHex(f.ackSuffix.value);
      if (!ackSuf.ok) {
        setFieldError(f.ackSuffix, ackSuf.error);
        ok = false;
      }
      const template = f.ackTemplate.value.trim();
      if (mode === 'custom' && !template) {
        setFieldError(f.ackTemplate, 'Tryb custom wymaga szablonu.');
        ok = false;
      }
      out.ack = {
        mode,
        delayMs: delay,
        template: template || null,
        prefixHex: ackPre.hex,
        suffixHex: ackSuf.hex,
        textMessage: f.ackText.value,
        errorCode: f.ackError.value.trim() || null,
      };

      const maxBytes = toInt(f.maxMessageBytes.value, 0);
      if (maxBytes < 1) {
        setFieldError(f.maxMessageBytes, 'Limit musi być dodatni.');
        ok = false;
      }
      out.maxMessageBytes = maxBytes;
      const idle = toInt(f.idleTimeout.value, 0);
      if (idle < 0) {
        setFieldError(f.idleTimeout, 'Timeout nie może być ujemny.');
        ok = false;
      }
      out.idleTimeoutMs = idle;
      const frameTimeout = toInt(f.frameTimeout.value, 0);
      if (frameTimeout < 0) {
        setFieldError(f.frameTimeout, 'Timeout nie może być ujemny.');
        ok = false;
      }
      out.frameTimeoutMs = frameTimeout;
      out.keepConnection = f.keepConnection.checked;
      out.autoStart = f.autoStart.checked;
      out.logBytes = f.logBytes.checked;
      return ok ? out : null;
    }

    async function submit(close) {
      const cfgOut = validate();
      if (!cfgOut) {
        modal.setError('Popraw zaznaczone pola.');
        return;
      }
      modal.setError('');
      modal.setBusy(true);
      try {
        let st;
        if (existing) {
          const partial = { ...cfgOut };
          delete partial.id;
          st = await ctx.api.updateListener(existing.id, partial);
          ctx.notify(`Zapisano nasłuch ${existing.id}`, 'info');
        } else {
          st = await ctx.api.addListener(cfgOut);
          ctx.notify(`Dodano nasłuch ${cfgOut.id}${st && st.state === 'listening' ? ` (nasłuchuje na ${st.host}:${st.port})` : ''}`, 'info');
        }
        if (st) updateStatus(st);
        close();
        ctx.refreshState();
      } catch (err) {
        modal.setError(err && err.message ? err.message : String(err));
      } finally {
        modal.setBusy(false);
      }
    }

    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
        e.preventDefault();
        submit(modal.close);
      }
    });
  }

  return {
    render,
    updateStatus,
    openNew: () => openEditor(null),
    getStatuses: () => statuses.slice(),
  };
}
