// Shared helpers for the screenshot scripts: start the app, drive a headless Edge or Chrome over the
// DevTools protocol (Node's own WebSocket, no dependencies) and crop PNGs of page elements.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export { sleep };

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
];

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.waiting = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', () => rej(new Error(`cannot reach ${url}`)));
    });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  once(method) {
    return new Promise((res) => {
      const fn = (m) => {
        if (m.method === method) {
          this.listeners.delete(fn);
          res(m.params);
        }
      };
      this.listeners.add(fn);
    });
  }
}

// Helpers installed in the page after every load: find form fields by label, set values like a user.
const PAGE_HELPERS = `window.__h = {
  field(root, label) {
    const scope = typeof root === 'string' ? document.querySelector(root) : root;
    const f = [...scope.querySelectorAll('.form-field')].find((x) => (x.querySelector('label')?.textContent || '').trim() === label);
    if (!f) throw new Error('no field ' + label);
    return f.querySelector('input, select, textarea');
  },
  set(root, label, value) {
    const e = this.field(root, label);
    if (e.type === 'checkbox') e.checked = !!value; else e.value = String(value);
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
  },
  button(root, text) {
    const scope = typeof root === 'string' ? document.querySelector(root) : root;
    const b = [...scope.querySelectorAll('button, a')].find((x) => x.textContent.trim() === text);
    if (!b) throw new Error('no button ' + text);
    return b;
  },
  rect(selectors, pad) {
    const els = selectors.map((s) => document.querySelector(s));
    if (els.some((e) => !e)) throw new Error('missing element: ' + selectors[els.findIndex((e) => !e)]);
    els[0].scrollIntoView({ block: 'nearest' });
    // hidden elements (zero size) do not take part in the union
    const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
    if (!rs.length) throw new Error('all elements are hidden: ' + selectors.join(', '));
    const x = Math.min(...rs.map((r) => r.left)) - pad;
    const y = Math.min(...rs.map((r) => r.top)) - pad;
    const right = Math.max(...rs.map((r) => r.right)) + pad;
    const bottom = Math.max(...rs.map((r) => r.bottom)) + pad;
    return { x: Math.max(0, x), y: Math.max(0, y), width: right - Math.max(0, x), height: bottom - Math.max(0, y) };
  },
};`;

export class Page {
  constructor(cdp, sessionId, size) {
    this.cdp = cdp;
    this.sid = sessionId;
    this.size = size;
  }
  cmd(method, params) {
    return this.cdp.send(method, params, this.sid);
  }
  async goto(url) {
    const loaded = this.cdp.once('Page.loadEventFired');
    await this.cmd('Page.navigate', { url });
    await loaded;
    await this.eval(PAGE_HELPERS);
  }
  async eval(expression) {
    const r = await this.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result.value;
  }
  async until(expression, what, tries = 100) {
    for (let i = 0; i < tries; i++) {
      if (await this.eval(`!!(${expression})`)) return;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  }
  async click(selector) {
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('no element ' + ${JSON.stringify(selector)}); e.click(); })()`);
  }
  async clickText(container, text) {
    await this.eval(`__h.button(${JSON.stringify(container)}, ${JSON.stringify(text)}).click()`);
  }
  async key(key) {
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key });
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key });
  }
  async hover(selector) {
    const r = await this.eval(`__h.rect([${JSON.stringify(selector)}], 0)`);
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + Math.min(200, r.width / 2), y: r.y + r.height / 2 });
  }
  async resize(width, height, scale = 1) {
    this.size = { width, height, scale };
    await this.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    await sleep(150);
  }
  /**
   * Writes a PNG. No options: the whole window. `selectors`: crop to the union of these elements plus
   * `pad`, scrolled into view and limited to the window. `rect`: a page expression returning {x,y,width,height}.
   */
  async shot(file, { selectors = null, pad = 8, rect = null } = {}) {
    let clip;
    if (selectors || rect) {
      const r = rect ? await this.eval(rect) : await this.eval(`__h.rect(${JSON.stringify(selectors)}, ${pad})`);
      // keep the crop inside the window
      const x = Math.max(0, r.x);
      const y = Math.max(0, r.y);
      const width = Math.min(r.width - (x - r.x), this.size.width - x);
      const height = Math.min(r.height - (y - r.y), this.size.height - y);
      if (!(width > 0 && height > 0)) throw new Error(`empty crop for ${path.basename(file)}: ${JSON.stringify(r)}`);
      clip = { x, y, width, height, scale: 1 };
    }
    const { data } = await this.cmd('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  ${path.relative(ROOT, file)}`);
  }
}

const children = [];
let browserCdp = null;

export function start(cmd, args, name) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => process.env.VERBOSE && console.log(`[${name}] ${d}`));
  children.push(p);
  return p;
}

export async function waitForHttp(url, what) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json().catch(() => ({}));
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`${what} did not come up: ${url}`);
}

/** Starts the app from source with the given config file; returns { api, base, process }. */
export async function startApp(configFile, port) {
  const proc = start(process.execPath, ['src/index.js', '--config', configFile, '--no-browser'], 'app');
  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(`${base}/api/health`, 'the app');
  async function api(method, route, body) {
    const r = await fetch(`${base}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${route} answered ${r.status}: ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }
  return { api, base, process: proc };
}

/** Launches a headless browser with its own profile and returns a Page with the given size. */
export async function openBrowser({ profile, cdpPort, width, height, scale = 1 }) {
  const browser = BROWSERS.find((b) => fs.existsSync(b));
  if (!browser) throw new Error('no Edge or Chrome found, add its path to BROWSERS in scripts/lib/devtools.mjs');
  start(browser, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${width},${height}`, 'about:blank'], 'browser');
  const version = await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, 'the browser');
  const cdp = await CDP.open(version.webSocketDebuggerUrl);
  browserCdp = cdp;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId, { width, height, scale });
  await page.cmd('Page.enable');
  await page.cmd('Runtime.enable');
  await page.resize(width, height, scale);
  return page;
}

/** Closes the browser (Edge keeps helper processes alive when only the parent is killed) and children. */
export async function cleanup() {
  if (browserCdp) {
    await Promise.race([browserCdp.send('Browser.close').catch(() => {}), sleep(2000)]);
  }
  for (const p of children) {
    try { p.kill(); } catch { /* already gone */ }
  }
}

export function example(name) {
  return fs.readFileSync(path.join(ROOT, 'examples', name), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n');
}

/** Runs main() and always cleans up, with a non-zero exit code on failure. */
export function run(main) {
  main()
    .catch((err) => {
      console.error(err.stack || err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await cleanup();
      setTimeout(() => process.exit(), 500);
    });
}
