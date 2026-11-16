'use strict';

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const P = require('../app/lib/launchpad-profiles');
const { LaunchpadManager } = require('../app/lib/launchpad-manager');

test('classic protocol matches the original launchpadder mapping', () => {
  assert.deepStrictEqual(P.classic.encode(0, 0, 'RED'), [0x90, 0, 15]);
  assert.deepStrictEqual(P.classic.encode(3, 2, 'GREEN'), [0x90, 35, 60]);
  assert.deepStrictEqual(P.classic.encode(8, 7, 'AMBER'), [0x90, 120, 63]);
  assert.deepStrictEqual(P.classic.encode(2, 8, 'OFF'), [0xB0, 106, 12]);
  assert.strictEqual(P.classicVelocity('YELLOW'), 62);
  assert.strictEqual(P.classicVelocity('LOW_GREEN'), 28);
  assert.strictEqual(P.classicVelocity('LOW_AMBER'), 29);
  assert.strictEqual(P.classicVelocity('LOW_RED'), 13);
  assert.deepStrictEqual(P.classic.decode([0x90, 35, 127]), { x: 3, y: 2, pressed: true });
  assert.deepStrictEqual(P.classic.decode([0x90, 35, 0]), { x: 3, y: 2, pressed: false });
  assert.deepStrictEqual(P.classic.decode([0x80, 120, 64]), { x: 8, y: 7, pressed: false });
  assert.deepStrictEqual(P.classic.decode([0xB0, 111, 127]), { x: 7, y: 8, pressed: true });
  assert.strictEqual(P.classic.decode([0xB0, 0, 0]), null);
});

test('every profile round-trips all 80 buttons', () => {
  for (const profile of P.PROFILES) {
    for (let x = 0; x <= 8; x++) {
      for (let y = 0; y <= 8; y++) {
        if (x === 8 && y === 8) continue;
        const [status, d1] = profile.encode(x, y, 'GREEN');
        const ev = profile.decode([status, d1, 127]);
        assert.deepStrictEqual(ev, { x, y, pressed: true }, `${profile.id} ${x},${y}`);
        assert.strictEqual(profile.decode([status, d1, 0]).pressed, false);
      }
    }
  }
});

test('device detection by port name', () => {
  assert.strictEqual(P.detectProfile('Launchpad Mini').id, 'classic');
  assert.strictEqual(P.detectProfile('Launchpad S').id, 'classic');
  assert.strictEqual(P.detectProfile('Launchpad').id, 'classic');
  assert.strictEqual(P.detectProfile('Launchpad MK2').id, 'mk2');
  assert.strictEqual(P.detectProfile('LPMiniMK3 MIDI').id, 'mini-mk3');
  assert.strictEqual(P.detectProfile('MIDIIN2 (LPMiniMK3 MIDI)').id, 'mini-mk3');
  assert.strictEqual(P.detectProfile('LPX MIDI').id, 'x');
  assert.strictEqual(P.detectProfile('LPProMK3 MIDI').id, 'pro-mk3');
  assert.strictEqual(P.detectProfile('Launchpad Pro').id, 'pro');
  assert.strictEqual(P.detectProfile('Microsoft GS Wavetable Synth'), null);
});

test('pickPort prefers the MIDI interface (not DAW) for RGB devices on Windows', () => {
  const p = P.pickPort(['Microsoft GS Wavetable Synth', 'LPMiniMK3 MIDI', 'MIDIOUT2 (LPMiniMK3 MIDI)']);
  assert.strictEqual(p.index, 2);
  const mac = P.pickPort(['LPMiniMK3 DAW Out', 'LPMiniMK3 MIDI Out']);
  assert.strictEqual(mac.index, 1);
  const classic = P.pickPort(['Other', 'Launchpad Mini']);
  assert.strictEqual(classic.index, 1);
});

// Fake @julusian/midi
function fakeMidi() {
  const state = { inputs: [], outputs: [], sent: [], openIn: null, failOpen: false };
  class Input extends EventEmitter {
    static getPortNames() {
      return state.inputs.slice();
    }
    openPort(i) {
      if (state.failOpen) throw new Error('busy');
      state.openIn = this;
      this.port = i;
    }
    closePort() {
      if (state.openIn === this) state.openIn = null;
    }
  }
  class Output {
    static getPortNames() {
      return state.outputs.slice();
    }
    openPort(i) {
      this.port = i;
    }
    closePort() {}
    sendMessage(m) {
      state.sent.push(m);
    }
  }
  return { state, midi: { Input, Output } };
}

const quiet = { info() {}, warn() {}, error() {} };

test('manager: hot-plug, events, LED de-duplication, port busy, unplug', () => {
  const { state, midi } = fakeMidi();
  const lp = new LaunchpadManager({ midi, logger: quiet });
  const events = [];
  lp.on('connected', i => events.push(['connected', i.profile]));
  lp.on('disconnected', () => events.push(['disconnected']));
  lp.on('press', k => events.push(['press', k]));
  lp.on('error-message', () => events.push(['error']));

  lp.poll();
  assert.strictEqual(lp.connected, false);

  state.inputs = ['Launchpad Mini'];
  state.outputs = ['Launchpad Mini'];
  state.failOpen = true;
  lp.poll();
  lp.poll(); // Error reported once only
  assert.deepStrictEqual(events, [['error']]);

  state.failOpen = false;
  lp.poll();
  assert.strictEqual(lp.connected, true);
  assert.deepStrictEqual(state.sent[0], [0xB0, 0, 0]); // reset on connect

  state.openIn.emit('message', 0, [0x90, 17, 127]);
  assert.deepStrictEqual(events.slice(-1)[0], ['press', [1, 1]]);

  state.sent = [];
  lp.setLed(1, 1, 'RED');
  lp.setLed(1, 1, 'RED');
  lp.setLed(1, 1, 'GREEN');
  assert.strictEqual(state.sent.length, 2);

  state.inputs = [];
  state.outputs = [];
  lp.poll();
  assert.strictEqual(lp.connected, false);
  assert.deepStrictEqual(events.slice(-1)[0], ['disconnected']);
  lp.setLed(1, 1, 'RED'); // No crash while disconnected
});
