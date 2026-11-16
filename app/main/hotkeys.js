'use strict';

/*
 * Keyboard simulation (main process).
 *
 * The old version used robot.setKeyboardDelay(50): every single key toggle
 * BLOCKED the main process for 50 ms (300 ms for CTRL+SHIFT+X), which froze
 * the UI and delayed the Launchpad lights. Timing is now done with timers.
 *
 * Key presses are reference counted so that a "hold" key and a "send" key
 * sharing a modifier never release it under each other's feet.
 */

function resolveKey(key) {
  key = String(key).toLowerCase().trim();
  if (key.startsWith('numpad ')) {
    const rest = key.slice(7);
    if (['+', '-', '*', '/', '.'].includes(rest)) return `numpad_${rest}`;
    return `numpad_${rest}`;
  }
  switch (key) {
    case 'l-ctrl':
    case 'ctrl':
      return 'control';
    case 'r-ctrl':
      return 'right_control';
    case 'l-shift':
    case 'shift':
      return 'shift';
    case 'r-shift':
      return 'right_shift';
    case 'l-alt':
    case 'alt':
      return 'alt';
    case 'r-alt':
      return 'right_alt';
    case 'esc':
      return 'escape';
    case 'page up':
      return 'pageup';
    case 'page down':
      return 'pagedown';
    case 'print screen':
      return 'printscreen';
    case 'left command':
    case 'right command':
    case 'windows':
    case 'command':
      return 'command';
    case 'caps lock':
      return 'capslock';
    default:
      return key;
  }
}

function parseCombo(str) {
  if (!str) return [];
  return String(str).split(' + ').map(s => s.trim()).filter(Boolean);
}

class Hotkeys {
  /**
   * @param {object} opts
   * @param {object|null} opts.robot  robotjs-like module ({ keyToggle, setKeyboardDelay })
   * @param {object} [opts.logger]
   * @param {number} [opts.stepMs]  Delay between each key of a combo (default 15)
   * @param {number} [opts.holdMs]  How long a "send" combo is held (default 50)
   */
  constructor(opts) {
    this.robot = opts.robot;
    this.logger = opts.logger || console;
    this.stepMs = opts.stepMs === undefined ? 15 : opts.stepMs;
    this.holdMs = opts.holdMs === undefined ? 50 : opts.holdMs;
    this.counts = new Map();
    this.queue = Promise.resolve();
    if (this.robot && this.robot.setKeyboardDelay) this.robot.setKeyboardDelay(0);
  }

  get available() {
    return !!this.robot;
  }

  _toggle(key, action) {
    if (!this.robot) return;
    const name = resolveKey(key);
    try {
      this.robot.keyToggle(name, action);
    } catch (err) {
      this.logger.error(`Hotkey error on key '${key}' (${name}): ${err.message}`);
    }
  }

  _wait(ms) {
    return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
  }

  async _down(keys) {
    for (const k of keys) {
      const c = (this.counts.get(k) || 0) + 1;
      this.counts.set(k, c);
      if (c === 1) {
        this._toggle(k, 'down');
        await this._wait(this.stepMs);
      }
    }
  }

  async _up(keys) {
    for (const k of keys.slice().reverse()) {
      const c = Math.max(0, (this.counts.get(k) || 0) - 1);
      if (c === 0) this.counts.delete(k);
      else this.counts.set(k, c);
      if (c === 0) {
        this._toggle(k, 'up');
        await this._wait(this.stepMs);
      }
    }
  }

  _enqueue(fn) {
    this.queue = this.queue.then(fn).catch(err => this.logger.error(`Hotkey queue error: ${err.message}`));
    return this.queue;
  }

  // Press + release (SEND KEYS)
  send(combo) {
    const keys = parseCombo(combo);
    if (!keys.length) return Promise.resolve();
    return this._enqueue(async () => {
      await this._down(keys);
      await this._wait(this.holdMs);
      await this._up(keys);
    });
  }

  // HOLD KEYS: press now, release later with up()
  down(combo) {
    const keys = parseCombo(combo);
    return this._enqueue(() => this._down(keys));
  }

  up(combo) {
    const keys = parseCombo(combo);
    return this._enqueue(() => this._up(keys));
  }

  // Release everything still held (window reload, quit, crash recovery)
  releaseAll() {
    return this._enqueue(async () => {
      for (const k of Array.from(this.counts.keys())) {
        this.counts.delete(k);
        this._toggle(k, 'up');
      }
    });
  }
}

module.exports = { Hotkeys, resolveKey, parseCombo };
