const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createShakeController } = require('../public/shake-controller');

const empty = () => Array.from({ length: 6 }, () => [false, false, false]);

test('start and repeated ticks roll only the first (bottom) line', () => {
  let draws = 0;
  const shake = createShakeController({ random: () => { draws++; return 0.1; } });
  const initial = shake.snapshot();
  assert.deepEqual(initial.coins, empty());
  const started = shake.start();
  assert.deepEqual(started.coins[0], [true, true, true]);
  assert.deepEqual(started.coins.slice(1), empty().slice(1));
  assert.equal(draws, 3);
  for (let n = 0; n < 12; n++) shake.tick();
  assert.equal(draws, 39);
  assert.deepEqual(shake.snapshot().coins.slice(1), empty().slice(1));
  assert.deepEqual(initial.coins, empty(), 'snapshots must not be mutated');
});

test('each manual stop freezes one line and rolls only the next, from bottom to top', () => {
  let sample = 0.1;
  let captures = 0;
  const shake = createShakeController({ random: () => sample, captureTime: () => {
    captures++;
    return { display: '2026年09月23日 10:11:12', instant: 'frozen-on-sixth-stop' };
  } });
  shake.start();
  const frozen = [];
  for (let line = 0; line < 6; line++) {
    sample = line % 2 ? 0.9 : 0.1;
    const rolling = shake.tick();
    assert.equal(rolling.phase, 'rolling');
    assert.deepEqual(rolling.coins.slice(0, line), frozen);
    assert.deepEqual(rolling.coins.slice(line + 1), empty().slice(line + 1));
    frozen.push([...rolling.coins[line]]);
    // The next line is freshly sampled; no frozen line is redrawn.
    sample = 0.1;
    const next = shake.stopNext();
    assert.equal(next.stopped, line + 1);
    assert.deepEqual(next.coins.slice(0, line + 1), frozen);
    assert.equal(captures, line === 5 ? 1 : 0);
    if (line < 5) {
      assert.equal(next.phase, 'rolling');
      assert.deepEqual(next.coins[line + 1], [true, true, true]);
      assert.deepEqual(next.coins.slice(line + 2), empty().slice(line + 2));
    }
  }
  const finished = shake.snapshot();
  assert.equal(finished.phase, 'complete');
  for (let n = 0; n < 6; n++) { shake.tick(); shake.stopNext(); }
  assert.deepEqual(shake.snapshot(), finished);
  assert.equal(captures, 1);
});

test('all eight independent coin combinations remain possible for a line', () => {
  for (let mask = 0; mask < 8; mask++) {
    let c = 0;
    const shake = createShakeController({ random: () => (mask & (1 << c++)) ? 0.1 : 0.9 });
    assert.deepEqual(shake.start().coins[0], [0, 1, 2].map(i => Boolean(mask & (1 << i))));
  }
});

test('reset during rolling clears every line and restarting begins at first line', () => {
  const shake = createShakeController({ random: () => 0.1, captureTime: () => ({ display: 'time' }) });
  shake.start(); shake.stopNext(); shake.stopNext();
  assert.deepEqual(shake.reset(), { phase: 'idle', stopped: 0, coins: empty(), completedAt: null, timeError: false });
  assert.equal(shake.tick().phase, 'idle');
  assert.equal(shake.stopNext().stopped, 0);
  assert.equal(shake.start().stopped, 0);
  assert.deepEqual(shake.snapshot().coins.slice(1), empty().slice(1));
  for (let i = 0; i < 6; i++) shake.stopNext();
  const restarted = shake.start();
  assert.equal(restarted.completedAt, null);
  assert.equal(restarted.phase, 'rolling');
  assert.deepEqual(restarted.coins.slice(1), empty().slice(1));
});

test('a failed time capture is reported only at the sixth stop', () => {
  const shake = createShakeController({ captureTime: () => { throw Error('clock unavailable'); } });
  shake.start();
  for (let i = 0; i < 5; i++) assert.equal(shake.stopNext().timeError, false);
  const done = shake.stopNext();
  assert.equal(done.timeError, true);
  assert.equal(done.completedAt, null);
  assert.equal(done.phase, 'complete');
});

test('coin UI keeps face graphics, one active line and reduced-motion support', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
  const app = read('app.js');
  assert.match(app, /i===state\.stopped/);
  assert.doesNotMatch(app, /i>=state\.stopped/);
  assert.doesNotMatch(app, /el\.textContent=label/);
  assert.match(app, /coinFaceHTML\(i,c,false\)\+coinFaceHTML\(i,c,true\)/);
  assert.match(app, /aria-label.*枚铜钱/);
  assert.match(app, /state\.completedAt,ICHING_TEXT/);
  const css = read('app.css');
  assert.match(css, /@keyframes coinFlip/);
  assert.match(css, /backface-visibility:hidden/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(read('index.html'), /每次只翻转当前一行/);
});
