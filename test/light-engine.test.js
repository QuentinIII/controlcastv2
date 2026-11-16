'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { LightEngine } = require('../app/lib/light-engine');

function engine() {
  let now = 0;
  const intervals = new Map();
  const timeouts = new Map();
  let id = 0;
  const out = [];
  const timers = {
    setInterval: (fn, ms) => {
      intervals.set(++id, { fn, ms });
      return id;
    },
    clearInterval: i => intervals.delete(i),
    setTimeout: (fn, ms) => {
      timeouts.set(++id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: i => timeouts.delete(i),
  };
  const e = new LightEngine({ output: (k, c) => out.push(`${k.join(',')}=${c}`), now: () => now, timers });
  const advance = ms => {
    const end = now + ms;
    while (now < end) {
      now += 10;
      for (const [i, t] of Array.from(timeouts)) {
        if (t.at <= now) {
          timeouts.delete(i);
          t.fn();
        }
      }
      for (const t of intervals.values()) {
        if (now % t.ms === 0) t.fn();
      }
    }
  };
  return { e, out, advance, intervals };
}

test('press colour has priority and returns to idle colour', () => {
  const { e, out } = engine();
  e.setBase([0, 0], 'GREEN');
  e.setPressed([0, 0], 'RED');
  e.setPressed([0, 0], null);
  assert.deepStrictEqual(out, ['0,0=GREEN', '0,0=RED', '0,0=GREEN']);
});

test('blinks while the sound plays, then stops the timer', () => {
  const { e, out, advance, intervals } = engine();
  e.setBase([1, 1], 'OFF');
  e.setPlaying([1, 1], { mode: 'blink', color: 'RED', color2: 'OFF', rate: 'normal' }); // 500ms period
  assert.strictEqual(intervals.size, 1);
  advance(1000);
  const seq = out.filter(x => x.startsWith('1,1'));
  // OFF (base) -> RED -> OFF -> RED -> OFF -> RED within one second
  assert.ok(seq.length >= 4, seq.join(' '));
  assert.ok(seq.includes('1,1=RED') && seq.includes('1,1=OFF'));
  e.setPlaying([1, 1], null);
  assert.strictEqual(intervals.size, 0);
  assert.strictEqual(e.compute([1, 1]), 'OFF');
});

test('pulse goes through dim levels', () => {
  const { e } = engine();
  e.setPlaying([2, 2], { mode: 'pulse', color: 'GREEN', rate: 'normal' });
  const seen = new Set([0, 125, 250, 375].map(t => e.compute([2, 2], t)));
  assert.deepStrictEqual(Array.from(seen).sort(), ['GREEN', 'LOW_GREEN', 'OFF'].sort());
});

test('status flash overrides then expires; toggle latch', () => {
  const { e, advance } = engine();
  e.setBase([3, 3], 'AMBER');
  e.setStatus([3, 3], 'GREEN', 1500);
  assert.strictEqual(e.compute([3, 3]), 'GREEN');
  advance(1600);
  assert.strictEqual(e.compute([3, 3]), 'AMBER');
  e.setLatched([3, 3], 'RED');
  assert.strictEqual(e.isLatched([3, 3]), true);
  assert.strictEqual(e.compute([3, 3]), 'RED');
  e.setLatched([3, 3], null);
  assert.strictEqual(e.compute([3, 3]), 'AMBER');
});

test('only changed colours are output', () => {
  const { e, out } = engine();
  e.setBase([4, 4], 'RED');
  e.setBase([4, 4], 'RED');
  e.renderAll();
  assert.deepStrictEqual(out, ['4,4=RED']);
  e.renderAll(true);
  assert.deepStrictEqual(out, ['4,4=RED', '4,4=RED']);
});
