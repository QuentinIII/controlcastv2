'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ConfigStore } = require('../app/lib/config-store');
const { appDefaults, migrate } = require('../app/lib/key-defaults');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-config-'));
}

const quiet = { info() {}, warn() {}, error() {} };

function open(dir, extra) {
  return new ConfigStore(Object.assign({ dir, defaults: appDefaults(), debounceMs: 0, logger: quiet }, extra));
}

const userKeys = { '0,0': { description: 'Intro', color: { press: 'RED', release: 'GREEN' } } };

test('creates config with defaults and persists changes', () => {
  const dir = tmpDir();
  const s = open(dir);
  assert.strictEqual(s.get('app.clr.port'), 3000);
  s.set('keys', userKeys);
  const s2 = open(dir);
  assert.deepStrictEqual(s2.get('keys'), userKeys);
  assert.strictEqual(s2.recovery, null);
});

test('reads a config written by the old electron-config (tabs, no new fields)', () => {
  const dir = tmpDir();
  const old = { app: { version: 6, id: '123', close_to_tray: true, clr: { enabled: true, port: 4000 } }, keys: userKeys };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(old, null, '\t'));
  const s = open(dir);
  assert.strictEqual(s.get('app.close_to_tray'), true);
  assert.strictEqual(s.get('app.clr.port'), 4000);
  assert.strictEqual(s.get('app.start_minimized'), false); // filled from defaults
  const migrated = migrate(s.getAll());
  assert.strictEqual(migrated.app.version, 7);
  assert.strictEqual(migrated.keys['0,0'].light.playing.mode, 'none');
  assert.strictEqual(migrated.keys['0,0'].color.press, 'RED');
});

for (const [name, content] of [
  ['zero-filled (typical after a blue screen)', Buffer.alloc(4096)],
  ['empty', ''],
  ['truncated', '{"app": {"version": 7}, "keys": {"0,0": {"desc'],
]) {
  test(`recovers from a ${name} config.json using the .bak`, () => {
    const dir = tmpDir();
    const s = open(dir);
    s.set('keys', userKeys); // writes config.json
    s.set('app.close_to_tray', true); // previous version goes to .bak
    fs.writeFileSync(path.join(dir, 'config.json'), content);
    const s2 = open(dir);
    assert.deepStrictEqual(s2.get('keys'), userKeys);
    assert.ok(s2.recovery && s2.recovery.from.endsWith('config.json.bak'));
    // The broken file is kept aside, never silently deleted
    assert.ok(fs.readdirSync(dir).some(f => f.startsWith('config.corrupt-')));
    // And the good config is written back in place
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).keys, userKeys);
  });
}

test('prefers a complete .tmp (crash between flush and rename)', () => {
  const dir = tmpDir();
  const s = open(dir);
  s.set('keys', { '1,1': { description: 'old' } });
  fs.unlinkSync(path.join(dir, 'config.json'));
  const newer = s.getAll();
  newer.keys = { '1,1': { description: 'new' } };
  fs.writeFileSync(path.join(dir, 'config.json.tmp'), JSON.stringify(newer));
  const s2 = open(dir);
  assert.strictEqual(s2.get('keys.1,1.description'), 'new');
});

test('falls back to snapshots when config and .bak are both broken', () => {
  const dir = tmpDir();
  const s = open(dir);
  s.set('keys', userKeys);
  s.snapshot(true);
  fs.writeFileSync(path.join(dir, 'config.json'), Buffer.alloc(100));
  fs.writeFileSync(path.join(dir, 'config.json.bak'), 'garbage');
  const s2 = open(dir);
  assert.deepStrictEqual(s2.get('keys'), userKeys);
  assert.ok(s2.recovery.from.includes('backups'));
});

test('never overwrites a broken config with defaults when nothing can be recovered', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ broken');
  const s = open(dir);
  assert.ok(s.recovery);
  const corrupt = fs.readdirSync(dir).find(f => f.startsWith('config.corrupt-'));
  assert.strictEqual(fs.readFileSync(path.join(dir, corrupt), 'utf8'), '{ broken');
});

test('snapshot rotation keeps maxBackups files and skips identical content', () => {
  const dir = tmpDir();
  const s = open(dir, { maxBackups: 3, snapshotIntervalMs: 0 });
  for (let i = 0; i < 6; i++) s.set('keys', { '0,0': { description: `v${i}` } });
  s.snapshot(true);
  s.snapshot(true);
  assert.ok(s.listBackups().length <= 3);
  const latest = JSON.parse(fs.readFileSync(s.listBackups()[0], 'utf8'));
  assert.strictEqual(latest.keys['0,0'].description, 'v5');
});

test('debounced writes are flushed by flushSync', () => {
  const dir = tmpDir();
  const s = open(dir, { debounceMs: 10000 });
  s.set('app.close_to_tray', true);
  assert.strictEqual(s.dirty, true);
  s.flushSync();
  assert.strictEqual(s.dirty, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).app.close_to_tray, true);
});

test('get returns copies (callers cannot corrupt the store by mutation)', () => {
  const dir = tmpDir();
  const s = open(dir);
  s.set('keys', userKeys);
  const k = s.get('keys');
  k['0,0'].description = 'changed';
  assert.strictEqual(s.get('keys.0,0.description'), 'Intro');
});

test('export / import round trip, import keeps a snapshot of the previous config', () => {
  const dir = tmpDir();
  const s = open(dir);
  s.set('keys', userKeys);
  const file = path.join(dir, 'export.json');
  s.exportTo(file);
  s.set('keys', {});
  const before = s.listBackups().length;
  s.importFrom(file);
  assert.deepStrictEqual(s.get('keys'), userKeys);
  assert.ok(s.listBackups().length >= before);
  assert.throws(() => s.importFrom(path.join(dir, 'missing.json')));
});
