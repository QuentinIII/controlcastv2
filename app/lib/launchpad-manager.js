'use strict';

/*
 * Finds, connects to and talks with a Launchpad.
 *
 * - Hot-plug is detected by polling the MIDI port list (cheap, and much more
 *   reliable on Windows 11 than USB events, also after sleep / resume).
 * - Only LED changes are sent (per-button cache) to keep the USB MIDI link quiet.
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
    this.leds = new Map(); // "x,y" -> color currently shown on the device
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
    if (!this.connected) return;
    const k = `${x},${y}`;
    if (!force && this.leds.get(k) === colorName) return;
    if (this._send(this.profile.encode(x, y, colorName))) this.leds.set(k, colorName);
  }

  allOff() {
    if (!this.connected) return;
    this._sendAll(this.profile.allOff());
    for (const k of this.leds.keys()) this.leds.set(k, 'OFF');
  }
}

module.exports = { LaunchpadManager };
