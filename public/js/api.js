// REST client: one thin wrapper per route of src/web/server.js (route table in docs/ARCHITEKTURA.md).
// Every function returns the parsed JSON body or throws ApiError with a readable Polish message.

export class ApiError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Build a query string from an object, skipping null / undefined / empty values. */
export function buildQuery(params) {
  if (!params) return '';
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      usp.set(key, value.join(','));
    } else {
      usp.set(key, String(value));
    }
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, body, { timeoutMs = 0 } = {}) {
  const init = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let controller = null;
  let timer = null;
  if (timeoutMs > 0 && typeof AbortController === 'function') {
    controller = new AbortController();
    init.signal = controller.signal;
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (timer) clearTimeout(timer);
    const reason = err && err.name === 'AbortError' ? 'przekroczono czas oczekiwania' : (err && err.message) || 'błąd sieci';
    throw new ApiError(`Brak odpowiedzi serwera (${reason})`, 0, null);
  }
  if (timer) clearTimeout(timer);
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    const msg = data && typeof data.error === 'string' && data.error ? data.error : `HTTP ${res.status} ${res.statusText || ''}`.trim();
    throw new ApiError(msg, res.status, data);
  }
  return data;
}

// ---- health / state / config ----------------------------------------------

export const health = () => request('GET', '/api/health');
export const state = () => request('GET', '/api/state');
export const config = () => request('GET', '/api/config');
export const updateUiConfig = (ui) => request('PUT', '/api/config/ui', ui);

// ---- listeners -------------------------------------------------------------

export const listeners = () => request('GET', '/api/listeners');
export const addListener = (cfg) => request('POST', '/api/listeners', cfg);
export const updateListener = (id, partial) => request('PUT', `/api/listeners/${encodeURIComponent(id)}`, partial);
export const deleteListener = (id) => request('DELETE', `/api/listeners/${encodeURIComponent(id)}`);
export const startListener = (id) => request('POST', `/api/listeners/${encodeURIComponent(id)}/start`);
export const stopListener = (id) => request('POST', `/api/listeners/${encodeURIComponent(id)}/stop`);

// ---- sender ----------------------------------------------------------------

/** POST /api/send; the server awaits all repeats, so no timeout is applied here. */
export const send = (req) => request('POST', '/api/send', req);

// ---- events ----------------------------------------------------------------

/** filters: { sinceId, limit, types (array or csv), endpointId, text, level } */
export const events = (filters = {}) => request('GET', `/api/events${buildQuery(filters)}`);
export const clearEvents = () => request('DELETE', '/api/events');
export const getEvent = (id) => request('GET', `/api/events/${encodeURIComponent(id)}`);

/** URL for a file download (Content-Disposition attachment on the server). */
export function exportUrl(format, filters = {}) {
  return `/api/events/export${buildQuery({ format, ...filters })}`;
}

// ---- parsing helpers -------------------------------------------------------

export const parse = (text, opts = {}) => request('POST', '/api/parse', { text, ...opts });
export const ackPreview = (body) => request('POST', '/api/ack/preview', body);
export const examples = () => request('GET', '/api/examples');

// ---- scenarios -------------------------------------------------------------

export const scenarios = () => request('GET', '/api/scenarios');
export const runScenario = (name, overrides) =>
  request('POST', `/api/scenarios/${encodeURIComponent(name)}/run`, overrides ? { overrides } : {});
export const scenarioRuns = () => request('GET', '/api/scenarios/runs');
export const scenarioRun = (runId) => request('GET', `/api/scenarios/runs/${encodeURIComponent(runId)}`);
