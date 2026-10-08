// Runtime facts that differ between `node src/index.js` and the single executable (Node SEA):
// where the data folder is, the version, and access to embedded UI files.
//
// Executable: data (config/, logs/, scenarios/, examples/) lives next to the .exe; UI files and the
// default scenarios / examples are embedded as SEA assets (see scripts/build-exe.mjs).
// Source: everything is read from the project folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sea from 'node:sea';

export const IS_EXE = sea.isSea();

/* global __HL7T_VERSION__ */
const BUILD_VERSION = typeof __HL7T_VERSION__ !== 'undefined' ? __HL7T_VERSION__ : null;

/** Folder with config/, logs/, scenarios/, examples/. */
export const APP_ROOT = IS_EXE
  ? path.dirname(process.execPath)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** First non-empty line of VERSION.md, e.g. "1.2.3" (the single source of the version number). */
export function readVersionFile(root = APP_ROOT) {
  try {
    const line = fs.readFileSync(path.join(root, 'VERSION.md'), 'utf8').split(/\r?\n/).find((l) => l.trim() !== '') || '';
    return line.replace(/^[#\s]*/, '').replace(/^v/, '').trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = BUILD_VERSION || readVersionFile();

let manifest = null;

/** Keys of the embedded assets (exe only), e.g. 'public/index.html', 'lib/parser.js', 'scenarios/x.yaml'. */
export function assetKeys() {
  if (!IS_EXE) return [];
  if (manifest === null) {
    try {
      manifest = JSON.parse(sea.getAsset('manifest.json', 'utf8'));
    } catch {
      manifest = [];
    }
  }
  return manifest;
}

/** Embedded asset as a Buffer, or null when it does not exist (exe only). */
export function readAsset(key) {
  if (!IS_EXE || !assetKeys().includes(key)) return null;
  return Buffer.from(sea.getRawAsset(key));
}

/**
 * Exe only: on first start write the bundled scenarios/ and examples/ next to the executable so
 * they can be edited. Existing files are never overwritten. Returns the list of written paths.
 */
export function extractDefaults(dirs = ['scenarios', 'examples']) {
  const written = [];
  if (!IS_EXE) return written;
  for (const dir of dirs) {
    const target = path.join(APP_ROOT, dir);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(target, { recursive: true });
    for (const key of assetKeys()) {
      if (!key.startsWith(`${dir}/`)) continue;
      const file = path.join(APP_ROOT, ...key.split('/'));
      if (fs.existsSync(file)) continue;
      fs.writeFileSync(file, readAsset(key));
      written.push(file);
    }
  }
  return written;
}
