// Entry point: parse flags, load config, build the App, start the web server, handle signals.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { loadConfig, saveConfig, applyEnvOverrides } from './config.js';
import { App } from './app.js';
import { createWebServer } from './web/server.js';
import { APP_ROOT, IS_EXE, VERSION, extractDefaults } from './runtime.js';

const HELP = `simple-hl7 ${VERSION}

Usage: simple-hl7 [flags]

  --listen <host:port>  UI address (default from config: 0.0.0.0:8080).
                        A bare port (--listen 9090) keeps the configured host.
  --config <file>       configuration file (default: config/app.json next to the program)
  --no-browser          do not open the browser on start
  --version             print the version and exit
  --help                print this help and exit

Environment: HL7T_WEB_PORT (or PORT), HL7T_WEB_HOST, HL7T_CONFIG. Flags win over environment.
Data folder: ${APP_ROOT}`;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function logError(message) {
  console.error(`[${new Date().toISOString()}] ${message}`);
}

function fail(message) {
  logError(message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { listen: null, config: null, browser: true, help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const eq = raw.indexOf('=');
    const name = (eq > 0 ? raw.slice(0, eq) : raw).replace(/^--?/, '');
    const inline = eq > 0 ? raw.slice(eq + 1) : null;
    const value = () => {
      if (inline !== null) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) fail(`Flag --${name} needs a value (see --help)`);
      i += 1;
      return next;
    };
    switch (name) {
      case 'listen': out.listen = value(); break;
      case 'config': out.config = value(); break;
      case 'no-browser': out.browser = false; break;
      case 'version': case 'v': out.version = true; break;
      case 'help': case 'h': case '?': out.help = true; break;
      default: fail(`Unknown flag: ${raw} (see --help)`);
    }
  }
  return out;
}

/** '0.0.0.0:8080' -> { host, port }, '9090' -> { port }, '[::1]:8080' -> { host: '::1', port } */
function parseListen(text) {
  const m = /^(?:\[([^\]]+)\]|([^:]*)):(\d+)$/.exec(text) || /^()()(\d+)$/.exec(text);
  if (!m) fail(`Invalid --listen value: ${text} (expected host:port or port)`);
  const port = Number(m[3]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port in --listen: ${text}`);
  const host = m[1] || m[2] || null;
  return { host, port };
}

function displayUrls(host, port) {
  if (host !== '0.0.0.0' && host !== '::' && host !== '') return [`http://${host.includes(':') ? `[${host}]` : host}:${port}`];
  const urls = [`http://localhost:${port}`];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}`);
    }
  }
  return urls;
}

function openBrowser(url) {
  // Only when started from a console (double click or terminal), never as a service.
  if (!process.stdout.isTTY) return;
  let cmd;
  let args;
  if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no browser available: the URL is printed in the console anyway
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}
if (args.version) {
  console.log(VERSION);
  process.exit(0);
}

const configPath = path.resolve(APP_ROOT, args.config || process.env.HL7T_CONFIG || 'config/app.json');

// Exe: first start writes the bundled scenarios/ and examples/ next to the program.
try {
  for (const file of extractDefaults()) log(`Created ${path.relative(APP_ROOT, file)}`);
} catch (err) {
  logError(`Cannot write default scenarios / examples: ${err.message}`);
}

let config;
try {
  // Environment and flags are applied after the first-run save, so they never end up in the file.
  config = loadConfig(configPath, { rootDir: APP_ROOT, env: {} });
} catch (err) {
  fail(`Cannot load configuration: ${err.message}`);
}

if (!fs.existsSync(configPath)) {
  try {
    saveConfig(config, configPath);
    log(`Created default configuration at ${configPath}`);
  } catch (err) {
    logError(`Cannot create default configuration file: ${err.message}`);
  }
}

const web = { ...config.web };
try {
  applyEnvOverrides({ web }, process.env);
} catch (err) {
  fail(err.message);
}
if (args.listen) {
  const { host, port } = parseListen(args.listen);
  if (host) web.host = host;
  web.port = port;
}

const app = new App(config, { configPath, rootDir: APP_ROOT });
const server = createWebServer(app, { host: web.host, port: web.port });

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, shutting down`);
  const force = setTimeout(() => {
    logError('Shutdown timed out after 5 s, exiting');
    process.exit(1);
  }, 5000);
  force.unref();
  try {
    await server.stop();
  } catch (err) {
    logError(`Web server stop failed: ${err?.message ?? err}`);
  }
  try {
    await app.stop();
  } catch (err) {
    logError(`App stop failed: ${err?.message ?? err}`);
  }
  log('Stopped');
  process.exit(0);
}

process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });

function recordFatal(kind, reason) {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  logError(`${kind}: ${message}`);
  try {
    app.events.push({
      source: 'system', endpointId: 'system', connId: null, type: 'system.error', direction: null, level: 'error',
      summary: `${kind}: ${reason instanceof Error ? reason.message : String(reason)}`, latencyMs: null,
      data: { code: reason?.code ?? 'E_UNHANDLED', message: reason instanceof Error ? reason.message : String(reason), kind }
    });
  } catch { /* the console line above is the fallback */ }
}

// The tool is a monitoring server: log and keep running instead of exiting on unexpected errors.
process.on('unhandledRejection', (reason) => recordFatal('Unhandled promise rejection', reason));
process.on('uncaughtException', (err) => recordFatal('Uncaught exception', err));

// No top-level await: the executable bundle is CommonJS (Node SEA requirement).
async function main() {
  await app.start();
  let port;
  try {
    ({ port } = await server.start());
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      throw new Error(`UI port ${web.port} is already in use. Start with another port, e.g. --listen ${web.host}:${web.port + 1}`);
    }
    throw err;
  }
  log(`simple-hl7 ${VERSION}${IS_EXE ? '' : ' (from source)'}`);
  log(`Data folder: ${APP_ROOT}`);
  log(`Config: ${configPath}`);
  const urls = displayUrls(web.host, port);
  for (const url of urls) log(`UI: ${url}`);
  for (const status of app.listenerStatuses()) {
    const detail = status.state === 'listening'
      ? `listening on ${status.host}:${status.port}`
      : `${status.state}${status.error ? ` (${status.error})` : ''}`;
    log(`Listener '${status.id}': ${detail}`);
  }
  log('Press Ctrl+C to stop');
  if (args.browser) openBrowser(urls[0]);
}

main().catch(async (err) => {
  logError(`Startup failed: ${err?.message ?? err}`);
  try { await server.stop(); } catch { /* ignore */ }
  try { await app.stop(); } catch { /* ignore */ }
  process.exit(1);
});
