'use strict';

/*
 * Computes the colour of every key from stacked layers and drives animations
 * (blink / pulse) with ONE shared timer that only runs while something moves.
 *
 * Priority (highest first):
 *   pressed  - the key is held down (press colour)
 *   status   - temporary feedback, e.g. web request pending / ok / failed
 *   playing  - the key's sound is playing (solid / blink / pulse)
 *   latched  - "toggle" keys that are switched on
 *   base     - idle colour
 */

const { COLORS, normalizeColor } = require('./colors');

const RATES = { slow: 1000, normal: 500, fast: 250 };

function rateMs(rate) {
  if (typeof rate === 'number' && rate >= 60) return rate;
  return RATES[rate] || RATES.normal;
}

function effectColor(effect, now) {
  const color = normalizeColor(effect.color);
  const period = rateMs(effect.rate);
  switch (effect.mode) {
    case 'blink': {
      const phase = Math.floor(now / (period / 2)) % 2;
      return phase === 0 ? color : normalizeColor(effect.color2 || 'OFF');
    }
    case 'pulse': {
      const dim = COLORS[color].dim;
      const dimmer = COLORS[dim].dim;
      const steps = [color, dim, dimmer, dim];
      return steps[Math.floor(now / (period / 4)) % 4];
    }
    default: // solid
      return color;
  }
}

function isAnimated(effect) {
  return !!effect && (effect.mode === 'blink' || effect.mode === 'pulse');
}

class LightEngine {
  /**
   * @param {object} opts
   * @param {function} opts.output  (key:[x,y], colorName) => void, called only on change
   * @param {function} [opts.now]   Clock (tests)
   * @param {number} [opts.tickMs]  Animation resolution
   * @param {object} [opts.timers]  { setInterval, clearInterval, setTimeout, clearTimeout } (tests)
   */
  constructor(opts) {
    this.output = opts.output;
    this.now = opts.now || (() => Date.now());
    this.tickMs = opts.tickMs || 40;
    // Wrapped: browser timer functions throw "Illegal invocation" when called as methods of another object
    this.timers = opts.timers || {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: id => clearInterval(id),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: id => clearTimeout(id),
    };
    this.keys = new Map();
    this.shown = new Map();
    this._ticker = null;
  }

  _state(key) {
    const k = Array.isArray(key) ? key.join(',') : key;
    let s = this.keys.get(k);
    if (!s) {
      s = { key: k.split(',').map(Number), base: 'OFF', latched: null, pressed: null, status: null, playing: null };
      this.keys.set(k, s);
    }
    return s;
  }

  compute(key, now) {
    const s = this._state(key);
    now = now === undefined ? this.now() : now;
    if (s.pressed) return s.pressed;
    if (s.status) {
      return isAnimated(s.status) ? effectColor(s.status, now) : normalizeColor(s.status.color);
    }
    if (s.playing && s.playing.mode && s.playing.mode !== 'none') return effectColor(s.playing, now);
    if (s.latched) return s.latched;
    return s.base;
  }

  render(key, force) {
    const s = this._state(key);
    const k = s.key.join(',');
    const color = this.compute(key);
    if (force || this.shown.get(k) !== color) {
      this.shown.set(k, color);
      this.output(s.key, color);
    }
  }

  renderAll(force) {
    for (const k of this.keys.keys()) this.render(k, force);
  }

  setBase(key, color) {
    this._state(key).base = normalizeColor(color);
    this.render(key);
  }

  setPressed(key, color) {
    // null = released. A pressed key with colour OFF still shows OFF
    this._state(key).pressed = color ? normalizeColor(color) : null;
    this.render(key);
  }

  setLatched(key, color) {
    this._state(key).latched = color ? normalizeColor(color) : null;
    this.render(key);
  }

  isLatched(key) {
    return !!this._state(key).latched;
  }

  setPlaying(key, effect) {
    const s = this._state(key);
    s.playing = effect && effect.mode && effect.mode !== 'none' ? Object.assign({}, effect) : null;
    this.render(key);
    this._updateTicker();
  }

  // Temporary colour/effect; ms = 0 keeps it until cleared with clearStatus
  setStatus(key, effect, ms) {
    const s = this._state(key);
    if (typeof effect === 'string') effect = { mode: 'solid', color: effect };
    if (s.statusTimer) this.timers.clearTimeout(s.statusTimer);
    s.statusTimer = null;
    s.status = effect;
    if (ms) {
      s.statusTimer = this.timers.setTimeout(() => {
        s.statusTimer = null;
        s.status = null;
        this.render(key);
        this._updateTicker();
      }, ms);
    }
    this.render(key);
    this._updateTicker();
  }

  clearStatus(key) {
    this.setStatus(key, null, 0);
  }

  reset(key) {
    const s = this._state(key);
    if (s.statusTimer) this.timers.clearTimeout(s.statusTimer);
    Object.assign(s, { latched: null, pressed: null, status: null, statusTimer: null, playing: null });
    this.render(key);
    this._updateTicker();
  }

  _animatedCount() {
    let n = 0;
    for (const s of this.keys.values()) {
      if (isAnimated(s.status) || (!s.status && isAnimated(s.playing))) n++;
    }
    return n;
  }

  _updateTicker() {
    const needed = this._animatedCount() > 0;
    if (needed && !this._ticker) {
      this._ticker = this.timers.setInterval(() => this.tick(), this.tickMs);
    } else if (!needed && this._ticker) {
      this.timers.clearInterval(this._ticker);
      this._ticker = null;
    }
  }

  tick() {
    for (const [k, s] of this.keys) {
      if (isAnimated(s.status) || isAnimated(s.playing)) this.render(k);
    }
  }

  get animating() {
    return !!this._ticker;
  }

  destroy() {
    if (this._ticker) this.timers.clearInterval(this._ticker);
    this._ticker = null;
    for (const s of this.keys.values()) {
      if (s.statusTimer) this.timers.clearTimeout(s.statusTimer);
    }
  }
}

module.exports = { LightEngine, effectColor, RATES };
