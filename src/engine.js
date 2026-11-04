// Dial-in engine: pure functions, no DOM, no storage. Covered by test/engine.test.js.
// Specification: docs/ALGORITHM.md (v2).
//
// Principles
//  - Taste decides the direction; shot time (flow) decides which lever to pull.
//  - One primary change per shot. A "then" hint says what to try next if it is still off.
//  - Grind advice is expressed in the user's own grinder units. Step size is learned from
//    their logged shots (profile.sensitivity = seconds of shot time per grind step).
//  - Every lever has a rank (lower = earlier); rank 60 and above is a note, not a lever.

export const TASTE = {
  under: ['sour', 'sharp', 'lemon', 'vegetal', 'vinegar'],
  over: ['bitter', 'ashy', 'dry', 'burnt', 'astringent', 'medicinal'],
  neutral: ['salty'], // ambiguous: never sour, never offsets an off-note (see the salty rule)
  balanced: {
    light: ['sweet', 'balanced', 'berry', 'citrus', 'floral', 'jasmine', 'tropical', 'tea-like'],
    medium: ['sweet', 'balanced', 'chocolate', 'caramel', 'honey', 'vanilla', 'nuts', 'malty'],
    dark: ['sweet', 'balanced', 'chocolate', 'caramel', 'vanilla', 'nuts', 'malty', 'buttery'],
  },
  body: {
    weak: ['watery', 'thin'],
    optimal: ['medium', 'syrupy'],
    heavy: ['heavy', 'overpowering'],
  },
};

export const DEFAULT_PROFILE = {
  grinder: 'stepped', // 'stepped' | 'stepless' | 'builtin'
  finerIs: 'lower', // which direction on the grinder's numbers is finer: 'lower' | 'higher'
  burr: 'unknown', // 'conical' | 'flat' | 'unknown'
  sensitivity: null, // learned seconds of shot time per grind step (positive number)
  prefRatio: null, // learned preferred brew ratio (yield / dose); null until a shot is locked in
  onboarded: false,
};

export const STARTING_RATIO = 2;

// Target ratio (1 : x) per roast. The range shapes advice and the start ratio only; it never
// overrides a balanced cup.
export const RATIO_RANGE = { dark: [1.5, 1.75], medium: [1.75, 2.5], light: [2.5, 3.5] };
const RATIO_STEP = 0.25;
const EPS = 1e-6;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const DOSE_STEP = 0.5;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round1 = (n) => Math.round(n * 10) / 10;
const roundHalf = (n) => Math.round(n * 2) / 2;
const trimRatio = (r) => String(+r.toFixed(2));

export function startRatio(profile, roast = 'medium') {
  const [lo, hi] = RATIO_RANGE[roast] || RATIO_RANGE.medium;
  return clamp(profile?.prefRatio > 0 ? profile.prefRatio : STARTING_RATIO, lo, hi);
}

export function balancedNotes(roast) {
  return TASTE.balanced[roast] || TASTE.balanced.medium;
}

// Target shot-time window for a ratio. About 25-32s at 1:2, a little shorter for ristretto
// ratios and longer for lungo ratios.
export function timeWindow(ratio) {
  const r = ratio > 0 ? ratio : STARTING_RATIO;
  const lo = Math.max(15, 25 + 4 * (r - 2));
  const hi = Math.max(lo + 4, 32 + 5 * (r - 2));
  return { lo, hi, mid: (lo + hi) / 2 };
}

// Stricter than "below the window": used only for the channelling score.
const fastThreshold = (r) => Math.max(12, 12 + 4 * r);
const chokeThreshold = (r) => Math.max(25, 25 + 7 * r);

export function classifyTaste(notes, roast) {
  const picked = notes.map((n) => n.toLowerCase());
  const count = (list) => picked.filter((n) => list.includes(n)).length;
  const under = count(TASTE.under);
  const over = count(TASTE.over);
  const balanced = count(balancedNotes(roast));
  const weak = count(TASTE.body.weak);
  const heavy = count(TASTE.body.heavy);
  const salty = picked.includes('salty');
  const contradictoryBody = weak > 0 && heavy > 0;
  const body = contradictoryBody ? 0 : heavy > 0 ? 1 : weak > 0 ? -1 : 0;

  let dir;
  let minor = null;
  if (under && over) dir = 'mixed';
  else if (!under && !over) dir = 'balanced';
  else if (balanced >= under + over) {
    dir = 'balanced';
    minor = under ? 'under' : 'over';
  } else dir = under ? 'under' : 'over';

  return { under, over, balanced, body, heavy, salty, dir, minor, strength: under + over, contradictoryBody };
}

export function prepInfo(prep = 'tamp', screen = false) {
  const wdt = prep.includes('wdt');
  const shaker = prep.includes('shaker');
  return { wdt, shaker, screen: !!screen, maxed: wdt && shaker && !!screen };
}

function validate(shot) {
  if (!(shot.dose > 0) || !(shot.yield > 0)) return 'Dose in and yield out must both be greater than 0.';
  if (!shot.notes || shot.notes.length === 0) return 'Pick at least one taste note so the shot can be diagnosed.';
  return null;
}

// 1 = small, 2 = medium, 3 = big. Driven by how far the shot is outside the time window and
// by how many off-notes were picked.
function stepLevel(time, win, strength) {
  let level = 1;
  if (Number.isFinite(time)) {
    const off = time < win.lo ? win.lo - time : time > win.hi ? time - win.hi : 0;
    if (off > 10) level = 3;
    else if (off > 4) level = 2;
  }
  if (strength >= 3) level = Math.min(3, level + 1);
  return level;
}

function unitWord(profile, n) {
  const base = profile.grinder === 'builtin' ? 'setting' : profile.grinder === 'stepped' ? 'click' : 'unit';
  return n === 1 ? base : `${base}s`;
}

function moveGrind(shot, profile, dirWord, steps) {
  if (!Number.isFinite(shot.grind) || steps == null) return null;
  const sign = (profile.finerIs === 'lower' ? -1 : 1) * (dirWord === 'finer' ? 1 : -1);
  const raw = shot.grind + sign * steps;
  return profile.grinder === 'stepless' ? round1(raw) : Math.round(raw);
}

// `forceLevel` pins the size (choking = big, escalate = small). `bump` goes one size up
// after the same grind advice was tried once without effect.
function grindAmount({ dirWord, shot, profile, win, strength, forceLevel, bump }) {
  let level = forceLevel || stepLevel(shot.time, win, strength);
  if (bump) level = Math.min(3, level + 1);
  const stepped = profile.grinder !== 'stepless';
  const sens = profile.sensitivity > 0 ? profile.sensitivity : null;
  if (sens && Number.isFinite(shot.time)) {
    const gap = Math.max(2, Math.abs(win.mid - shot.time));
    const raw = (gap / sens) * (bump ? 2 : 1);
    const steps = stepped ? clamp(Math.round(raw), 1, 6) : clamp(round1(raw), 0.1, 5);
    const expectedTime = Math.round(shot.time + (dirWord === 'finer' ? 1 : -1) * steps * sens);
    return { steps, level, calibrated: true, expectedTime };
  }
  if (stepped) return { steps: [1, 2, 3][level - 1], level, calibrated: false };
  return { steps: null, level, calibrated: false, label: ['a small nudge', 'a moderate move', 'a big move'][level - 1] };
}

function grindRec({ dirWord, shot, profile, win, taste, forceLevel, bump }) {
  const amt = grindAmount({ dirWord, shot, profile, win, strength: taste.strength, forceLevel, bump });
  const to = moveGrind(shot, profile, dirWord, amt.steps);
  const how =
    amt.steps != null
      ? `about ${amt.steps} ${unitWord(profile, amt.steps)} ${dirWord}${to != null ? ` (${shot.grind} → ${to})` : ''}`
      : `${amt.label} ${dirWord}`;
  const why =
    dirWord === 'finer'
      ? 'A finer grind slows the flow and extracts more, which fixes sourness.'
      : 'A coarser grind speeds the flow and extracts less, which fixes bitterness.';
  const eta = amt.expectedTime ? ` That should land near ${amt.expectedTime}s.` : '';
  return {
    type: 'grind',
    headline: `Grind ${dirWord}`,
    detail: `Move ${how}. ${why}${eta}`,
    changes: { grind: { from: shot.grind, to, steps: amt.steps, dir: dirWord } },
    key: `grind:${dirWord}`,
  };
}

// The nearest edge of the roast's range if the ratio is outside it, else one step toward the
// far edge, never past it. null when there is no room to move.
function ratioMove(dir, ratio, [lo, hi]) {
  if (dir === 'shorter') {
    if (ratio <= lo + EPS) return null;
    return ratio > hi + EPS ? hi : Math.max(lo, ratio - RATIO_STEP);
  }
  if (ratio >= hi - EPS) return null;
  return ratio < lo - EPS ? lo : Math.min(hi, ratio + RATIO_STEP);
}

function ratioRec({ dir, shot, ratio, roast, range, why, lead = '' }) {
  const to = ratioMove(dir, ratio, range);
  if (to == null) return null;
  const longer = dir === 'longer';
  const where = ratio < range[0] - EPS ? 'below' : ratio > range[1] + EPS ? 'above' : 'inside';
  const newYield = roundHalf(shot.dose * to);
  return {
    type: 'yield',
    headline: longer ? 'Pull a longer shot' : 'Pull a shorter shot',
    detail: `${lead}1:${ratio.toFixed(1)} is ${where} the ${roast} range of 1:${range[0]} to 1:${range[1]}. Stop at ${newYield}g instead of ${shot.yield}g (about 1:${trimRatio(to)}). ${why}`,
    changes: { yield: { from: shot.yield, to: newYield } },
    key: longer ? 'ratio:longer' : 'ratio:shorter',
  };
}

const WHY_SHORTER = 'Cutting the shot earlier leaves the bitter tail out of the cup.';
const WHY_LONGER = 'More water pulls out more sweetness without touching the grind.';

// The first prep rung the user is not already doing.
function nextRung(prep, prev, mixed) {
  if (!prep.wdt) {
    return { key: 'prep:wdt', headline: 'Level the tamp and add WDT', changes: { prep: prep.shaker ? 'shaker_wdt_tamp' : 'wdt_tamp' },
      how: 'Tamp level, and stir the grounds with a fine needle tool (WDT) before tamping.', evidence: 'Best-tested fix, though from one test series.' };
  }
  if (!prep.shaker) {
    return { key: 'prep:shaker', headline: 'Try a blind shaker', changes: { prep: 'shaker_wdt_tamp' },
      how: 'Shake the grounds through a blind shaker before tamping to break clumps.', evidence: 'A popular tip with little formal testing.' };
  }
  if (!prep.screen) {
    return { key: 'prep:screen', headline: 'Add a puck screen', changes: { screen: true },
      how: 'Place a puck screen on the bed to spread the water evenly.', evidence: 'Best-tested fix, though from one test series.' };
  }
  if (prev?.lever === 'prep:slowfeed' && mixed) return { key: 'escalate' };
  return { key: 'prep:slowfeed', headline: 'Slow-feed the grinder', changes: {},
    how: 'Feed beans into the grinder slowly to reduce clumps, and keep the grind setting unchanged.', evidence: 'A popular tip with little formal testing.' };
}

// Was last time's advised change made? null when it cannot be told.
function wasApplied(prev, shot, profile, ratio) {
  const lever = prev.lever;
  if (!lever) return null;
  const prevRatio = prev.yield / prev.dose;
  const fine = (g) => (profile.finerIs === 'lower' ? -g : g);
  const grindKnown = Number.isFinite(prev.grind) && Number.isFinite(shot.grind);
  switch (lever) {
    case 'grind:finer': return grindKnown ? fine(shot.grind) > fine(prev.grind) : null;
    case 'grind:coarser': return grindKnown ? fine(shot.grind) < fine(prev.grind) : null;
    case 'ratio:shorter': return ratio <= prevRatio - 0.1 + EPS;
    case 'ratio:longer': return ratio >= prevRatio + 0.1 - EPS;
    case 'dose:raise': return shot.dose >= prev.dose + 0.4 - EPS;
    case 'dose:lower': return shot.dose <= prev.dose - 0.4 + EPS;
    case 'prep:wdt': return String(shot.prep).includes('wdt') && !String(prev.prep).includes('wdt');
    case 'prep:shaker': return String(shot.prep).includes('shaker') && !String(prev.prep).includes('shaker');
    case 'prep:screen': return Boolean(shot.screen) && !prev.screen;
    case 'prep:slowfeed': return true; // not an input, so it counts as applied
    default: return null;
  }
}

// Chooses the single most useful change for this shot. `prev` is the previous logged shot
// of the same coffee (used for the overshoot check and for memory), or null.
export function diagnose({ shot, profile = DEFAULT_PROFILE, prev: prevIn = null, now = Date.now() }) {
  const error = validate(shot);
  if (error) return { ok: false, error };

  // Memory only looks back a week; an entry without a timestamp counts as fresh.
  const prev = prevIn && (!prevIn.ts || now - Date.parse(prevIn.ts) <= WEEK_MS) ? prevIn : null;
  const roast = RATIO_RANGE[shot.roast] ? shot.roast : 'medium';
  const range = RATIO_RANGE[roast];
  const fill = shot.fill || 'unchecked';
  const ratio = shot.yield / shot.dose;
  const ratioShort = ratio < range[0] - EPS;
  const ratioLong = ratio > range[1] + EPS;
  const ratioOut = ratioShort || ratioLong;
  const win = timeWindow(ratio);
  const hasTime = Number.isFinite(shot.time) && shot.time > 0;
  const timeStatus = !hasTime ? 'unknown' : shot.time < win.lo ? 'fast' : shot.time > win.hi ? 'slow' : 'in';
  const upperHalf = hasTime && shot.time > win.mid;
  const choking = hasTime && shot.time >= chokeThreshold(ratio);
  const fastStrict = hasTime && shot.time <= fastThreshold(ratio);
  const taste = classifyTaste(shot.notes, roast);
  const prep = prepInfo(shot.prep, shot.screen);
  const mixed = taste.dir === 'mixed';
  const dominant = taste.under > taste.over ? 'under' : taste.over > taste.under ? 'over' : 'tie';
  const domGrind = dominant === 'under' ? 'finer' : 'coarser'; // tied cups lean coarser
  const cls = taste.dir;
  const notes = [];
  let dir = taste.dir;

  if (taste.contradictoryBody) {
    notes.push({ kind: 'info', text: 'You picked both a thin and a heavy body note. They cancel out, so body was ignored. Re-taste if body is the main problem.' });
  }
  if (!hasTime) {
    notes.push({ kind: 'tip', text: 'Add the shot time. It tells the app whether to change grind or ratio, and lets it learn your grinder.' });
  }
  // Both sour and bitter on a slow shot is usually a choked, too-fine grind.
  if (mixed && timeStatus === 'slow') {
    dir = 'over';
    notes.push({ kind: 'info', text: 'Sour and bitter together on a slow shot usually means the grind is too fine and the flow chokes.' });
  }

  // ---- Channelling score (docs/ALGORITHM.md section 7) ----
  const score = (mixed ? 3 : 0) + (fastStrict ? 2 : 0) + (mixed && fill === 'under' ? 1 : 0);
  const chLevel = score >= 5 ? 'strong' : score >= 3 ? 'likely' : score === 2 ? 'possible' : 'none';
  const channeling = chLevel === 'likely' || chLevel === 'strong';
  const signals = [];
  if (mixed) signals.push('sour and bitter notes together');
  if (fastStrict) signals.push(`fast shot (${shot.time}s)`);
  if (mixed && fill === 'under') signals.push('under-filled basket');
  const chCopy = `${chLevel === 'strong' ? 'Strong' : 'Likely'} channelling signals: ${signals.join(', ')}. This is a likely cause, not a diagnosis; uneven roasting or a wide particle mix can look the same. `;

  // ---- Memory: overshoot first, then whether last time's advice was followed ----
  const recs = [];
  const add = (rank, rec) => recs.push({ rank, ...rec });
  const tried = [...(prev?.tried || [])];
  let overshoot = false;
  let notApplied = false;

  if (
    prev && (taste.dir === 'under' || taste.dir === 'over') && (prev.dir === 'under' || prev.dir === 'over') &&
    prev.dir !== taste.dir && Number.isFinite(prev.grind) && Number.isFinite(shot.grind) && prev.grind !== shot.grind
  ) {
    overshoot = true;
    let to = profile.grinder === 'stepless' ? round1((prev.grind + shot.grind) / 2) : Math.round((prev.grind + shot.grind) / 2);
    if (to === shot.grind) to = shot.grind + Math.sign(prev.grind - shot.grind);
    add(5, {
      type: 'revert',
      headline: 'You overshot. Go back about halfway',
      detail: `The last shot was ${prev.dir === 'under' ? 'sour' : 'bitter'} at ${prev.grind} and this one is ${taste.dir === 'under' ? 'sour' : 'bitter'} at ${shot.grind}. The sweet spot is between them. Try ${to}.`,
      changes: { grind: { from: shot.grind, to, dir: 'revert' } },
      key: 'grind:revert',
      then: 'Change nothing else, so you know the result comes from the grind.',
    });
  } else if (prev?.lever) {
    const applied = wasApplied(prev, shot, profile, ratio);
    const prevCls = prev.cls || prev.dir;
    const improved = (prevCls === 'mixed' && cls !== 'mixed') || (cls === 'balanced' && prevCls !== 'balanced') ||
      (prev.lever.startsWith('dose:') && fill === 'level');
    if (applied === false) {
      notApplied = true;
      notes.push({ kind: 'info', text: 'Last time’s change wasn’t made, so the advice stands. Change that one thing before anything else.' });
    } else if (applied && improved) {
      notes.push({ kind: 'info', text: 'You made last time’s change and the cup improved. Keep it and carry on.' });
    } else if (applied) {
      tried.push(prev.lever);
      notes.push({ kind: 'info', text: 'You made last time’s change and the cup didn’t improve, so that lever is crossed off for now.' });
    }
  }
  const triedCount = (key) => tried.filter((k) => k === key).length;
  const grindLever = (rank, dirWord, o = {}) => {
    const rec = grindRec({ dirWord, shot, profile, win, taste, forceLevel: o.forceLevel, bump: triedCount(`grind:${dirWord}`) === 1 });
    if (o.label) rec.headline = o.label;
    rec.detail = `${o.pre || ''}${rec.detail}`;
    if (o.then) rec.then = o.then;
    if (o.after) rec.after = o.after;
    add(rank, rec);
  };
  const ratioLever = (rank, dir, why, lead, then) => {
    const rec = ratioRec({ dir, shot, ratio, roast, range, why, lead });
    if (!rec) return false;
    if (then) rec.then = then;
    add(rank, rec);
    return true;
  };

  if (!overshoot) {
    // ---- Dose fit (self-reported, rank 25) ----
    if (fill === 'under' || fill === 'over') {
      const up = fill === 'under';
      const newDose = round1(shot.dose + (up ? DOSE_STEP : -DOSE_STEP));
      const newYield = roundHalf(newDose * ratio);
      if (newDose > 0) {
        add(25, {
          type: 'dose',
          headline: `${up ? 'Raise' : 'Lower'} dose to ${newDose} g`,
          detail: up
            ? `You saw an under-filled basket. A lot of room above the puck can give a fast, thin shot and makes the puck easier to disturb. Add 0.5 g and keep the ratio: stop at about ${newYield}g. Hold the grind until the fill looks right. Practitioner advice, not tested.`
            : `You saw an over-filled basket. A puck pressed against the screen tends to slow the flow and make the shot hard to read. Take off 0.5 g and keep the ratio: stop at about ${newYield}g. Judge the grind after the fill looks right. Plausible, not tested.`,
          changes: { dose: { from: shot.dose, to: newDose }, yield: { from: shot.yield, to: newYield } },
          key: up ? 'dose:raise' : 'dose:lower',
        });
      }
    }

    // ---- Puck integrity: the prep ladder ----
    const rung = nextRung(prep, prev, mixed);
    const prepLeads = mixed && (timeStatus === 'fast' || fastStrict || ((timeStatus === 'in' || timeStatus === 'unknown') && !ratioOut));
    let escalated = false;
    if (channeling || chLevel === 'possible') {
      if (rung.key === 'escalate') {
        if (channeling) {
          escalated = true;
          grindLever(20, domGrind, {
            forceLevel: 1, label: `Grind ${domGrind} one small step`,
            pre: 'Prep is maxed. If it still tastes mixed, check bean freshness and try a different bag as a fair test. ',
          });
        }
      } else {
        const head = channeling ? chCopy : 'A fast shot alone is not proof of channelling, but better prep never hurts. ';
        add(channeling ? (prepLeads ? 20 : 45) : 62, {
          type: 'prep', headline: rung.headline, detail: `${head}${rung.how} ${rung.evidence}`, changes: rung.changes, key: rung.key,
          then: 'Once the puck is even, repeat the shot with the same grind and re-taste before changing anything else.',
          after: 'Prep is next: ' + rung.headline.toLowerCase() + '.',
        });
      }
    }

    // ---- Flow (grind) ----
    if (!escalated) {
      const sorry = hasTime ? `Shot ran ${shot.time}s, well past the ${Math.round(win.lo)}-${Math.round(win.hi)}s window. ` : '';
      const coarserWhenSlow = () => grindLever(30, 'coarser', {
        forceLevel: choking ? 3 : undefined, label: choking ? 'Grind coarser (choking likely)' : undefined, pre: choking ? sorry : '',
        then: `Re-taste. If it is still bitter once the shot is inside ${Math.round(win.lo)}-${Math.round(win.hi)}s, make the shot shorter next.`,
      });
      if (mixed) {
        if (timeStatus === 'slow') coarserWhenSlow();
        else if (dominant !== 'tie') {
          grindLever(32, domGrind, { pre: 'Only if still off after the prep change. ', after: `Grind ${domGrind}, only if still off after the prep change.` });
        }
        if (ratioOut) {
          ratioLever(40, ratioLong ? 'shorter' : 'longer', 'The ratio is outside the roast’s range, so fix it before chasing prep.', '');
        }
      } else if (taste.dir === 'under') {
        if (timeStatus === 'slow') {
          if (!ratioLever(40, 'longer', WHY_LONGER, '', 'Check for late channelling or a temperature drop before grinding finer.')) {
            add(40, {
              type: 'check', headline: 'Check before changing anything',
              detail: `Shot ran ${shot.time}s (target ${Math.round(win.lo)}-${Math.round(win.hi)}s) yet tastes sour. Check for late channelling, an uneven grind or a temperature drop before grinding finer.`,
              changes: {}, key: null,
            });
          }
          notes.push({ kind: 'info', text: `Unusual: slow and sour. The shot ran ${shot.time}s (target ${Math.round(win.lo)}-${Math.round(win.hi)}s) yet tastes under-extracted. Check for late channelling, an uneven grind or a temperature drop before grinding finer.` });
        } else if (timeStatus === 'fast') {
          grindLever(30, 'finer', {
            pre: `Shot ran ${shot.time}s, short of the ${Math.round(win.lo)}-${Math.round(win.hi)}s window. `,
            then: `Re-taste. If it is still sour once the shot is inside ${Math.round(win.lo)}-${Math.round(win.hi)}s, make the shot longer next.`,
          });
        } else if (timeStatus === 'unknown' || !upperHalf) {
          grindLever(32, 'finer', { then: `Re-taste. If it is still sour once the shot is inside ${Math.round(win.lo)}-${Math.round(win.hi)}s, make the shot longer next.` });
        } else if (!ratioLever(34, 'longer', WHY_LONGER, '', 'If it is still sour, grind a little finer next.')) {
          grindLever(32, 'finer', {});
        }
      } else if (taste.dir === 'over') {
        const darkInRange = roast === 'dark' && timeStatus === 'in';
        if (timeStatus === 'slow') coarserWhenSlow();
        else if (timeStatus === 'unknown' || (!darkInRange && timeStatus === 'in' && upperHalf)) {
          grindLever(32, 'coarser', { then: `Re-taste. If it is still bitter once the shot is inside ${Math.round(win.lo)}-${Math.round(win.hi)}s, make the shot shorter next.` });
        } else if (!ratioLever(34, 'shorter', WHY_SHORTER, '', 'If it is still bitter, grind a little coarser next.')) {
          grindLever(32, 'coarser', {});
        }
      }
    }

    // ---- Ratio: a bitter or sour cup on the wrong side of the range ----
    if (!mixed && (taste.dir === 'under' || taste.dir === 'over') && timeStatus !== 'slow') {
      const sameWay = taste.dir === 'over' ? ratioLong : ratioShort;
      const have = recs.some((r) => r.type === 'yield');
      if (sameWay && !have) ratioLever(40, taste.dir === 'over' ? 'shorter' : 'longer', taste.dir === 'over' ? WHY_SHORTER : WHY_LONGER, '');
    }

    // ---- Salty rule: salty + heavy + short ratio = the shot was cut off before the sweet phase ----
    let saltyRule = false;
    if (taste.salty && taste.heavy > 0 && ratioShort) {
      const to = range[0];
      const y = roundHalf(shot.dose * to);
      saltyRule = true;
      add(25, {
        type: 'yield', headline: `Pull a longer shot (to 1:${range[0]})`,
        detail: `Salty and thick means the shot is cutting off before the sweet phase. Let it run to about ${y}g (1:${range[0]}) and keep the grind the same.`,
        changes: { yield: { from: shot.yield, to: y } }, key: 'ratio:longer',
      });
    }

    // ---- Body, on an otherwise balanced cup ----
    if (taste.dir === 'balanced' && !saltyRule) {
      if (taste.body < 0) {
        const rec = ratioRec({ dir: 'shorter', shot, ratio, roast, range, why: 'This concentrates the cup.', lead: 'Taste is balanced but the body is thin. ' });
        if (rec) { rec.then = 'If it is still thin, check how the basket was filled.'; add(35, rec); }
      } else if (taste.body > 0) {
        const rec = ratioRec({ dir: 'longer', shot, ratio, roast, range, why: 'A little more water lightens the body.', lead: 'Taste is balanced but the body is heavy. ' });
        if (rec) add(35, rec);
      }
    }
  }

  // ---- Unchecked fill: one low note, never an inference ----
  if (fill === 'unchecked' && ((taste.dir === 'under' && timeStatus === 'fast') || taste.body < 0 || choking)) {
    add(62, { type: 'check', headline: 'Check your fill', detail: 'An under- or over-filled basket can also cause this.', changes: {}, key: null });
  }

  // ---- Spent levers: tried without effect drop to a note ----
  for (const r of recs) {
    if (!r.key || r.rank >= 60 || r.key === 'grind:revert') continue;
    const spent = r.key.startsWith('grind:') || r.key.startsWith('dose:') ? triedCount(r.key) >= 2 : triedCount(r.key) >= 1;
    if (!spent) continue;
    r.rank = 62;
    r.detail = r.key.startsWith('dose:')
      ? `Dose has moved 1 g and the basket still looks ${r.key === 'dose:raise' ? 'under' : 'over'}-filled. Check that the grounds are levelled and the tamp is level; a different basket may suit this dose.`
      : `You tried this last time and the cup didn’t change. ${r.detail}`;
  }

  let lockIn = false;
  if (!recs.some((r) => r.rank < 60)) {
    if (tried.length) {
      add(1, { type: 'hold', headline: 'No new lever left', detail: 'The usual levers have been tried. Pull again to confirm, or try a fresh bag of the same coffee as a fair test.', changes: {}, key: null });
    } else {
      lockIn = true;
      add(1, { type: 'hold', headline: 'Lock it in', detail: 'Balanced. Save this recipe and make the next shot the same way to confirm it repeats.', changes: {}, key: null });
    }
  }
  recs.sort((a, b) => a.rank - b.rank);
  const [first, ...rest] = recs;
  const { rank: _rank, then: ownThen, after: _after, ...primary } = first;
  if (notApplied && primary.key && primary.key === prev.lever) primary.detail = `Last time’s change wasn’t made. ${primary.detail}`;
  const second = rest.find((r) => r.rank < 60);
  const lowerFirst = (t) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  const then = !second ? ownThen || ''
    : first.type === 'dose' && second.changes?.grind ? `Then: ${lowerFirst(second.headline)} once the fill looks right.`
      : second.after || `Then: ${lowerFirst(second.headline)}.`;
  for (const r of rest.filter((x) => x.rank >= 60).slice(0, 2)) notes.push({ kind: 'info', text: `${r.headline}. ${r.detail}` });

  if (taste.minor) {
    notes.push({ kind: 'info', text: `A mild ${taste.minor === 'under' ? 'sour' : 'bitter'} note showed up beside the balanced ones. Only chase it if you want to fine-tune.` });
  }

  // Temperature is second-order: only mentioned once the main lever is in range, and only if
  // the user said their machine lets them change it.
  if (shot.temp && shot.temp !== 'fixed' && primary.type !== 'prep') {
    if (roast === 'light' && dir === 'under' && shot.temp !== 'high') {
      notes.push({ kind: 'tip', text: 'Light roasts are dense. If it is still sour after the grind is right, try a higher brew temperature (93°C or more).' });
    } else if (roast === 'dark' && dir === 'over' && shot.temp !== 'low') {
      notes.push({ kind: 'tip', text: 'Dark roasts turn ashy when hot. If it is still bitter after the grind is right, try 91°C or lower.' });
    }
  }

  if (profile.burr === 'flat' && taste.body < 0) {
    notes.push({ kind: 'info', text: 'Flat burrs give clarity over body. A slightly lighter mouthfeel is normal if the flavor is balanced.' });
  }

  return {
    ok: true,
    ratio,
    window: win,
    timeStatus,
    taste,
    dir,
    cls,
    fill,
    channeling,
    channelling: { score, level: chLevel },
    lockIn,
    primary,
    lever: lockIn || !primary.key ? null : primary.key,
    tried,
    then,
    notes,
  };
}

// Returns the form values for the next shot with the recommended change applied.
export function nextShotFrom(shot, primary) {
  const next = { ...shot, time: '', notes: [], fill: 'unchecked' };
  const c = primary.changes || {};
  if (c.grind && c.grind.to != null) next.grind = c.grind.to;
  if (c.dose) next.dose = c.dose.to;
  if (c.yield) next.yield = c.yield.to;
  if (c.prep) next.prep = c.prep;
  if (c.screen) next.screen = true;
  return next;
}

// Learns seconds-per-grind-step from two consecutive shots of the same coffee where only the
// grind moved. Returns the updated sensitivity, or the old one if the pair is not usable.
export function learnSensitivity(prev, cur, profile) {
  if (!prev) return profile.sensitivity;
  const ok = [prev.grind, cur.grind, prev.time, cur.time].every(Number.isFinite);
  if (!ok || prev.grind === cur.grind) return profile.sensitivity;
  if (Math.abs(prev.yield / prev.dose - cur.yield / cur.dose) > 0.2) return profile.sensitivity;
  if (Math.abs(prev.dose - cur.dose) > 0.5) return profile.sensitivity;
  const fine = (g) => (profile.finerIs === 'lower' ? -g : g);
  const sample = (cur.time - prev.time) / (fine(cur.grind) - fine(prev.grind));
  if (!(sample > 0.05 && sample < 30)) return profile.sensitivity;
  return profile.sensitivity > 0 ? round1((profile.sensitivity + sample) / 2) : round1(sample);
}

// Blends a locked-in ratio into the user's preferred ratio.
export function learnRatio(profile, ratio) {
  const r = round1(ratio * 10) / 10;
  return profile.prefRatio > 0 ? round1(profile.prefRatio * 0.7 + r * 0.3) : r;
}
