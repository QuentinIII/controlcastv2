'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Hotkeys, resolveKey } = require('../app/main/hotkeys');

function fakeRobot() {
  const calls = [];
  return { calls, keyToggle: (k, a) => calls.push(`${k}:${a}`), setKeyboardDelay: () => {} };
}

const quiet = { info() {}, warn() {}, error() {} };

test('resolves ControlCast key names to robotjs names', () => {
  assert.strictEqual(resolveKey('L-CTRL'), 'control');
  assert.strictEqual(resolveKey('R-SHIFT'), 'right_shift');
  assert.strictEqual(resolveKey('L-ALT'), 'alt');
  assert.strictEqual(resolveKey('NUMPAD 5'), 'numpad_5');
  assert.strictEqual(resolveKey('NUMPAD +'), 'numpad_+');
  assert.strictEqual(resolveKey('PAGE UP'), 'pageup');
  assert.strictEqual(resolveKey('F13'), 'f13');
});

test('send presses in order and releases in reverse order', async () => {
  const robot = fakeRobot();
  const h = new Hotkeys({ robot, logger: quiet, stepMs: 0, holdMs: 0 });
  await h.send('L-CTRL + L-SHIFT + F1');
  assert.deepStrictEqual(robot.calls, [
    'control:down', 'shift:down', 'f1:down', 'f1:up', 'shift:up', 'control:up',
  ]);
});

test('a held modifier is not released by another key using it', async () => {
  const robot = fakeRobot();
  const h = new Hotkeys({ robot, logger: quiet, stepMs: 0, holdMs: 0 });
  await h.down('L-CTRL');
  await h.send('L-CTRL + M');
  assert.ok(!robot.calls.includes('control:up'));
  await h.up('L-CTRL');
  assert.strictEqual(robot.calls[robot.calls.length - 1], 'control:up');
});

test('releaseAll frees stuck keys; robot errors do not throw', async () => {
  const robot = fakeRobot();
  const h = new Hotkeys({ robot, logger: quiet, stepMs: 0, holdMs: 0 });
  await h.down('L-ALT + X');
  await h.releaseAll();
  assert.ok(robot.calls.includes('alt:up') && robot.calls.includes('x:up'));
  robot.keyToggle = () => {
    throw new Error('Invalid key code specified.');
  };
  await h.send('WEIRD');
  const none = new Hotkeys({ robot: null, logger: quiet });
  await none.send('A');
  assert.strictEqual(none.available, false);
});
