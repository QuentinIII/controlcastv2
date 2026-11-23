'use strict';

/*
 * Finds, connects to and talks with a Launchpad.
 *
 * - Hot-plug is detected by polling the MIDI port list (cheap, and much more
 *   reliable on Windows 11 than USB events, also after sleep / resume).
 * - LED messages go through a paced queue: the Launchpad MK1 / S / Mini lose
 *   messages when they receive too many at once (especially right after the
 *   reset sent on connection), which left some keys dark.
 * - Only LED changes are sent, and every LED is re-sent periodically so a
 *   lost message can never leave a key in the wrong state for long.
 * - Every MIDI call is guarded: an unplugged device or a port used by another
 *   application never crashes the app, it is simply retried later.
 */

const EventEmitter = require('events');
const { pickPort } = require('./launchpad-profiles');

function portNames(PortClass, probe) {
  if (typeof PortClass.getPortNames === 'function') return PortClass.getPortNames();
  const names = [];
  const count = probe.getPortCount();
  for (let i = 0; i < count; i++) names.push(probe.getPortName(i));
  return names;
}

class LaunchpadManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.midi   Module exposing Input and Output (@julusian/midi)
   * @param {number} [opts.pollMs]
   * @param {object} [opts.logger]
   * @param {boolean} [opts.paced]      Queue LED messages (default true)
   * @param {number} [opts.batch]       LED messages sent per tick (default 8)
   * @param {number} [opts.tickMs]      Delay between ticks (default 10 ms => 800 msg/s max)
   * @param {number} [opts.settleMs]    Wait after the init/reset messages (default 200 ms)
   * @param {number} [opts.refreshMs]   Re-send every LED this often (default 5 s, 0 = never)
   * @param {object} [opts.timers]      { setTimeout, clearTimeout, now } (tests)
   */
  constructor(opts) {
    super();
    this.midi = opts.midi;
    this.pollMs = opts.pollMs || 2000;
    this.logger = opts.logger || console;
    this.input = null;
    this.output = null;
    this.profile = null;
    this.portName = null;
    this.leds = new Map(); // "x,y" -> last color sent to the device
    this.desired = new Map(); // "x,y" -> color the key should show
    this.pending = new Set(); // keys waiting to be sent
    this.paced = opts.paced !== false;
    this.batch = opts.batch || 8;
    this.tickMs = opts.tickMs === undefined ? 10 : opts.tickMs;
    this.settleMs = opts.settleMs === undefined ? 200 : opts.settleMs;
    this.refreshMs = opts.refreshMs === undefined ? 5000 : opts.refreshMs;
    this.timers = opts.timers || {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: id => clearTimeout(id),
      now: () => Date.now(),
    };
    this._pumpTimer = null;
    this._holdUntil = 0;
    this._lastRefresh = 0;
    this._timer = null;
    this._lastError = null;
    this._probeIn = null;
    this._probeOut = null;
  }

  get connected() {
    return !!(this.input && this.output);
  }

  start() {
    this.poll();
    if (!this._timer) this._timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.disconnect(true);
  }

  _names() {
    const InputClass = this.midi.Input || this.midi.input;
    const OutputClass = this.midi.Output || this.midi.output;
    if (!this._probeIn && typeof InputClass.getPortNames !== 'function') this._probeIn = new InputClass();
    if (!this._probeOut && typeof OutputClass.getPortNames !== 'function') this._probeOut = new OutputClass();
    return {
      inputs: portNames(InputClass, this._probeIn),
      outputs: portNames(OutputClass, this._probeOut),
    };
  }

  poll() {
    let names;
    try {
      names = this._names();
    } catch (err) {
      this._reportError(`Unable to list MIDI ports: ${err.message}`);
      return;
    }
    const inPort = pickPort(names.inputs);
    const outPort = pickPort(names.outputs);
    if (this.connected) {
      // Still there? (same name at the same index)
      const stillHere = inPort && outPort && inPort.name === this.portName.in && outPort.name === this.portName.out &&
        inPort.index === this.portIndex.in && outPort.index === this.portIndex.out;
      if (!stillHere) {
        this.logger.info(`Launchpad '${this.portName.in}' disconnected`);
        this.disconnect(false);
      } else if (this.refreshMs && this.timers.now() - this._lastRefresh >= this.refreshMs) {
        this.refresh();
      }
      return;
    }
    if (inPort && outPort) this.connect(inPort, outPort);
  }

  connect(inPort, outPort) {
    const InputClass = this.midi.Input || this.midi.input;
    const OutputClass = this.midi.Output || this.midi.output;
    let input;
    let output;
    try {
      input = new InputClass();
      output = new OutputClass();
      input.on('message', (deltaTime, msg) => this._onMessage(msg));
      input.openPort(inPort.index);
      output.openPort(outPort.index);
    } catch (err) {
      this._safeClose(input, output);
      this._reportError(`Cannot open '${inPort.name}' (is another program using it?): ${err.message}`);
      return false;
    }
    this.input = input;
    this.output = output;
    this.profile = outPort.profile;
    this.portName = { in: inPort.name, out: outPort.name };
    this.portIndex = { in: inPort.index, out: outPort.index };
    this._lastError = null;
    this.leds.clear();
    this._sendAll(this.profile.init());
    // Let the device finish its reset before sending lights, then send them all
    this._holdUntil = this.timers.now() + (this.paced ? this.settleMs : 0);
    this._lastRefresh = this.timers.now();
    for (const k of this.desired.keys()) this.pending.add(k);
    this._schedule();
    this.logger.info(`Launchpad '${inPort.name}' connected (${this.profile.label})`);
    this.emit('connected', { name: inPort.name, profile: this.profile.id, label: this.profile.label });
    return true;
  }

  disconnect(sendShutdown) {
    if (!this.connected) return;
    if (sendShutdown && this.profile) this._sendAll(this.profile.shutdown());
    this._safeClose(this.input, this.output);
    this.input = null;
    this.output = null;
    this.profile = null;
    this.portName = null;
    this.portIndex = null;
    this.leds.clear();
    this.pending.clear();
    if (this._pumpTimer) this.timers.clearTimeout(this._pumpTimer);
    this._pumpTimer = null;
    this.emit('disconnected');
  }

  // Force a full reconnection (e.g. after the computer woke up)
  reconnect() {
    this.disconnect(false);
    this.poll();
  }

  _safeClose(input, output) {
    for (const port of [input, output]) {
      if (!port) continue;
      try {
        if (typeof port.removeAllListeners === 'function') port.removeAllListeners('message');
        port.closePort();
        if (typeof port.destroy === 'function') port.destroy();
      } catch (e) { /* ignore */ }
    }
  }

  _reportError(message) {
    if (this._lastError === message) return; // Do not flood the log every poll
    this._lastError = message;
    this.logger.warn(message);
    this.emit('error-message', message);
  }

  _onMessage(msg) {
    if (!this.profile) return;
    let ev;
    try {
      ev = this.profile.decode(msg);
    } catch (e) {
      return;
    }
    if (!ev) return;
    this.emit(ev.pressed ? 'press' : 'release', [ev.x, ev.y]);
  }

  _send(msg) {
    if (!this.output) return false;
    try {
      this.output.sendMessage(msg);
      return true;
    } catch (err) {
      this._reportError(`MIDI send failed: ${err.message}`);
      this.disconnect(false); // Will reconnect on next poll
      return false;
    }
  }

  _sendAll(msgs) {
    for (const m of msgs) {
      if (!this._send(m)) return;
    }
  }

  setLed(x, y, colorName, force) {
    const k = `${x},${y}`;
    this.desired.set(k, colorName);
    if (!this.connected) return; // Sent on connection
    if (!force && this.leds.get(k) === colorName && !this.pending.has(k)) return;
    this.pending.add(k);
    this._schedule();
  }

  // Re-send every light (lost messages, device re-plugged...)
  refresh() {
    this._lastRefresh = this.timers.now();
    if (!this.connected) return;
    for (const k of this.desired.keys()) this.pending.add(k);
    this._schedule();
  }

  _schedule() {
    if (!this.paced) {
      this._pump();
      return;
    }
    if (this._pumpTimer || !this.pending.size) return;
    const wait = Math.max(0, this._holdUntil - this.timers.now());
    this._pumpTimer = this.timers.setTimeout(() => {
      this._pumpTimer = null;
      this._pump();
    }, wait || 0);
  }

  _pump() {
    if (!this.connected) return;
    if (this.paced && this.timers.now() < this._holdUntil) {
      this._schedule();
      return;
    }
    let sent = 0;
    for (const k of Array.from(this.pending)) {
      if (this.paced && sent >= this.batch) break;
      this.pending.delete(k);
      const color = this.desired.get(k);
      const [x, y] = k.split(',').map(Number);
      if (!this._send(this.profile.encode(x, y, color))) return; // Disconnected
      this.leds.set(k, color);
      sent++;
    }
    if (this.pending.size && this.paced && !this._pumpTimer) {
      this._pumpTimer = this.timers.setTimeout(() => {
        this._pumpTimer = null;
        this._pump();
      }, this.tickMs);
    }
  }

  allOff() {
    for (const k of this.desired.keys()) this.desired.set(k, 'OFF');
    if (!this.connected) return;
    this.pending.clear();
    this._sendAll(this.profile.allOff());
    for (const k of this.desired.keys()) this.leds.set(k, 'OFF');
  }
}

module.exports = { LaunchpadManager };
