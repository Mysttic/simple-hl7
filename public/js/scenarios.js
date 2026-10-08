// Scenarios panel: list from the server, run button, run results with per-step status, duration,
// assertions table and links to the related events.

import { renderAssertions } from './inspector.js';
import { el, clear, badge, formatMs, formatDateTime, statusLabel, pluralPl, inputEl, formField } from './format.js';

const KIND_LABELS = { send: 'wysyłka', receive: 'odbiór', wait: 'pauza' };
const MAX_RUNS = 30;
const TARGET_KEY = 'hl7t.scenarioTarget';

function loadTarget() {
  try {
    const t = JSON.parse(localStorage.getItem(TARGET_KEY) || '{}');
    return t && typeof t === 'object' ? t : {};
  } catch {
    return {};
  }
}

/** Server identifier of a scenario: file name without extension (preferred), then file, then display name. */
function scenarioKey(info) {
  if (!info) return '';
  return String(info.id || (info.file ? String(info.file).replace(/.ya?ml$/i, '') : '') || info.name || '');
}

function statusClass(status) {
  switch (status) {
    case 'passed': return 'ok';
    case 'skipped': return 'dim';
    case 'running': return 'info';
    default: return 'bad';
  }
}

export function createScenariosPanel({ root, ctx }) {
  let available = [];
  let runs = [];
  const running = new Set();
  let lastAvailableKey = '';
  let lastRunsKey = '';
  let selectedRunId = null;

  const listEl = el('div', { class: 'scenario-list' });
  const runsEl = el('div', { class: 'scenario-runs' });
  const detailsEl = el('div', { class: 'scenario-details' });
  // Gateway address for send steps: empty = address from the scenario file (local listener by default).
  const savedTarget = loadTarget();
  const hostIn = inputEl({ value: savedTarget.host || '', placeholder: 'z pliku scenariusza', class: 'mono' });
  const portIn = inputEl({ type: 'number', min: '1', max: '65535', value: savedTarget.port || '', placeholder: 'z pliku', class: 'mono' });
  const saveTarget = () => {
    try {
      localStorage.setItem(TARGET_KEY, JSON.stringify({ host: hostIn.value.trim(), port: portIn.value.trim() }));
    } catch {
      // private mode: the fields still work for this page
    }
  };
  hostIn.addEventListener('change', saveTarget);
  portIn.addEventListener('change', saveTarget);
  const targetEl = el('div', { class: 'scenario-target' },
    el('div', { class: 'section-head' }, el('span', { class: 'section-title' }, 'Bramka (adres dla kroków wysyłki)')),
    el('div', { class: 'form-grid cols-2' }, formField('Host', hostIn), formField('Port', portIn)),
    el('div', { class: 'dim small' }, 'Puste = adres z pliku scenariusza (domyślnie własny listener testera, czyli autotest). Kroki odbioru zawsze czekają na listenerze testera.'));

  function targetOverrides() {
    const target = {};
    const host = hostIn.value.trim();
    const portText = portIn.value.trim();
    if (host) target.host = host;
    if (portText) {
      const port = Number(portText);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port bramki musi być liczbą od 1 do 65535');
      target.port = port;
    }
    return Object.keys(target).length ? { target } : null;
  }

  const refreshBtn = el('button', { class: 'btn btn-xs', type: 'button', title: 'Odśwież listę scenariuszy z katalogu scenarios/', onClick: () => refresh() }, 'Odśwież');
  root.append(
    targetEl,
    el('div', { class: 'section-head' }, el('span', { class: 'section-title' }, 'Dostępne scenariusze'), refreshBtn),
    listEl,
    el('div', { class: 'section-head' }, el('span', { class: 'section-title' }, 'Ostatnie uruchomienia')),
    runsEl,
    detailsEl,
  );

  // ---- list -------------------------------------------------------------------------

  function renderList() {
    clear(listEl);
    if (!available.length) {
      listEl.append(el('div', { class: 'panel-empty' }, 'Brak scenariuszy. Dodaj pliki YAML do katalogu scenarios/.'));
      return;
    }
    for (const info of available) {
      const isRunning = running.has(scenarioKey(info));
      const item = el('div', { class: `scenario-item ${info.error ? 'broken' : ''} ${isRunning ? 'running' : ''}`.trim() });
      item.append(el('div', { class: 'scenario-main' },
        el('div', { class: 'scenario-name' }, info.name || info.file),
        info.description ? el('div', { class: 'scenario-desc dim' }, info.description) : null,
        el('div', { class: 'scenario-meta mono dim small' },
          pluralPl(info.stepCount, 'krok', 'kroki', 'kroków'),
          info.file ? ` · ${info.file}` : ''),
        info.error ? el('div', { class: 'scenario-error' }, `Błąd YAML: ${info.error}`) : null,
      ));
      item.append(el('button', {
        class: 'btn btn-sm btn-primary',
        type: 'button',
        disabled: info.error || isRunning ? true : null,
        title: info.error ? 'Scenariusz ma błąd i nie może być uruchomiony' : 'Uruchom scenariusz (serwer czeka na zakończenie)',
        onClick: () => run(info),
      }, isRunning ? 'Trwa...' : 'Uruchom'));
      listEl.append(item);
    }
  }

  function setAvailable(list) {
    const arr = Array.isArray(list) ? list : [];
    const key = JSON.stringify(arr);
    if (key === lastAvailableKey) return;
    lastAvailableKey = key;
    available = arr;
    renderList();
  }

  async function refresh() {
    refreshBtn.disabled = true;
    try {
      const list = await ctx.api.scenarios();
      setAvailable(list);
      ctx.notify(`Scenariusze odświeżone (${Array.isArray(list) ? list.length : 0})`, 'info');
    } catch (err) {
      ctx.notify(`Nie udało się pobrać scenariuszy: ${err.message}`, 'error');
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // ---- runs -------------------------------------------------------------------------

  function renderRuns() {
    clear(runsEl);
    if (!runs.length) {
      runsEl.append(el('div', { class: 'panel-empty' }, 'Jeszcze nic nie uruchomiono.'));
      return;
    }
    const sorted = runs.slice().sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || ''))).slice(0, MAX_RUNS);
    for (const run of sorted) {
      const item = el('div', {
        class: `run-item ${run.runId === selectedRunId ? 'selected' : ''}`.trim(),
        title: 'Pokaż szczegóły uruchomienia',
        onClick: () => showRun(run),
      },
      badge(statusLabel(run.status), statusClass(run.status)),
      el('span', { class: 'run-name' }, run.name || run.file || run.runId),
      el('span', { class: 'mono dim small' }, run.startedAt ? formatDateTime(run.startedAt, ctx.settings.utc) : ''),
      el('span', { class: 'mono dim small' }, Number.isFinite(run.durationMs) ? formatMs(run.durationMs) : ''));
      runsEl.append(item);
    }
  }

  function setRuns(list) {
    const arr = Array.isArray(list) ? list : [];
    const key = JSON.stringify(arr.map((r) => [r.runId, r.status, r.finishedAt]));
    if (key === lastRunsKey) return;
    lastRunsKey = key;
    const byId = new Map(runs.map((r) => [r.runId, r]));
    for (const r of arr) {
      if (!r || !r.runId) continue;
      const existing = byId.get(r.runId);
      // State snapshots strip step results; keep the richer local copy of an unchanged run.
      if (existing && existing.status === r.status && existing.finishedAt === r.finishedAt) continue;
      byId.set(r.runId, r);
    }
    runs = [...byId.values()];
    renderRuns();
  }

  function addRun(run) {
    if (!run || !run.runId) return;
    const idx = runs.findIndex((r) => r.runId === run.runId);
    if (idx >= 0) runs[idx] = run;
    else runs.push(run);
    lastRunsKey = '';
    renderRuns();
  }

  async function run(info) {
    const key = scenarioKey(info);
    if (!key || running.has(key)) return;
    running.add(key);
    renderList();
    ctx.notify(`Uruchamiam scenariusz "${info.name || key}"...`, 'info');
    try {
      const result = await ctx.api.runScenario(key, targetOverrides());
      addRun(result);
      showRun(result);
      ctx.notify(`Scenariusz "${info.name}": ${statusLabel(result.status)} w ${formatMs(result.durationMs)}`, result.status === 'passed' ? 'info' : 'error');
    } catch (err) {
      ctx.notify(`Scenariusz "${info.name}": ${err.message}`, 'error');
    } finally {
      running.delete(key);
      renderList();
      ctx.refreshState();
    }
  }

  // ---- details -----------------------------------------------------------------------

  function stepLinks(step) {
    const links = [];
    const result = step && step.result;
    if (!result || typeof result !== 'object') return links;
    // send steps store the sendMany() output ({ results: SendResult[] }), older runs a single SendResult
    const ids = Array.isArray(result.eventIds)
      ? result.eventIds
      : Array.isArray(result.results) ? result.results.flatMap((r) => (r && Array.isArray(r.eventIds) ? r.eventIds : [])) : [];
    if (ids.length) {
      links.push(el('a', { href: '#', class: 'link', onClick: (e) => { e.preventDefault(); ctx.selectEventByTypes(ids, ['ack.in', 'ack.timeout', 'sender.error', 'msg.out']); } }, 'Pokaż ACK / wynik wysyłki'));
      links.push(el('a', { href: '#', class: 'link', onClick: (e) => { e.preventDefault(); ctx.selectEventByTypes(ids, ['msg.out']); } }, 'Pokaż msg.out'));
    }
    if (Number.isFinite(result.id) && result.type === 'msg.in') {
      links.push(el('a', { href: '#', class: 'link', onClick: (e) => { e.preventDefault(); ctx.selectEvent(result.id); } }, `Pokaż odebraną wiadomość #${result.id}`));
    }
    return links;
  }

  function renderStep(step) {
    const status = step.status || 'error';
    const det = el('details', { class: `step step-${statusClass(status)}`, open: status !== 'passed' && status !== 'skipped' ? true : null });
    det.append(el('summary', {},
      el('span', { class: 'mono dim' }, `${(step.index ?? 0) + 1}.`),
      ' ',
      el('span', { class: 'step-name' }, step.name || `krok ${(step.index ?? 0) + 1}`),
      ' ',
      badge(KIND_LABELS[step.kind] || step.kind || '?', 'dim'),
      ' ',
      badge(statusLabel(status), statusClass(status)),
      ' ',
      el('span', { class: 'mono dim small' }, Number.isFinite(step.durationMs) ? formatMs(step.durationMs) : '')));
    const body = el('div', { class: 'step-body' });
    if (step.error) body.append(el('div', { class: 'text-error' }, String(step.error)));
    body.append(renderAssertions(step.assertions));
    const links = stepLinks(step);
    if (links.length) body.append(el('div', { class: 'result-links' }, ...links));
    det.append(body);
    return det;
  }

  function showRun(run) {
    if (!run) return;
    selectedRunId = run.runId;
    renderRuns();
    clear(detailsEl);
    const steps = Array.isArray(run.steps) ? run.steps : [];
    const passed = steps.filter((s) => s.status === 'passed').length;
    detailsEl.append(el('div', { class: 'run-head' },
      badge(statusLabel(run.status), statusClass(run.status)),
      el('span', { class: 'run-title' }, run.name || run.runId),
      el('button', { class: 'btn btn-xs btn-ghost right', type: 'button', title: 'Zamknij szczegóły', onClick: () => { selectedRunId = null; clear(detailsEl); renderRuns(); } }, 'Zamknij')));
    detailsEl.append(el('div', { class: 'run-meta mono dim small' },
      run.startedAt ? `start ${formatDateTime(run.startedAt, ctx.settings.utc)}` : '',
      run.finishedAt ? ` · koniec ${formatDateTime(run.finishedAt, ctx.settings.utc)}` : '',
      Number.isFinite(run.durationMs) ? ` · ${formatMs(run.durationMs)}` : '',
      ` · kroki OK ${passed}/${steps.length}`,
      run.file ? ` · ${run.file}` : ''));
    detailsEl.append(el('div', { class: 'run-actions' },
      el('button', { class: 'btn btn-xs', type: 'button', title: 'Filtruj oś czasu do zdarzeń tego uruchomienia', onClick: () => ctx.setEndpointFilter(run.runId) }, 'Zdarzenia tego uruchomienia'),
      el('button', { class: 'btn btn-xs', type: 'button', title: 'Skopiuj wynik jako JSON', onClick: () => ctx.copy(JSON.stringify(run, null, 2), 'Wynik scenariusza') }, 'Kopiuj JSON')));
    if (run.error) detailsEl.append(el('div', { class: 'text-error' }, String(run.error)));
    const stepsEl = el('div', { class: 'steps' });
    for (const step of steps) stepsEl.append(renderStep(step));
    if (!steps.length) stepsEl.append(el('div', { class: 'dim' }, 'Brak kroków.'));
    detailsEl.append(stepsEl);
    detailsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  renderList();
  renderRuns();

  return {
    setAvailable,
    setRuns,
    addRun,
    showRun,
    refresh,
  };
}
