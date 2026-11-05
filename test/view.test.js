import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEW_GROUPS, VIEW_KEYS, VIEW_PRESETS, VIEW_LABELS, normalizeView, hiddenKeys, viewCss } from '../public/js/view.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('view presets', () => {
  test('every key is listed once', () => {
    assert.equal(new Set(VIEW_KEYS).size, VIEW_KEYS.length);
    assert.equal(VIEW_KEYS.length, VIEW_GROUPS.reduce((n, g) => n + g.items.length, 0));
  });

  test('presets hide only known keys, each once', () => {
    for (const [name, preset] of Object.entries(VIEW_PRESETS)) {
      assert.equal(new Set(preset.hidden).size, preset.hidden.length, name);
      for (const key of preset.hidden) assert.ok(VIEW_KEYS.includes(key), `${name}: ${key}`);
    }
  });

  test('Pełny hides nothing, Standardowy shows everything Prosty shows', () => {
    assert.deepEqual(VIEW_PRESETS.full.hidden, []);
    const simple = new Set(VIEW_PRESETS.simple.hidden);
    for (const key of VIEW_PRESETS.standard.hidden) assert.ok(simple.has(key), key);
    assert.ok(VIEW_PRESETS.standard.hidden.length < VIEW_PRESETS.simple.hidden.length);
  });

  test('the basic controls stay in every preset', () => {
    for (const key of ['top.clear', 'listeners', 'sender', 'sender.encoding']) {
      for (const [name, preset] of Object.entries(VIEW_PRESETS)) assert.ok(!preset.hidden.includes(key), `${name}: ${key}`);
    }
  });

  test('the switch offers the three presets and Własny', () => {
    assert.deepEqual(Object.keys(VIEW_LABELS), ['simple', 'standard', 'full', 'custom']);
    for (const name of Object.keys(VIEW_PRESETS)) assert.equal(VIEW_LABELS[name], VIEW_PRESETS[name].label);
  });
});

describe('normalizeView', () => {
  test('missing or broken value falls back', () => {
    assert.deepEqual(normalizeView(null, 'simple'), { preset: 'simple', custom: null });
    assert.deepEqual(normalizeView('full', 'simple'), { preset: 'simple', custom: null });
    assert.deepEqual(normalizeView({ preset: 'expert' }, 'standard'), { preset: 'standard', custom: null });
    assert.deepEqual(normalizeView({ preset: 'simple' }, 'nonsense'), { preset: 'simple', custom: null });
    assert.deepEqual(normalizeView(undefined), { preset: 'full', custom: null });
  });

  test('custom keeps known keys once', () => {
    assert.deepEqual(normalizeView({ preset: 'custom', custom: ['top.clock', 'nope', 'top.clock', 7] }),
      { preset: 'custom', custom: ['top.clock'] });
  });

  test('Własny without its list falls back, an empty list is kept', () => {
    assert.deepEqual(normalizeView({ preset: 'custom' }, 'simple'), { preset: 'simple', custom: null });
    assert.deepEqual(normalizeView({ preset: 'custom', custom: [] }), { preset: 'custom', custom: [] });
  });

  test('a preset remembers the custom list for later', () => {
    assert.deepEqual(normalizeView({ preset: 'full', custom: ['scenarios'] }), { preset: 'full', custom: ['scenarios'] });
  });
});

describe('hiddenKeys and viewCss', () => {
  test('preset and custom', () => {
    assert.deepEqual([...hiddenKeys({ preset: 'standard' })].sort(), [...VIEW_PRESETS.standard.hidden].sort());
    assert.deepEqual([...hiddenKeys({ preset: 'custom', custom: ['scenarios'] })], ['scenarios']);
    assert.equal(hiddenKeys({ preset: 'full', custom: ['scenarios'] }).size, 0);
    assert.equal(hiddenKeys(null).size, 0);
  });

  test('one rule for the hidden keys, nothing when nothing is hidden', () => {
    assert.equal(viewCss(new Set()), '');
    assert.equal(viewCss(null), '');
    const css = viewCss(new Set(['top.clock', 'timeline.conn', 'unknown']));
    assert.match(css, /^\[data-view~="top\.clock"\],\n\[data-view~="timeline\.conn"\] \{ display: none !important; \}\n$/);
  });
});

describe('view keys used by the interface', () => {
  const files = [path.join(ROOT, 'public', 'index.html'), ...fs.readdirSync(path.join(ROOT, 'public', 'js'))
    .filter((name) => name.endsWith('.js') && name !== 'view.js')
    .map((name) => path.join(ROOT, 'public', 'js', name))];
  // data-view="x" and 'data-view': 'x' in markup, { view: 'x' } and node.dataset.view = 'x' in code, isHidden('x')
  const re = /(?:data-view['"]?\s*[:=]\s*|\bview\s*[:=]\s*|isHidden\(\s*)['"]([^'"]+)['"]/g;
  const used = new Map();
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(re)) {
      for (const key of m[1].split(/\s+/)) {
        if (!used.has(key)) used.set(key, path.relative(ROOT, file));
      }
    }
  }

  test('every key in the interface exists', () => {
    for (const [key, file] of used) assert.ok(VIEW_KEYS.includes(key), `${file}: unknown view key "${key}"`);
  });

  test('every key hides something', () => {
    for (const key of VIEW_KEYS) assert.ok(used.has(key), `view key "${key}" is not used by the interface`);
  });
});
