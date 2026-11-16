'use strict';

/*
 * Small rotating file logger (no network, no dependency).
 * Logs go to %APPDATA%\ControlCast\logs\controlcast.log (rotated at 2 MB, 3 files kept).
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_SIZE = 2 * 1024 * 1024;
const KEEP = 3;

function createLogger(logDir) {
  let file = null;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    file = path.join(logDir, 'controlcast.log');
  } catch (e) {
    file = null;
  }

  let size = 0;
  try {
    size = file ? fs.statSync(file).size : 0;
  } catch (e) {
    size = 0;
  }

  function rotate() {
    try {
      for (let i = KEEP - 1; i >= 1; i--) {
        const src = `${file}.${i}`;
        if (fs.existsSync(src)) fs.renameSync(src, `${file}.${i + 1}`);
      }
      fs.renameSync(file, `${file}.1`);
    } catch (e) { /* ignore */ }
    size = 0;
  }

  function write(level, args) {
    const msg = util.format(...args.map(a => (a instanceof Error ? (a.stack || a.message) : a)));
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}\n`;
    try {
      // eslint-disable-next-line no-console
      (level === 'error' ? console.error : console.log)(line.trim());
    } catch (e) { /* ignore broken stdout */ }
    if (!file) return;
    try {
      if (size + line.length > MAX_SIZE) rotate();
      fs.appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch (e) { /* never crash because of logging */ }
  }

  return {
    dir: logDir,
    file,
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
  };
}

module.exports = { createLogger };
