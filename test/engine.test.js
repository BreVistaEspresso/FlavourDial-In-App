import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROFILE,
  timeWindow,
  classifyTaste,
  diagnose,
  nextShotFrom,
  learnSensitivity,
  learnRatio,
} from '../src/engine.js';

const shot = (over = {}) => ({
  dose: 18, yield: 36, time: 28, grind: 10, roast: 'medium',
  prep: 'wdt_tamp', screen: false, temp: 'fixed', notes: ['sour'],
  ...over,
});
const stepped = { ...DEFAULT_PROFILE, grinder: 'stepped', finerIs: 'lower' };

test('timeWindow is 25-32s at 1:2 and grows with ratio', () => {
  const w = timeWindow(2);
  assert.equal(w.lo, 25);
  assert.equal(w.hi, 32);
  assert.ok(timeWindow(3).lo > w.lo);
  assert.ok(timeWindow(1).hi < w.hi);
});

test('validation: missing notes and bad dose are rejected', () => {
  assert.equal(diagnose({ shot: shot({ notes: [] }), profile: stepped }).ok, false);
  assert.equal(diagnose({ shot: shot({ dose: 0 }), profile: stepped }).ok, false);
});

test('sour + fast shot: grind finer (regression: fast threshold used to be read before it was defined)', () => {
  const r = diagnose({ shot: shot({ time: 18 }), profile: stepped });
  assert.equal(r.primary.type, 'grind');
  assert.equal(r.primary.changes.grind.dir, 'finer');
  assert.equal(r.primary.changes.grind.to, 10 - r.primary.changes.grind.steps);
});

test('bitter + fast shot flags channeling and fixes prep, not grind', () => {
  const r = diagnose({ shot: shot({ time: 18, notes: ['bitter'] }), profile: stepped });
  assert.equal(r.channeling, true);
  assert.equal(r.primary.type, 'prep');
});

test('sour + slow shot does not say grind finer', () => {
  const r = diagnose({ shot: shot({ time: 40 }), profile: stepped });
  assert.equal(r.primary.type, 'prep');
});

test('sour + slow with maxed prep falls back to a longer shot', () => {
  const r = diagnose({ shot: shot({ time: 40, prep: 'shaker_wdt_tamp', screen: true }), profile: stepped });
  assert.equal(r.primary.type, 'yield');
  assert.ok(r.primary.changes.yield.to > 36);
});

test('bitter + slow shot: grind coarser, bigger step when further from window', () => {
  const near = diagnose({ shot: shot({ time: 34, notes: ['bitter'] }), profile: stepped });
  const far = diagnose({ shot: shot({ time: 48, notes: ['bitter'] }), profile: stepped });
  assert.equal(near.primary.changes.grind.dir, 'coarser');
  assert.ok(far.primary.changes.grind.steps > near.primary.changes.grind.steps);
});

test('sour + in-range upper half: lengthen the shot instead of grinding finer', () => {
  const r = diagnose({ shot: shot({ time: 31 }), profile: stepped });
  assert.equal(r.primary.type, 'yield');
  assert.ok(r.primary.changes.yield.to > 36);
});

test('sour + in-range lower half: grind finer', () => {
  const r = diagnose({ shot: shot({ time: 26 }), profile: stepped });
  assert.equal(r.primary.type, 'grind');
});

test('dark roast bitter in range: shorten the shot (one change, no stacked advice)', () => {
  const r = diagnose({ shot: shot({ roast: 'dark', notes: ['bitter'], time: 28, temp: 'medium' }), profile: stepped });
  assert.equal(r.primary.type, 'yield');
  assert.ok(r.primary.changes.yield.to < 36);
  assert.equal(r.primary.changes.grind, undefined);
});

test('mixed sour + bitter: fix prep first, then slow-feed when prep is maxed', () => {
  const a = diagnose({ shot: shot({ notes: ['sour', 'bitter'] }), profile: stepped });
  assert.equal(a.primary.type, 'prep');
  assert.equal(a.primary.changes.screen, true); // WDT already used, so the next upgrade is a puck screen
  const b = diagnose({ shot: shot({ notes: ['sour', 'bitter'], prep: 'wdt_tamp', screen: true }), profile: stepped });
  assert.equal(b.primary.type, 'prep');
  assert.match(b.primary.headline, /Slow-feed/);
});

test('mixed notes on a slow shot are treated as choking, so grind coarser', () => {
  const r = diagnose({ shot: shot({ notes: ['sour', 'bitter'], time: 42 }), profile: stepped });
  assert.equal(r.primary.changes.grind.dir, 'coarser');
});

test('balanced shot: lock it in; watery body shortens the shot', () => {
  const ok = diagnose({ shot: shot({ notes: ['sweet', 'chocolate'] }), profile: stepped });
  assert.equal(ok.lockIn, true);
  const thin = diagnose({ shot: shot({ notes: ['sweet', 'watery'] }), profile: stepped });
  assert.equal(thin.primary.type, 'yield');
  assert.ok(thin.primary.changes.yield.to < 36);
});

test('balanced notes outweighing a mild off-note still read as balanced', () => {
  const t = classifyTaste(['sweet', 'chocolate', 'caramel', 'sour'], 'medium');
  assert.equal(t.dir, 'balanced');
  assert.equal(t.minor, 'under');
});

test('one change per shot: never returns both a grind and a yield change', () => {
  for (const notes of [['sour'], ['bitter'], ['sour', 'bitter'], ['sweet', 'watery']]) {
    for (const time of [15, 22, 28, 34, 45]) {
      const r = diagnose({ shot: shot({ notes, time }), profile: stepped });
      const keys = Object.keys(r.primary.changes);
      assert.ok(keys.length <= 1, `${notes} @${time}s -> ${keys}`);
    }
  }
});

test('grind direction follows the grinder: higher number = finer', () => {
  const p = { ...stepped, finerIs: 'higher' };
  const r = diagnose({ shot: shot({ time: 18 }), profile: p });
  assert.ok(r.primary.changes.grind.to > 10);
});

test('calibrated sensitivity sets the step count from the time gap', () => {
  const p = { ...stepped, sensitivity: 2 };
  const r = diagnose({ shot: shot({ time: 20 }), profile: p });
  assert.equal(r.primary.changes.grind.steps, 4); // (28.5 - 20) / 2 = 4.25
  assert.equal(r.primary.changes.grind.to, 6);
  assert.match(r.primary.detail, /near \d+s/);
});

test('stepless uncalibrated gives a size label, not a click count', () => {
  const p = { ...DEFAULT_PROFILE, grinder: 'stepless' };
  const r = diagnose({ shot: shot({ time: 18 }), profile: p });
  assert.equal(r.primary.changes.grind.steps, null);
  assert.equal(r.primary.changes.grind.to, null);
  assert.match(r.primary.detail, /nudge|move/);
});

test('stepless calibrated gives a decimal target', () => {
  const p = { ...DEFAULT_PROFILE, grinder: 'stepless', sensitivity: 20 };
  const r = diagnose({ shot: shot({ time: 20, grind: 2 }), profile: p });
  assert.ok(r.primary.changes.grind.steps < 1);
  assert.ok(r.primary.changes.grind.to < 2);
});

test('overshoot: sour last time, bitter now -> go back about halfway', () => {
  const prev = { dir: 'under', grind: 10, time: 22, dose: 18, yield: 36 };
  const r = diagnose({ shot: shot({ grind: 6, time: 29, notes: ['bitter'] }), profile: stepped, prev });
  assert.equal(r.primary.type, 'revert');
  assert.equal(r.primary.changes.grind.to, 8);
});

test('temperature advice only appears when the machine temp is adjustable', () => {
  const fixed = diagnose({ shot: shot({ roast: 'light', time: 18, temp: 'fixed' }), profile: stepped });
  assert.equal(fixed.notes.some((n) => /temperature/i.test(n.text)), false);
  const adj = diagnose({ shot: shot({ roast: 'light', time: 18, temp: 'medium' }), profile: stepped });
  assert.equal(adj.notes.some((n) => /temperature/i.test(n.text)), true);
});

test('learnSensitivity: finer grind lengthened the shot', () => {
  const prev = { grind: 10, time: 20, dose: 18, yield: 36 };
  const cur = { grind: 8, time: 28, dose: 18, yield: 36 };
  assert.equal(learnSensitivity(prev, cur, stepped), 4);
});

test('learnSensitivity ignores pairs where the ratio also changed or time went the wrong way', () => {
  const prev = { grind: 10, time: 20, dose: 18, yield: 36 };
  assert.equal(learnSensitivity(prev, { grind: 8, time: 28, dose: 18, yield: 42 }, stepped), null);
  assert.equal(learnSensitivity(prev, { grind: 8, time: 15, dose: 18, yield: 36 }, stepped), null);
});

test('nextShotFrom applies the change and clears time and notes', () => {
  const s = shot({ time: 18 });
  const r = diagnose({ shot: s, profile: stepped });
  const next = nextShotFrom(s, r.primary);
  assert.equal(next.grind, r.primary.changes.grind.to);
  assert.equal(next.time, '');
  assert.deepEqual(next.notes, []);
});

test('learnRatio blends toward the locked-in ratio', () => {
  assert.equal(learnRatio({ prefRatio: null }, 2.2), 2.2);
  assert.equal(learnRatio({ prefRatio: 2 }, 2.5), 2.2);
});
