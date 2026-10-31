// Dial-in engine: pure functions, no DOM, no storage. Covered by test/engine.test.js.
//
// Principles
//  - Taste decides the direction; shot time (flow) decides which lever to pull.
//  - One primary change per shot. A "then" hint says what to try next if it is still off.
//  - Grind advice is expressed in the user's own grinder units. Step size is learned from
//    their logged shots (profile.sensitivity = seconds of shot time per grind step).

export const TASTE = {
  under: ['sour', 'sharp', 'lemon', 'vegetal', 'salty', 'vinegar'],
  over: ['bitter', 'ashy', 'dry', 'burnt', 'astringent', 'medicinal'],
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

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round1 = (n) => Math.round(n * 10) / 10;
const roundHalf = (n) => Math.round(n * 2) / 2;

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

export function classifyTaste(notes, roast) {
  const picked = notes.map((n) => n.toLowerCase());
  const count = (list) => picked.filter((n) => list.includes(n)).length;
  const under = count(TASTE.under);
  const over = count(TASTE.over);
  const balanced = count(balancedNotes(roast));
  const weak = count(TASTE.body.weak);
  const heavy = count(TASTE.body.heavy);
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

  return { under, over, balanced, body, dir, minor, strength: under + over, contradictoryBody };
}

export function prepInfo(prep = 'tamp', screen = false) {
  const wdt = prep.includes('wdt');
  const shaker = prep.includes('shaker');
  return { wdt, shaker, screen: !!screen, maxed: wdt && !!screen };
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

function grindAmount({ dirWord, shot, profile, win, strength }) {
  const level = stepLevel(shot.time, win, strength);
  const stepped = profile.grinder !== 'stepless';
  const sens = profile.sensitivity > 0 ? profile.sensitivity : null;
  if (sens && Number.isFinite(shot.time)) {
    const gap = Math.max(2, Math.abs(win.mid - shot.time));
    const raw = gap / sens;
    const steps = stepped ? clamp(Math.round(raw), 1, 6) : clamp(round1(raw), 0.1, 5);
    const expectedTime = Math.round(shot.time + (dirWord === 'finer' ? 1 : -1) * steps * sens);
    return { steps, level, calibrated: true, expectedTime };
  }
  if (stepped) return { steps: [1, 2, 3][level - 1], level, calibrated: false };
  return { steps: null, level, calibrated: false, label: ['a small nudge', 'a moderate move', 'a big move'][level - 1] };
}

function grindRec({ dirWord, shot, profile, win, taste }) {
  const amt = grindAmount({ dirWord, shot, profile, win, strength: taste.strength });
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
  };
}

function yieldRec({ up, shot, level }) {
  const stepG = Math.max(0.5, roundHalf(shot.dose * 0.1 * level));
  const to = roundHalf(clamp(shot.yield + (up ? stepG : -stepG), shot.dose * 1, shot.dose * 3.5));
  const newRatio = (to / shot.dose).toFixed(2).replace(/0$/, '');
  return {
    type: 'yield',
    headline: up ? 'Pull a longer shot' : 'Pull a shorter shot',
    detail: up
      ? `Stop at ${to}g instead of ${shot.yield}g (about 1:${newRatio}). More water pulls out more sweetness without touching the grind.`
      : `Stop at ${to}g instead of ${shot.yield}g (about 1:${newRatio}). Cutting the shot earlier leaves the bitter tail out of the cup.`,
    changes: { yield: { from: shot.yield, to } },
  };
}

function prepRec(prep, shot) {
  if (!prep.wdt) {
    const to = prep.shaker ? 'shaker_wdt_tamp' : 'wdt_tamp';
    return {
      type: 'prep',
      headline: 'Add WDT before tamping',
      detail: 'Stir the grounds with a fine needle tool, then level-tamp. Uneven beds let water bypass parts of the puck and give sour and bitter in the same cup.',
      changes: { prep: to },
    };
  }
  if (!prep.screen) {
    return {
      type: 'prep',
      headline: 'Add a puck screen',
      detail: 'A screen spreads water evenly over the bed. Keep the grind and everything else the same for this shot.',
      changes: { screen: true },
    };
  }
  return {
    type: 'prep',
    headline: 'Slow-feed the grinder and level the tamp',
    detail: 'Your prep is already thorough. Feed beans slowly into the grinder to reduce clumps, check the dose fits your basket, and tamp level. Keep the grind setting unchanged.',
    changes: {},
  };
}

// Chooses the single most useful change for this shot. `prev` is the previous logged shot
// of the same coffee (needed for overshoot detection), or null.
export function diagnose({ shot, profile = DEFAULT_PROFILE, prev = null }) {
  const error = validate(shot);
  if (error) return { ok: false, error };

  const ratio = shot.yield / shot.dose;
  const win = timeWindow(ratio);
  const hasTime = Number.isFinite(shot.time) && shot.time > 0;
  const timeStatus = !hasTime ? 'unknown' : shot.time < win.lo ? 'fast' : shot.time > win.hi ? 'slow' : 'in';
  const upperHalf = hasTime && shot.time > win.mid;
  const taste = classifyTaste(shot.notes, shot.roast);
  const prep = prepInfo(shot.prep, shot.screen);
  const level = stepLevel(hasTime ? shot.time : NaN, win, taste.strength);
  const notes = [];
  let dir = taste.dir;

  if (taste.contradictoryBody) {
    notes.push({ kind: 'info', text: 'You picked both a thin and a heavy body note. They cancel out, so body was ignored. Re-taste if body is the main problem.' });
  }
  if (!hasTime) {
    notes.push({ kind: 'tip', text: 'Add the shot time. It tells the app whether to change grind or ratio, and lets it learn your grinder.' });
  }

  // Both sour and bitter on a very slow shot is usually a choked, too-fine grind.
  if (dir === 'mixed' && timeStatus === 'slow') {
    dir = 'over';
    notes.push({ kind: 'info', text: 'Sour and bitter together on a slow shot usually means the grind is too fine and the flow chokes.' });
  }

  const channel =
    dir === 'mixed' || (dir === 'over' && timeStatus === 'fast') || (dir === 'under' && timeStatus === 'slow');

  let primary;
  let then = '';

  // Overshoot: last change flipped the taste, so go back roughly halfway.
  if (
    prev &&
    (dir === 'under' || dir === 'over') &&
    (prev.dir === 'under' || prev.dir === 'over') &&
    prev.dir !== dir &&
    Number.isFinite(prev.grind) &&
    Number.isFinite(shot.grind) &&
    prev.grind !== shot.grind &&
    !channel
  ) {
    let to = profile.grinder === 'stepless' ? round1((prev.grind + shot.grind) / 2) : Math.round((prev.grind + shot.grind) / 2);
    if (to === shot.grind) to = shot.grind + Math.sign(prev.grind - shot.grind);
    primary = {
      type: 'revert',
      headline: 'You overshot. Go back about halfway',
      detail: `The last shot was ${prev.dir === 'under' ? 'sour' : 'bitter'} at ${prev.grind} and this one is ${dir === 'under' ? 'sour' : 'bitter'} at ${shot.grind}. The sweet spot is between them. Try ${to}.`,
      changes: { grind: { from: shot.grind, to, dir: 'revert' } },
    };
    then = 'Change nothing else, so you know the result comes from the grind.';
  } else if (channel) {
    if (!prep.maxed) {
      primary = prepRec(prep, shot);
      then = 'Once the puck is even, repeat the shot with the same grind and re-taste before changing anything else.';
    } else if (dir === 'mixed') {
      primary = prepRec(prep, shot);
      then = 'If it keeps happening, the grinder may be the limit (fines or clumping).';
    } else if (dir === 'over') {
      primary = yieldRec({ up: false, shot, level });
      notes.push({ kind: 'info', text: `Bitter on a fast shot (${shot.time}s) with thorough prep is unusual. A shorter shot is the safest fix. If the shot really ran fast, check dose and basket fit too.` });
    } else {
      primary = yieldRec({ up: true, shot, level });
      notes.push({ kind: 'info', text: `Sour on a slow shot (${shot.time}s) with thorough prep is unusual. A longer shot is the safest fix. Check for late channeling or a temperature drop.` });
    }
  } else if (dir === 'under') {
    const grindFirst = timeStatus !== 'in' || !upperHalf;
    primary = grindFirst
      ? grindRec({ dirWord: 'finer', shot, profile, win, taste })
      : yieldRec({ up: true, shot, level });
    then = grindFirst
      ? `Re-taste. If it is still sour once the shot is inside ${Math.round(win.lo)}-${Math.round(win.hi)}s, make the shot longer next.`
      : 'If it is still sour, grind a little finer next.';
  } else if (dir === 'over') {
    const darkInRange = shot.roast === 'dark' && timeStatus === 'in';
    const grindFirst = !darkInRange && (timeStatus === 'slow' || timeStatus === 'unknown' || upperHalf);
    primary = grindFirst
      ? grindRec({ dirWord: 'coarser', shot, profile, win, taste })
      : yieldRec({ up: false, shot, level });
    then = grindFirst
      ? `Re-taste. If it is still bitter once the shot is inside ${Math.round(win.lo)}-${Math.round(win.hi)}s, make the shot shorter next.`
      : 'If it is still bitter, grind a little coarser next.';
  } else if (taste.body < 0) {
    primary = yieldRec({ up: false, shot, level: 1 });
    primary.detail = `Taste is balanced but the body is thin. ${primary.detail}`;
    then = 'If it is still thin, try 0.5g more dose.';
  } else if (taste.body > 0) {
    primary = yieldRec({ up: true, shot, level: 1 });
    primary.detail = `Taste is balanced but the body is heavy. ${primary.detail}`;
  } else {
    primary = {
      type: 'hold',
      headline: 'Lock it in',
      detail: 'Balanced. Save this recipe and make the next shot the same way to confirm it repeats.',
      changes: {},
    };
  }

  if (taste.minor) {
    notes.push({ kind: 'info', text: `A mild ${taste.minor === 'under' ? 'sour' : 'bitter'} note showed up beside the balanced ones. Only chase it if you want to fine-tune.` });
  }

  // Temperature is second-order: only mentioned once the main lever is in range, and only if
  // the user said their machine lets them change it.
  if (shot.temp && shot.temp !== 'fixed' && primary.type !== 'prep') {
    if (shot.roast === 'light' && dir === 'under' && shot.temp !== 'high') {
      notes.push({ kind: 'tip', text: 'Light roasts are dense. If it is still sour after the grind is right, try a higher brew temperature (93°C or more).' });
    } else if (shot.roast === 'dark' && dir === 'over' && shot.temp !== 'low') {
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
    channeling: channel,
    lockIn: primary.type === 'hold',
    primary,
    then,
    notes,
  };
}

// Returns the form values for the next shot with the recommended change applied.
export function nextShotFrom(shot, primary) {
  const next = { ...shot, time: '', notes: [] };
  const c = primary.changes || {};
  if (c.grind && c.grind.to != null) next.grind = c.grind.to;
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
