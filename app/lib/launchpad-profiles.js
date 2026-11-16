'use strict';

/*
 * MIDI protocol for each Launchpad family.
 *
 * ControlCast coordinates:
 *   x 0-7, y 0-7 : main 8x8 grid (y = 0 is the top row)
 *   x = 8        : right column of round buttons (y 0-7)
 *   y = 8        : top row of round buttons (x 0-7)
 */

const { COLORS, normalizeColor } = require('./colors');

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CC = 0xB0;

function classicVelocity(colorName) {
  const c = COLORS[normalizeColor(colorName)];
  return (16 * c.green) + c.red + 12; // +12 = "copy + clear" flags (normal display)
}

// Launchpad MK1 / S / Mini (MK1 & MK2)
const classic = {
  id: 'classic',
  label: 'Launchpad (MK1 / S / Mini)',
  init: () => [[CC, 0, 0]], // Reset
  shutdown: () => [[CC, 0, 0]],
  allOff: () => [[CC, 0, 0]],
  encode(x, y, colorName) {
    const v = classicVelocity(colorName);
    if (y === 8) return [CC, 104 + x, v];
    return [NOTE_ON, (y * 16) + x, v];
  },
  decode(msg) {
    const type = msg[0] & 0xF0;
    const d1 = msg[1];
    const d2 = msg[2] || 0;
    if (type === CC) {
      if (d1 >= 104 && d1 <= 111) return { x: d1 - 104, y: 8, pressed: d2 > 0 };
      return null;
    }
    if (type === NOTE_ON || type === NOTE_OFF) {
      const x = d1 % 16;
      const y = Math.floor(d1 / 16);
      if (x > 8 || y > 7) return null;
      return { x, y, pressed: type === NOTE_ON && d2 > 0 };
    }
    return null;
  },
};

function gridNote(x, y) {
  return ((8 - y) * 10) + x + 1;
}

function rgbAllOff(profile) {
  const msgs = [];
  for (let x = 0; x <= 8; x++) {
    for (let y = 0; y <= 8; y++) {
      if (x === 8 && y === 8) continue;
      msgs.push(profile.encode(x, y, 'OFF'));
    }
  }
  return msgs;
}

function decodeProgrammer(msg, sideIsNote, topBase) {
  const type = msg[0] & 0xF0;
  const d1 = msg[1];
  const d2 = msg[2] || 0;
  const pressed = d2 > 0 && type !== NOTE_OFF;
  if (type === CC) {
    if (d1 >= topBase && d1 <= topBase + 7) return { x: d1 - topBase, y: 8, pressed };
    if (!sideIsNote && d1 % 10 === 9 && d1 >= 19 && d1 <= 89) {
      return { x: 8, y: 8 - Math.floor(d1 / 10), pressed };
    }
    return null;
  }
  if (type === NOTE_ON || type === NOTE_OFF) {
    const col = d1 % 10;
    const row = Math.floor(d1 / 10);
    if (row < 1 || row > 8) return null;
    if (col >= 1 && col <= 8) return { x: col - 1, y: 8 - row, pressed };
    if (sideIsNote && col === 9) return { x: 8, y: 8 - row, pressed };
  }
  return null;
}

// Launchpad Mini MK3 / X / Pro MK3 / Pro (programmer mode, RGB palette)
function programmer(id, label, deviceId, enterMsg, exitMsg) {
  const profile = {
    id,
    label,
    init: () => [enterMsg],
    shutdown: () => [...rgbAllOff(profile), exitMsg],
    allOff: () => rgbAllOff(profile),
    encode(x, y, colorName) {
      const v = COLORS[normalizeColor(colorName)].rgb;
      if (y === 8) return [CC, 91 + x, v];
      if (x === 8) return [CC, ((8 - y) * 10) + 9, v];
      return [NOTE_ON, gridNote(x, y), v];
    },
    decode: msg => decodeProgrammer(msg, false, 91),
  };
  profile.deviceId = deviceId;
  return profile;
}

const sysex = (...bytes) => [0xF0, 0x00, 0x20, 0x29, 0x02, ...bytes, 0xF7];

const miniMk3 = programmer('mini-mk3', 'Launchpad Mini MK3', 0x0D, sysex(0x0D, 0x0E, 0x01), sysex(0x0D, 0x0E, 0x00));
const lpx = programmer('x', 'Launchpad X', 0x0C, sysex(0x0C, 0x0E, 0x01), sysex(0x0C, 0x0E, 0x00));
const proMk3 = programmer('pro-mk3', 'Launchpad Pro MK3', 0x0E, sysex(0x0E, 0x0E, 0x01), sysex(0x0E, 0x0E, 0x00));
const pro = programmer('pro', 'Launchpad Pro', 0x10, sysex(0x10, 0x2C, 0x03), sysex(0x10, 0x2C, 0x00));

// Launchpad MK2 (session layout: side buttons are notes, top row is CC 104-111)
const mk2 = {
  id: 'mk2',
  label: 'Launchpad MK2',
  init: () => [sysex(0x18, 0x22, 0x00)],
  shutdown: () => rgbAllOff(mk2),
  allOff: () => rgbAllOff(mk2),
  encode(x, y, colorName) {
    const v = COLORS[normalizeColor(colorName)].rgb;
    if (y === 8) return [CC, 104 + x, v];
    if (x === 8) return [NOTE_ON, ((8 - y) * 10) + 9, v];
    return [NOTE_ON, gridNote(x, y), v];
  },
  decode: msg => decodeProgrammer(msg, true, 104),
};

const PROFILES = [miniMk3, lpx, proMk3, pro, mk2, classic];

const MATCHERS = [
  { re: /lpminimk3|mini ?mk3/i, profile: miniMk3 },
  { re: /lppromk3|pro ?mk3/i, profile: proMk3 },
  { re: /\blpx\b|launchpad ?x\b/i, profile: lpx },
  { re: /launchpad ?pro/i, profile: pro },
  { re: /launchpad ?mk2/i, profile: mk2 },
  { re: /launchpad/i, profile: classic },
];

function detectProfile(portName) {
  if (!portName) return null;
  for (const m of MATCHERS) {
    if (m.re.test(portName)) return m.profile;
  }
  return null;
}

/*
 * Pick the best port for a direction among the port names.
 * Returns { index, name, profile } or null.
 * RGB devices expose a "DAW" and a "MIDI" interface: programmer mode works on
 * the MIDI one (on Windows it is named "MIDIIN2 (...)" / "MIDIOUT2 (...)").
 */
function pickPort(names) {
  const found = [];
  names.forEach((name, index) => {
    const profile = detectProfile(name);
    if (profile) found.push({ index, name, profile });
  });
  if (!found.length) return null;
  const score = (p) => {
    const n = p.name.toLowerCase();
    if (p.profile === classic || p.profile === mk2) {
      return /midi(in|out)\d/.test(n) ? 1 : 2; // Plain port first
    }
    let s = 1;
    if (/midi(in|out)2/.test(n)) s += 2;
    if (/\bmidi\b/.test(n.replace(/midi(in|out)\d/g, ''))) s += 1;
    if (/\bdaw\b/.test(n)) s -= 2;
    return s;
  };
  found.sort((a, b) => score(b) - score(a) || a.index - b.index);
  return found[0];
}

module.exports = { PROFILES, detectProfile, pickPort, classic, mk2, miniMk3, lpx, proMk3, pro, classicVelocity };
