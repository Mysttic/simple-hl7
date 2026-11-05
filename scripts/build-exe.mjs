// Builds a single executable (Node SEA): bundle the app with esbuild, embed the UI, default
// scenarios and examples as assets, inject everything into a copy of the Node binary.
//
//   node scripts/build-exe.mjs                       executable for this machine (uses this node binary)
//   node scripts/build-exe.mjs --node <path> --target linux-amd64
//                                                    executable for another system: <path> is the node
//                                                    binary of THAT system and EXACTLY this Node version
//
// Output: dist/simple-hl7-<version>-<target>[.exe] and dist/simple-hl7-<version>-checksums.txt.
// <target> is windows-amd64, linux-amd64 or linux-arm64: these names are the release contract of the
// project page on the hub (Mysttic/Mysttic, simple-hl7/index.html) and of docs/PRZEWODNIK.md, so they
// change only together with them.
// The version is read from VERSION.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build', 'exe'); // own subfolder: build/ also holds the screenshot scripts' browser profiles
const DIST = path.join(ROOT, 'dist');
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
// browser-safe HL7 modules served to the UI under /lib/ (encoding.js is node only)
const LIB_FILES = ['parser.js', 'tokenize.js', 'dictionary.js', 'templates.js', 'ack.js'];

function die(message) {
  console.error(`build-exe: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { node: null, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--node') out.node = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else die(`unknown argument ${a}`);
  }
  if (out.node && !out.target) die('--node needs --target, e.g. --target linux-amd64');
  return out;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function toKey(...parts) {
  return parts.join('/').split(path.sep).join('/');
}

const args = parseArgs(process.argv.slice(2));
const versionLine = fs.readFileSync(path.join(ROOT, 'VERSION.md'), 'utf8').split(/\r?\n/).find((l) => l.trim() !== '') || '';
const version = versionLine.replace(/^[#\s]*/, '').replace(/^v/, '').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`VERSION.md must hold major.minor.patch, got '${version}'`);
const ARCH = { x64: 'amd64', arm64: 'arm64' };
const OS = { win32: 'windows', linux: 'linux', darwin: 'darwin' };
const target = args.target || `${OS[process.platform] || process.platform}-${ARCH[process.arch] || process.arch}`;
const isWindowsTarget = target.startsWith('win');
const nodeBinary = path.resolve(args.node || process.execPath);
if (!fs.existsSync(nodeBinary)) die(`node binary not found: ${nodeBinary}`);
if (target.startsWith('darwin')) die('macOS needs code signing after injection and is not supported by this script');

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// 1. one CommonJS file with all dependencies (SEA in Node 22 runs a single CommonJS script)
console.log(`build-exe: bundling src/index.js (version ${version})`);
await build({
  entryPoints: [path.join(ROOT, 'src/index.js')],
  outfile: path.join(BUILD, 'bundle.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  legalComments: 'none',
  logLevel: 'warning',
  // optional native add-ons of ws, it works without them
  external: ['bufferutil', 'utf-8-validate'],
  define: {
    'import.meta.url': 'HL7T_IMPORT_META_URL',
    __HL7T_VERSION__: JSON.stringify(version),
  },
  banner: { js: 'const HL7T_IMPORT_META_URL = require("node:url").pathToFileURL(__filename).href;' },
});

// 2. assets: UI, /lib modules, default scenarios and examples, plus a manifest of the keys
const assets = {};
for (const file of walk(path.join(ROOT, 'public'))) assets[toKey('public', path.relative(path.join(ROOT, 'public'), file))] = file;
for (const name of LIB_FILES) assets[toKey('lib', name)] = path.join(ROOT, 'src/hl7', name);
for (const dir of ['scenarios', 'examples']) {
  for (const file of walk(path.join(ROOT, dir))) assets[toKey(dir, path.relative(path.join(ROOT, dir), file))] = file;
}
const manifestPath = path.join(BUILD, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(Object.keys(assets).sort(), null, 1));
assets['manifest.json'] = manifestPath;
console.log(`build-exe: ${Object.keys(assets).length - 1} embedded files`);

// 3. SEA blob
const seaConfigPath = path.join(BUILD, 'sea-config.json');
const blobPath = path.join(BUILD, 'sea-prep.blob');
fs.writeFileSync(seaConfigPath, JSON.stringify({
  main: path.join(BUILD, 'bundle.cjs'),
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false, // keeps the blob usable with a node binary of another platform
  assets,
}, null, 2));
const gen = spawnSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { cwd: ROOT, stdio: 'inherit' });
if (gen.status !== 0) die('node --experimental-sea-config failed');

// 4. copy the node binary and inject the blob
const outName = `simple-hl7-${version}-${target}${isWindowsTarget ? '.exe' : ''}`;
const outPath = path.join(DIST, outName);
fs.rmSync(outPath, { force: true });
fs.copyFileSync(nodeBinary, outPath);
if (!isWindowsTarget) fs.chmodSync(outPath, 0o755);
if (args.node) console.log(`build-exe: using ${nodeBinary}; it MUST be Node ${process.version} or the program will not start`);
console.log(`build-exe: injecting into ${path.relative(ROOT, outPath)}`);
await inject(outPath, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), { sentinelFuse: SEA_FUSE });

// 5. checksums (one line per file, like sha256sum)
const sumsPath = path.join(DIST, `simple-hl7-${version}-checksums.txt`);
const lines = fs.existsSync(sumsPath)
  ? fs.readFileSync(sumsPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.endsWith(`  ${outName}`))
  : [];
const hash = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
lines.push(`${hash}  ${outName}`);
fs.writeFileSync(sumsPath, `${lines.sort((a, b) => a.slice(66).localeCompare(b.slice(66))).join('\n')}\n`);

// 6. smoke test when the executable can run here
if (!args.node) {
  const run = spawnSync(outPath, ['--version'], { encoding: 'utf8' });
  if (run.status !== 0 || run.stdout.trim() !== version) {
    die(`smoke test failed: ${run.error?.message ?? ''} ${run.stderr ?? ''} (stdout: ${run.stdout})`);
  }
}
const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
console.log(`build-exe: done, dist/${outName} (${sizeMb} MB)`);
