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
  startRatio,
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

test('bitter + fast shot is not channelling: shorter ratio, no prep lever (example 10)', () => {
  const r = diagnose({ shot: shot({ time: 19, notes: ['bitter'], prep: 'shaker_wdt_tamp', screen: true }), profile: stepped });
  assert.equal(r.channeling, false);
  assert.equal(r.channelling.level, 'possible');
  assert.equal(r.primary.type, 'yield');
  assert.equal(r.primary.changes.yield.to, 31.5);
});

test('sour + slow: no grind finer, longer ratio plus an "unusual" note, not channelling (example 8)', () => {
  const r = diagnose({ shot: shot({ time: 36 }), profile: stepped });
  assert.equal(r.channeling, false);
  assert.equal(r.primary.type, 'yield');
  assert.equal(r.primary.changes.yield.to, 40.5);
  assert.ok(r.notes.some((n) => /slow and sour/i.test(n.text)));
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

test('mixed in window, ratio in range: likely channelling, shaker is rung 2 (example 5)', () => {
  const r = diagnose({ shot: shot({ notes: ['sour', 'bitter'] }), profile: stepped });
  assert.equal(r.channelling.level, 'likely');
  assert.equal(r.channeling, true);
  assert.equal(r.primary.type, 'prep');
  assert.equal(r.primary.key, 'prep:shaker');
  assert.equal(r.primary.changes.prep, 'shaker_wdt_tamp');
  assert.match(r.primary.detail, /not a diagnosis/);
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

/* ---------- algorithm v2 (docs/ALGORITHM.md) ---------- */

const DAY = 24 * 3600 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

test('salty alone reads balanced: lock it in (example 1)', () => {
  const r = diagnose({ shot: shot({ notes: ['salty'] }), profile: stepped });
  assert.equal(r.lockIn, true);
});

test('salty never offsets a real off-note (example 3)', () => {
  const r = diagnose({ shot: shot({ notes: ['sour', 'salty'], time: 20 }), profile: stepped });
  assert.equal(r.taste.dir, 'under');
  assert.equal(r.primary.changes.grind.dir, 'finer');
});

test('salty + heavy with a short ratio: lengthen to the roast low (example 2)', () => {
  const r = diagnose({ shot: shot({ yield: 28, time: 24, notes: ['salty', 'heavy'] }), profile: stepped });
  assert.equal(r.primary.type, 'yield');
  assert.equal(r.primary.changes.yield.to, 31.5);
  assert.equal(r.primary.changes.grind, undefined);
});

test('choking bitter shot: large coarser step, labelled (example 7)', () => {
  const r = diagnose({ shot: shot({ time: 41, notes: ['bitter'] }), profile: stepped });
  assert.match(r.primary.headline, /choking/);
  assert.equal(r.primary.changes.grind.steps, 3);
});

test('mixed + fast + shaker/WDT/screen missing: strong channelling, prep leads, grind held (example 4)', () => {
  const r = diagnose({ shot: shot({ notes: ['sour', 'sour', 'bitter'], time: 19, prep: 'wdt_tamp', screen: true }), profile: stepped });
  assert.equal(r.channelling.level, 'strong');
  assert.equal(r.primary.key, 'prep:shaker');
  assert.match(r.then, /only if still off/);
});

test('mixed + slow: grind coarser leads, prep rung follows (example 6)', () => {
  const r = diagnose({ shot: shot({ notes: ['sour', 'bitter'], time: 36 }), profile: stepped });
  assert.equal(r.primary.changes.grind.dir, 'coarser');
  assert.match(r.then, /prep/i);
});

test('sour + fast alone is possible, not channelling: grind finer, prep as a note (example 9)', () => {
  const r = diagnose({ shot: shot({ time: 19 }), profile: stepped });
  assert.equal(r.channelling.level, 'possible');
  assert.equal(r.primary.changes.grind.dir, 'finer');
  assert.ok(r.notes.some((n) => /shaker/i.test(n.text)));
});

test('ladder exhausted: escalate to a small grind step (example 11)', () => {
  const prev = { lever: 'prep:slowfeed', cls: 'mixed', dir: 'mixed', prep: 'shaker_wdt_tamp', screen: true, dose: 18, yield: 36, grind: 10 };
  const r = diagnose({ shot: shot({ notes: ['sour', 'bitter'], prep: 'shaker_wdt_tamp', screen: true }), profile: stepped, prev });
  assert.equal(r.primary.type, 'grind');
  assert.match(r.primary.detail, /different bag/);
});

test('ladder walks WDT, shaker, screen, slow-feed', () => {
  const key = (over) => diagnose({ shot: shot({ notes: ['sour', 'bitter'], ...over }), profile: stepped }).primary.key;
  assert.equal(key({ prep: 'tamp' }), 'prep:wdt');
  assert.equal(key({ prep: 'wdt_tamp' }), 'prep:shaker');
  assert.equal(key({ prep: 'shaker_wdt_tamp' }), 'prep:screen');
  assert.equal(key({ prep: 'shaker_wdt_tamp', screen: true }), 'prep:slowfeed');
});

test('memory: advice not applied is repeated and said so (example 12)', () => {
  const prev = { lever: 'grind:finer', cls: 'under', dir: 'under', grind: 10, dose: 18, yield: 36, prep: 'wdt_tamp', ts: ago(1) };
  const r = diagnose({ shot: shot({ time: 20 }), profile: stepped, prev });
  assert.equal(r.primary.changes.grind.dir, 'finer');
  assert.match(r.primary.detail, /wasn’t made/);
});

test('memory: applied but no better crosses the lever off; grind goes one size up (example 13)', () => {
  const prev = { lever: 'grind:finer', cls: 'under', dir: 'under', grind: 10, dose: 18, yield: 36, prep: 'wdt_tamp', ts: ago(1) };
  const cur = shot({ grind: 9, time: 21 });
  const first = diagnose({ shot: cur, profile: stepped });
  const r = diagnose({ shot: cur, profile: stepped, prev });
  assert.deepEqual(r.tried, ['grind:finer']);
  assert.ok(r.primary.changes.grind.steps > first.primary.changes.grind.steps);
  const again = diagnose({ shot: shot({ grind: 7, time: 22 }), profile: stepped, prev: { ...prev, grind: 9, tried: ['grind:finer'] } });
  assert.deepEqual(again.tried, ['grind:finer', 'grind:finer']);
  assert.notEqual(again.primary.key, 'grind:finer');
});

test('memory: applied and improved keeps the lever (example 14)', () => {
  const prev = { lever: 'prep:shaker', cls: 'mixed', dir: 'mixed', prep: 'wdt_tamp', dose: 18, yield: 36, grind: 10, ts: ago(1) };
  const r = diagnose({ shot: shot({ prep: 'shaker_wdt_tamp', notes: ['sour'], time: 20 }), profile: stepped, prev });
  assert.deepEqual(r.tried, []);
  assert.ok(r.notes.some((n) => /improved/.test(n.text)));
});

test('overshoot beats memory and is never crossed off (example 15)', () => {
  const prev = { lever: 'grind:finer', cls: 'under', dir: 'under', grind: 10, time: 22, dose: 18, yield: 36, ts: ago(1) };
  const r = diagnose({ shot: shot({ grind: 8, time: 30, notes: ['bitter'] }), profile: stepped, prev });
  assert.equal(r.primary.type, 'revert');
  assert.equal(r.primary.changes.grind.to, 9);
  assert.deepEqual(r.tried, []);
});

test('memory expires after 7 days (example 19)', () => {
  const prev = { lever: 'grind:finer', cls: 'under', dir: 'under', grind: 10, dose: 18, yield: 36, prep: 'wdt_tamp', ts: ago(8) };
  const r = diagnose({ shot: shot({ time: 20 }), profile: stepped, prev });
  assert.doesNotMatch(r.primary.detail, /wasn’t made/);
});

test('ratio clamps to the roast range (example 16)', () => {
  const dark = diagnose({ shot: shot({ roast: 'dark', notes: ['bitter'], time: 28, temp: 'fixed' }), profile: stepped });
  assert.equal(dark.primary.changes.yield.to, 31.5);
  const light = diagnose({ shot: shot({ roast: 'light', notes: ['sour'], time: 31 }), profile: stepped });
  assert.equal(light.primary.changes.yield.to, 45);
  const atEdge = diagnose({ shot: shot({ yield: 31.5, notes: ['bitter'], time: 30 }), profile: stepped });
  assert.equal(atEdge.primary.changes.yield, undefined);
  assert.equal(atEdge.primary.changes.grind.dir, 'coarser');
});

test('start ratio is clamped into the roast range (example 17)', () => {
  assert.equal(startRatio(DEFAULT_PROFILE, 'dark'), 1.75);
  assert.equal(startRatio(DEFAULT_PROFILE, 'medium'), 2);
  assert.equal(startRatio(DEFAULT_PROFILE, 'light'), 2.5);
  assert.equal(startRatio({ ...DEFAULT_PROFILE, prefRatio: 2 }, 'dark'), 1.75);
});

test('a balanced shot outside the range is still locked in (example 18)', () => {
  const r = diagnose({ shot: shot({ roast: 'dark', notes: ['chocolate'] }), profile: stepped });
  assert.equal(r.lockIn, true);
});

test('fill under + sour + fast: raise dose 0.5 g, ratio kept, dose outranks grind (example 20)', () => {
  const r = diagnose({ shot: shot({ time: 19, fill: 'under' }), profile: stepped });
  assert.equal(r.primary.type, 'dose');
  assert.equal(r.primary.changes.dose.to, 18.5);
  assert.equal(r.primary.changes.yield.to, 37);
  assert.match(r.then, /fill looks right/);
  assert.equal(r.channelling.level, 'possible');
});

test('fill over + bitter + slow: lower dose 0.5 g (example 21)', () => {
  const r = diagnose({ shot: shot({ time: 36, notes: ['bitter'], fill: 'over' }), profile: stepped });
  assert.equal(r.primary.changes.dose.to, 17.5);
  assert.equal(r.primary.changes.yield.to, 35);
});

test('mixed + fast + under-filled: score 6, prep leads, dose follows (example 22)', () => {
  const r = diagnose({ shot: shot({ notes: ['sour', 'bitter'], time: 19, fill: 'under' }), profile: stepped });
  assert.equal(r.channelling.score, 6);
  assert.equal(r.primary.type, 'prep');
  assert.match(r.then, /dose/i);
});

test('dose lever is crossed off after two unsuccessful steps (example 23)', () => {
  const base = { lever: 'dose:raise', cls: 'under', dir: 'under', prep: 'wdt_tamp', yield: 37, grind: 10, ts: ago(1) };
  const second = diagnose({ shot: shot({ dose: 18.5, yield: 37, time: 20, fill: 'under' }), profile: stepped, prev: { ...base, dose: 18, yield: 36 } });
  assert.equal(second.primary.changes.dose.to, 19);
  assert.deepEqual(second.tried, ['dose:raise']);
  const third = diagnose({ shot: shot({ dose: 19, yield: 38, time: 20, fill: 'under' }), profile: stepped, prev: { ...base, dose: 18.5, tried: ['dose:raise'] } });
  assert.deepEqual(third.tried, ['dose:raise', 'dose:raise']);
  assert.notEqual(third.primary.type, 'dose');
  assert.ok(third.notes.some((n) => /moved 1 g/.test(n.text)));
});

test('fill unchecked adds one low note; fill level adds none (examples 24, 25)', () => {
  const un = diagnose({ shot: shot({ time: 19 }), profile: stepped });
  assert.equal(un.primary.type, 'grind');
  assert.ok(un.notes.some((n) => /Check your fill/.test(n.text)));
  const ok = diagnose({ shot: shot({ time: 19, fill: 'level' }), profile: stepped });
  assert.equal(ok.notes.some((n) => /Check your fill/.test(n.text)), false);
});

test('thin balanced cup never suggests more dose (example 26)', () => {
  const r = diagnose({ shot: shot({ notes: ['sweet', 'watery'], yield: 31.5 }), profile: stepped });
  assert.equal(r.primary.changes.dose, undefined);
  assert.doesNotMatch(r.primary.detail + r.then, /0\.5 ?g more dose/);
});

test('nextShotFrom applies dose and yield together and resets fill (example 27)', () => {
  const s = shot({ time: 19, fill: 'under' });
  const r = diagnose({ shot: s, profile: stepped });
  const next = nextShotFrom(s, r.primary);
  assert.equal(next.dose, 18.5);
  assert.equal(next.yield, 37);
  assert.equal(next.fill, 'unchecked');
});

test('result carries cls, lever and tried for the logbook', () => {
  const r = diagnose({ shot: shot({ time: 19 }), profile: stepped });
  assert.equal(r.cls, 'under');
  assert.equal(r.lever, 'grind:finer');
  assert.deepEqual(r.tried, []);
});
