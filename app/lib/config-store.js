'use strict';

/*
 * Crash-safe JSON configuration store.
 *
 * Why this exists: the previous storage (electron-config 0.2) wrote config.json
 * in place without flushing it to disk, and silently returned an EMPTY config
 * whenever the file could not be parsed. After a blue screen / power loss
 * Windows often leaves such a file truncated or filled with NUL bytes, so the
 * app started with defaults and the next save overwrote the user's settings.
 *
 * This store:
 *  - writes to a temp file, flushes it to the physical disk (fsync /
 *    FlushFileBuffers on Windows), then atomically renames it into place;
 *  - keeps the previous good version as config.json.bak;
 *  - keeps rotating timestamped snapshots in a backups folder;
 *  - on load, validates the JSON and transparently falls back to the newest
 *    valid copy (temp, .bak, snapshots) and moves the broken file aside
 *    instead of ever overwriting it with defaults;
 *  - keeps everything in memory (reads never hit the disk) and debounces writes.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// Fill in missing values from defaults without overwriting existing ones
function fillDefaults(target, defaults) {
  for (const key of Object.keys(defaults)) {
    if (!(key in target)) {
      target[key] = clone(defaults[key]);
    } else if (isPlainObject(target[key]) && isPlainObject(defaults[key])) {
      fillDefaults(target[key], defaults[key]);
    }
  }
  return target;
}

function splitPath(p) {
  return Array.isArray(p) ? p : String(p).split('.');
}

function getPath(obj, p) {
  let cur = obj;
  for (const part of splitPath(p)) {
    if (!isPlainObject(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj, p, value) {
  const parts = splitPath(p);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function deletePath(obj, p) {
  const parts = splitPath(p);
  const parent = parts.length > 1 ? getPath(obj, parts.slice(0, -1)) : obj;
  if (isPlainObject(parent)) delete parent[parts[parts.length - 1]];
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestamp(d) {
  d = d || new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

class ConfigStore extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.dir             Folder holding config.json
   * @param {string} [opts.fileName]      Default 'config.json'
   * @param {object} [opts.defaults]      Default values (deep-filled)
   * @param {string} [opts.backupDir]     Folder for snapshots (default <dir>/backups)
   * @param {number} [opts.maxBackups]    Snapshots kept (default 30)
   * @param {number} [opts.snapshotIntervalMs] Min time between snapshots (default 1h)
   * @param {number} [opts.debounceMs]    Write debounce (default 250ms, 0 = sync)
   * @param {object} [opts.logger]        { info, warn, error }
   * @param {function} [opts.validate]    (data) => true when data looks usable
   */
  constructor(opts) {
    super();
    this.dir = opts.dir;
    this.file = path.join(this.dir, opts.fileName || 'config.json');
    this.tmpFile = `${this.file}.tmp`;
    this.bakFile = `${this.file}.bak`;
    this.backupDir = opts.backupDir || path.join(this.dir, 'backups');
    this.defaults = opts.defaults || {};
    this.maxBackups = opts.maxBackups || 30;
    this.snapshotIntervalMs = opts.snapshotIntervalMs === undefined ? 60 * 60 * 1000 : opts.snapshotIntervalMs;
    this.debounceMs = opts.debounceMs === undefined ? 250 : opts.debounceMs;
    this.logger = opts.logger || { info() {}, warn() {}, error() {} };
    this.validate = opts.validate || (data => isPlainObject(data));
    this.data = {};
    this.recovery = null; // Filled when the config had to be recovered
    this._timer = null;
    this._dirty = false;
    this._lastSnapshot = 0;
    this.load();
  }

  // ---------------------------------------------------------------- loading

  _readCandidate(file) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') this.logger.warn(`Config: cannot read ${file}: ${err.message}`);
      return { exists: err.code !== 'ENOENT', ok: false };
    }
    // Strip BOM and NUL padding that Windows can leave after a crash
    const cleaned = raw.replace(/^﻿/, '').replace(/\u0000+$/, '').trim();
    if (!cleaned) return { exists: true, ok: false, reason: 'empty or zero-filled file' };
    try {
      const data = JSON.parse(cleaned);
      if (!this.validate(data)) return { exists: true, ok: false, reason: 'invalid structure' };
      return { exists: true, ok: true, data };
    } catch (err) {
      return { exists: true, ok: false, reason: `invalid JSON (${err.message})` };
    }
  }

  listBackups() {
    try {
      return fs.readdirSync(this.backupDir)
        .filter(f => /^config-\d{8}-\d{6}(-\d{3})?(-\d+)?\.json$/.test(f))
        .map(f => ({ f, k: f.replace(/\.json$/, '') }))
        .sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0)) // Newest first
        .map(x => path.join(this.backupDir, x.f));
    } catch (e) {
      return [];
    }
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    const primary = this._readCandidate(this.file);
    if (primary.ok) {
      this.data = primary.data;
    } else {
      // Primary is missing or broken: look for the newest usable copy.
      // .tmp is only renamed into place after it has been fully flushed, so
      // a parseable .tmp is a complete, newer version than .bak.
      const candidates = [this.tmpFile, this.bakFile, ...this.listBackups()];
      let found = null;
      for (const file of candidates) {
        const c = this._readCandidate(file);
        if (c.ok) {
          found = { file, data: c.data };
          break;
        }
      }
      if (primary.exists) this._quarantine(this.file, primary.reason);
      if (found) {
        this.data = found.data;
        this.recovery = {
          from: found.file,
          reason: primary.exists ? primary.reason : 'config.json missing',
        };
        this.logger.warn(`Config: recovered settings from ${found.file} (${this.recovery.reason})`);
      } else {
        this.data = {};
        if (primary.exists) {
          this.recovery = { from: null, reason: primary.reason };
          this.logger.error(`Config: config.json unusable (${primary.reason}) and no backup found`);
        }
      }
    }
    fillDefaults(this.data, this.defaults);
    // Persist immediately when recovering so the good copy is back in place
    if (!primary.ok) this.flushSync();
    // A snapshot at every launch of a known-good config
    this.snapshot(true);
    return this.data;
  }

  _quarantine(file, reason) {
    try {
      const dest = path.join(this.dir, `config.corrupt-${timestamp()}.json`);
      fs.renameSync(file, dest);
      this.logger.warn(`Config: moved unreadable ${path.basename(file)} to ${dest} (${reason})`);
    } catch (err) {
      this.logger.error(`Config: unable to move corrupt file aside: ${err.message}`);
    }
  }

  // ----------------------------------------------------------- data access

  get(p) {
    if (p === undefined) return clone(this.data);
    return clone(getPath(this.data, p));
  }

  has(p) {
    return getPath(this.data, p) !== undefined;
  }

  getAll() {
    return clone(this.data);
  }

  set(p, value) {
    if (isPlainObject(p) && value === undefined) {
      for (const k of Object.keys(p)) setPath(this.data, k, clone(p[k]));
    } else {
      setPath(this.data, p, clone(value));
    }
    this._changed(p, value);
  }

  delete(p) {
    deletePath(this.data, p);
    this._changed(p, undefined);
  }

  replace(data) {
    if (!this.validate(data)) throw new Error('Invalid configuration data');
    this.data = fillDefaults(clone(data), this.defaults);
    this._changed(null, null);
  }

  _changed(p, value) {
    this._dirty = true;
    this.emit('change', p, value);
    if (this.debounceMs <= 0) {
      this.flushSync();
    } else if (!this._timer) {
      this._timer = setTimeout(() => {
        this._timer = null;
        this.flushSync();
      }, this.debounceMs);
    }
  }

  // --------------------------------------------------------------- writing

  _writeDurable(file, content) {
    const fd = fs.openSync(file, 'w');
    try {
      fs.writeSync(fd, content, 0, 'utf8');
      fs.fsyncSync(fd); // FlushFileBuffers on Windows: data really hits the disk
    } finally {
      fs.closeSync(fd);
    }
  }

  _rename(from, to) {
    // Antivirus / indexers on Windows can briefly lock files (EPERM/EBUSY/EACCES)
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(from, to);
        return;
      } catch (err) {
        if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        sleepSync(25 * (attempt + 1));
      }
    }
  }

  _syncDir() {
    // Not possible on Windows (NTFS journals the rename), harmless elsewhere
    if (process.platform === 'win32') return;
    try {
      const fd = fs.openSync(this.dir, 'r');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (e) { /* ignore */ }
  }

  flushSync() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const content = JSON.stringify(this.data, null, 2);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this._writeDurable(this.tmpFile, content);
      // Keep the previous good version as .bak
      if (fs.existsSync(this.file) && this._readCandidate(this.file).ok) {
        try {
          fs.copyFileSync(this.file, this.bakFile);
        } catch (err) {
          this.logger.warn(`Config: unable to refresh .bak: ${err.message}`);
        }
      }
      this._rename(this.tmpFile, this.file);
      this._syncDir();
      this._dirty = false;
      this.emit('saved');
    } catch (err) {
      this.logger.error(`Config: atomic save failed, trying direct write: ${err.message}`);
      try {
        this._writeDurable(this.file, content);
        this._dirty = false;
        this.emit('saved');
      } catch (err2) {
        this.logger.error(`Config: SAVE FAILED: ${err2.message}`);
        this.emit('error', err2);
        return false;
      }
    }
    this.snapshot(false);
    return true;
  }

  get dirty() {
    return this._dirty;
  }

  // ------------------------------------------------------------- snapshots

  snapshot(force) {
    const now = Date.now();
    if (!force && now - this._lastSnapshot < this.snapshotIntervalMs) return null;
    // Do not snapshot a config that has no user data at all
    if (!this.data || Object.keys(this.data).length === 0) return null;
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const content = JSON.stringify(this.data, null, 2);
      const latest = this.listBackups()[0];
      if (latest) {
        try {
          if (fs.readFileSync(latest, 'utf8') === content) {
            this._lastSnapshot = now;
            return latest; // Nothing changed since the last snapshot
          }
        } catch (e) { /* ignore */ }
      }
      const d = new Date();
      const base = `config-${timestamp(d)}-${String(d.getMilliseconds()).padStart(3, '0')}`;
      let file = path.join(this.backupDir, `${base}.json`);
      for (let i = 1; fs.existsSync(file); i++) {
        file = path.join(this.backupDir, `${base}-${String(i).padStart(3, '0')}.json`);
      }
      this._writeDurable(file, content);
      this._lastSnapshot = now;
      this._pruneBackups();
      return file;
    } catch (err) {
      this.logger.warn(`Config: snapshot failed: ${err.message}`);
      return null;
    }
  }

  _pruneBackups() {
    const backups = this.listBackups();
    for (const old of backups.slice(this.maxBackups)) {
      try {
        fs.unlinkSync(old);
      } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------- import/export

  exportTo(file) {
    this._writeDurable(file, JSON.stringify(this.data, null, 2));
  }

  importFrom(file) {
    const c = this._readCandidate(file);
    if (!c.ok) throw new Error(c.reason || 'File not found');
    this.snapshot(true); // Keep what we had before importing
    this.replace(c.data);
    this.flushSync();
  }
}

module.exports = { ConfigStore, fillDefaults, getPath, setPath, clone };
