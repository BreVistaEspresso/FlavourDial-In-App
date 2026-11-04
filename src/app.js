import {
  TASTE,
  startRatio,
  balancedNotes,
  diagnose,
  nextShotFrom,
  learnSensitivity,
  learnRatio,
  timeWindow,
} from './engine.js';
import { loadProfile, saveProfile, loadHistory, saveHistory, coffeeKey, previousShot } from './store.js';

const root = document.getElementById('app');

const state = {
  view: 'dial',
  profile: loadProfile(),
  history: loadHistory(),
  notes: new Set(),
  result: null,
  pending: null, // { shot, result } for the diagnosis currently on screen
  error: '',
  confirmClear: false,
  timer: { running: false, start: 0, id: null },
  form: null,
};
state.form = freshForm();
if (!state.profile.onboarded) state.view = 'setup';

function freshForm(over = {}) {
  const roast = over.roast || 'medium';
  const dose = 18;
  return {
    roaster: '', coffee: '', roast, dose, yield: Math.round(dose * startRatio(state.profile, roast) * 2) / 2,
    grind: '', time: '', temp: 'fixed', prep: 'wdt_tamp', screen: false, fill: 'unchecked', ...over,
  };
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const fin = (n) => (Number.isFinite(n) ? n : null);

function readShot() {
  const f = state.form;
  return {
    dose: num(f.dose), yield: num(f.yield), grind: num(f.grind), time: num(f.time),
    roast: f.roast, prep: f.prep, screen: f.screen, temp: f.temp, fill: f.fill, notes: [...state.notes],
  };
}

/* ---------- views ---------- */

const GRINDERS = [
  ['stepped', 'Stepped', 'Clicks or numbered settings. Advice comes as a number of clicks.'],
  ['stepless', 'Stepless', 'Continuous dial. Advice starts as small/medium/big moves, then learns your dial.'],
  ['builtin', 'Built-in grinder', 'Machine with a grinder inside (for example Breville Barista Express). Treated as numbered settings.'],
];

const ICON = (d) => `<svg class="pi" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const PREP_OPTIONS = [
  ['tamp', 'Tamp Only', ICON('<rect x="4" y="15" width="16" height="5" rx="1.5"/><path d="M12 15V4M8 4h8"/>')],
  ['wdt_tamp', '+WDT', ICON('<path d="M12 3v12M7 5l1.5 10M17 5l-1.5 10M12 15v6"/>')],
  ['shaker_tamp', '+Blind Shaker', ICON('<path d="M5 7h14l-2 12H7z"/><path d="M9 11v.01M12 14v.01M15 11v.01M12 10v.01"/>')],
  ['shaker_wdt_tamp', '+Both', ICON('<path d="M5 6h14l-2 9H7z"/><path d="M12 15v6M9 15l.5 4M15 15l-.5 4"/>')],
];

const FILL_EXPLAINER = `
  <h3>Fill the basket for your coffee</h3>
  <p>Beans differ in density. Light roasts take up less space than dark roasts, even when the weight is the same.</p>
  <p>After a firm, level tamp, the puck should sit a small, even distance below the shower screen. It should neither touch the screen nor leave a big empty space above it.</p>
  <p>Too little coffee, and the shot can run fast and thin, and the puck is easier to disturb.</p>
  <p>Too much coffee presses the puck against the screen. The shot can run slow and be hard to read.</p>`;

function setupView() {
  const p = state.profile;
  const learned = p.sensitivity > 0
    ? `Learned: about ${p.sensitivity}s of shot time per ${p.grinder === 'stepless' ? 'dial unit' : 'step'}.`
    : 'Nothing learned yet. After two shots where only the grind changed, the app learns how far your grinder moves the shot time.';
  return `
    <section class="card">
      <h2>${p.onboarded ? 'Your grinder' : 'Welcome. What grinder do you use?'}</h2>
      <p class="muted">This only changes how advice is worded. Shot time is what the app learns from.</p>
      <div class="options" role="radiogroup" aria-label="Grinder type">
        ${GRINDERS.map(([v, name, desc]) => `
          <button type="button" role="radio" aria-checked="${p.grinder === v}" class="option ${p.grinder === v ? 'on' : ''}" data-action="set-grinder" data-value="${v}">
            <strong>${name}</strong><span>${desc}</span>
          </button>`).join('')}
      </div>
      <h3>On your grinder, a higher number means</h3>
      <div class="seg" role="radiogroup" aria-label="Grind direction">
        <button type="button" role="radio" aria-checked="${p.finerIs === 'lower'}" class="${p.finerIs === 'lower' ? 'on' : ''}" data-action="set-finer" data-value="lower">Coarser</button>
        <button type="button" role="radio" aria-checked="${p.finerIs === 'higher'}" class="${p.finerIs === 'higher' ? 'on' : ''}" data-action="set-finer" data-value="higher">Finer</button>
      </div>
      <h3>Burr shape <span class="muted">(optional)</span></h3>
      <div class="seg" role="radiogroup" aria-label="Burr shape">
        ${['unknown', 'conical', 'flat'].map((b) => `<button type="button" role="radio" aria-checked="${p.burr === b}" class="${p.burr === b ? 'on' : ''}" data-action="set-burr" data-value="${b}">${cap(b === 'unknown' ? "Not sure" : b)}</button>`).join('')}
      </div>
      <p class="muted small">${esc(learned)}</p>
      <div class="explainer">${FILL_EXPLAINER}</div>
      ${p.sensitivity > 0 ? '<button type="button" class="link" data-action="reset-cal">Reset learned grinder data</button>' : ''}
      <button type="button" class="btn primary" data-action="finish-setup">${p.onboarded ? 'Done' : 'Start dialing in'}</button>
    </section>`;
}

function chip(note) {
  const on = state.notes.has(note);
  return `<button type="button" class="chip ${on ? 'on' : ''}" aria-pressed="${on}" data-action="note" data-note="${note}">${cap(note)}</button>`;
}

function stepper(field, label, opts = {}) {
  const v = esc(state.form[field]);
  const mode = opts.text ? 'decimal' : 'decimal';
  return `
    <div class="field">
      <label for="f-${field}">${label}</label>
      <div class="stepper">
        <button type="button" aria-label="Decrease ${label}" data-action="step" data-field="${field}" data-delta="${-opts.step}">−</button>
        <input id="f-${field}" data-field="${field}" inputmode="${mode}" autocomplete="off" value="${v}" placeholder="${opts.placeholder || ''}">
        <button type="button" aria-label="Increase ${label}" data-action="step" data-field="${field}" data-delta="${opts.step}">+</button>
      </div>
    </div>`;
}

function select(field, label, options) {
  return `
    <div class="field">
      <label for="f-${field}">${label}</label>
      <select id="f-${field}" data-field="${field}">
        ${options.map(([v, t]) => `<option value="${v}" ${state.form[field] === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>`;
}

function dialView() {
  const f = state.form;
  const grindStep = state.profile.grinder === 'stepless' ? 0.1 : 1;
  const prev = previousShot(state.history, coffeeKey(f.roaster, f.coffee));
  const win = timeWindow(num(f.yield) / num(f.dose));
  const timerLabel = state.timer.running ? 'Stop timer' : 'Start timer';
  return `
    <section class="card">
      <h2>1. Coffee</h2>
      <div class="grid">
        <div class="field"><label for="f-roaster">Roaster</label><input id="f-roaster" data-field="roaster" value="${esc(f.roaster)}" placeholder="e.g. Onyx" autocomplete="off"></div>
        <div class="field"><label for="f-coffee">Coffee</label><input id="f-coffee" data-field="coffee" value="${esc(f.coffee)}" placeholder="e.g. Monarch" autocomplete="off"></div>
        ${select('roast', 'Roast', [['light', 'Light'], ['medium', 'Medium'], ['dark', 'Dark']])}
      </div>
      ${prev ? `<p class="muted small">Last shot of this coffee: grind ${prev.grind ?? '?'}, ${prev.time ?? '?'}s, ${esc(prev.top)}.</p>` : ''}
    </section>

    <section class="card">
      <h2>2. Shot</h2>
      ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ''}
      <div class="grid">
        ${stepper('dose', 'Dose in (g)', { step: 0.5 })}
        ${stepper('yield', 'Yield out (g)', { step: 1 })}
        ${stepper('grind', 'Grind setting', { step: grindStep, placeholder: 'e.g. 10' })}
        ${stepper('time', 'Time (s)', { step: 1, placeholder: `${Math.round(win.lo)}-${Math.round(win.hi)}` })}
      </div>
      <button type="button" class="btn ghost" data-action="timer" id="timer-btn">${timerLabel}</button>
      <p class="muted small">Ratio 1:${(num(f.yield) / num(f.dose) || 0).toFixed(1)}. Target time for this ratio is about ${Math.round(win.lo)}-${Math.round(win.hi)}s.</p>
      ${select('fill', 'Dose check - Basket fill (optional)', [['unchecked', "Didn't check"], ['level', 'Looked right'], ['under', 'Under-filled'], ['over', 'Over-filled']])}
      <details class="disclosure">
        <summary><span class="d-icon" aria-hidden="true">i</span>How to fill the basket<span class="d-chev" aria-hidden="true"></span></summary>
        <div class="explainer">${FILL_EXPLAINER}</div>
      </details>
      <div class="prep-temp">
        <h3>Prep and Temp</h3>
        <div class="field prep-field">
          <span class="lbl" id="prep-label">Puck prep</span>
          <div class="pills" role="radiogroup" aria-labelledby="prep-label">
            ${PREP_OPTIONS.map(([v, t, icon]) => `<button type="button" class="pill-opt ${f.prep === v ? 'on' : ''}" role="radio" aria-checked="${f.prep === v}" data-action="pick" data-field="prep" data-value="${v}">${icon}${t}</button>`).join('')}
          </div>
        </div>
        <button type="button" class="toggle-row" role="switch" aria-checked="${Boolean(f.screen)}" data-action="toggle" data-field="screen">
          <span>Puck screen</span><span class="switch" aria-hidden="true"></span>
        </button>
        ${select('temp', 'Brew temperature', [['fixed', 'Not adjustable / unsure'], ['low', 'Set low (91°C or less)'], ['medium', 'Set standard'], ['high', 'Set high (93°C+)']])}
      </div>
    </section>

    <section class="card">
      <h2>3. Taste</h2>
      <p class="muted small">Pick everything you notice.</p>
      <h3 class="g-under">Sour side</h3><div class="chips">${TASTE.under.map(chip).join('')}</div>
      <h3 class="g-over">Bitter side</h3><div class="chips">${TASTE.over.map(chip).join('')}</div>
      <h3 class="g-over">Could be either</h3><div class="chips">${TASTE.neutral.map(chip).join('')}</div>
      <h3 class="g-bal">Good notes (${f.roast} roast)</h3><div class="chips">${balancedNotes(f.roast).map(chip).join('')}</div>
      <h3 class="g-body">Body</h3><div class="chips">${[...TASTE.body.weak, ...TASTE.body.optimal, ...TASTE.body.heavy].map(chip).join('')}</div>
      <button type="button" class="btn primary" data-action="diagnose">Diagnose shot</button>
    </section>
    ${state.result ? resultView() : ''}`;
}

const TYPE_LABEL = { grind: 'Grind', yield: 'Shot length', prep: 'Puck prep', revert: 'Grind', hold: 'Done', dose: 'Dose', check: 'Check' };

// Needle position on the sour-bitter gauge, -1 (sour) to +1 (bitter). Mixed or balanced reads centre;
// the channeling banner explains mixed.
function gaugePos(r) {
  if (r.dir !== 'under' && r.dir !== 'over') return 0;
  const strength = r.dir === 'under' ? r.taste.under : r.taste.over;
  const mag = Math.min(1, 0.45 + 0.2 * strength);
  return r.dir === 'under' ? -mag : mag;
}

function gaugeSvg(r) {
  const pos = gaugePos(r);
  let ticks = '';
  for (let a = 180; a >= 0; a -= 15) {
    const rad = (a * Math.PI) / 180;
    const r1 = a % 45 === 0 ? 78 : 84;
    ticks += `<line x1="${(130 + r1 * Math.cos(rad)).toFixed(1)}" y1="${(130 - r1 * Math.sin(rad)).toFixed(1)}" x2="${(130 + 92 * Math.cos(rad)).toFixed(1)}" y2="${(130 - 92 * Math.sin(rad)).toFixed(1)}"/>`;
  }
  const reading = pos < 0 ? 'sour' : pos > 0 ? 'bitter' : r.channeling ? 'sour and bitter together' : 'balanced';
  return `
    <svg class="gauge" viewBox="0 0 260 158" role="img" aria-label="Gauge: the shot reads ${reading}, the target is balanced">
      <path class="track" d="M30 130 A100 100 0 0 1 230 130" fill="none" stroke-width="12" stroke-linecap="round"/>
      <path class="zone" d="M104 37.5 A100 100 0 0 1 156 37.5" fill="none" stroke-width="12"/>
      <g class="tk" stroke-width="2">${ticks}</g>
      <g class="needle" style="transform: rotate(${(pos * 75).toFixed(0)}deg)">
        <line x1="130" y1="130" x2="130" y2="44" stroke="#F59E0B" stroke-width="4" stroke-linecap="round"/>
      </g>
      <circle cx="130" cy="130" r="9" fill="#F59E0B"/><circle cx="130" cy="130" r="3.5" fill="#2A1632"/>
      <text x="22" y="150">SOUR</text>
      <text x="130" y="22" text-anchor="middle">BALANCED</text>
      <text x="238" y="150" text-anchor="end">BITTER</text>
    </svg>`;
}

function resultView() {
  const r = state.result;
  const t = state.pending?.shot.time;
  const timeTxt = Number.isFinite(t) ? `${Math.round(t * 10) / 10}<i>s</i>` : '–';
  return `
    <section class="card result" id="result" aria-live="polite">
      <div class="rule"></div>
      <h2>Next move</h2>
      ${r.channeling ? `<p class="banner">${r.channelling.level === 'strong' ? 'Strong channelling signals' : 'Channelling is likely'}: water may be bypassing part of the puck. This is a likely cause, not a diagnosis.</p>` : ''}
      ${gaugeSvg(r)}
      <div class="bezel">
        <div><small>Time</small><b>${timeTxt}</b></div>
        <div><small>Window</small><b>${Math.round(r.window.lo)}–${Math.round(r.window.hi)}</b></div>
        <div><small>Ratio</small><b>1:${r.ratio.toFixed(1)}</b></div>
      </div>
      <div class="primary">
        <span class="tag">${TYPE_LABEL[r.primary.type]}</span>
        <h3>${esc(r.primary.headline)}</h3>
        <p>${esc(r.primary.detail)}</p>
      </div>
      ${r.then ? `<p class="then"><strong>After that:</strong> ${esc(r.then)}</p>` : ''}
      ${r.notes.map((n) => `<p class="note ${n.kind}">${esc(n.text)}</p>`).join('')}
      <button type="button" class="btn primary" data-action="save">${r.lockIn ? 'Save and lock in recipe' : 'Save shot and set up next'}</button>
      <button type="button" class="btn ghost" data-action="edit">Edit this shot</button>
    </section>`;
}

function miniMeter(dir) {
  const at = dir === 'under' ? 14 : dir === 'over' ? 86 : 50;
  const word = dir === 'under' ? 'Leaning sour' : dir === 'over' ? 'Leaning bitter' : 'Balanced or mixed';
  return `<div class="mini" role="img" aria-label="${word}"><div class="mini-track"><i class="mini-zone"></i><i class="mini-mark" style="left:${at}%"></i></div><div class="mini-labels"><span>Sour</span><span>Balanced</span><span>Bitter</span></div></div>`;
}

function logView() {
  const h = state.history;
  return `
    <section class="card">
      <div class="row"><h2>Logbook</h2>
        ${h.length ? `<button type="button" class="link" data-action="export">Export JSON</button>
        <button type="button" class="link danger" data-action="clear-log">${state.confirmClear ? 'Tap again to delete all' : 'Clear'}</button>` : ''}
      </div>
      ${h.length === 0 ? '<p class="muted">No shots yet. Save a diagnosed shot to start your log.</p>' : `<div class="entries">${h.map((e) => `
        <article class="entry">
          <div class="entry-head"><h3>${esc(e.coffee || 'Untitled coffee')}</h3><span class="muted small">${e.roaster ? `${esc(e.roaster)} · ` : ''}${new Date(e.ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div>
          ${miniMeter(e.dir)}
          <div class="bezel">
            <div><small>Time</small><b>${e.time ?? '–'}<i>s</i></b></div>
            <div><small>Ratio</small><b>1:${(e.ratio || 0).toFixed(1)}</b></div>
            <div><small>Grind</small><b>${e.grind ?? '–'}</b></div>
          </div>
          <p class="muted small dose">${e.dose}g in → ${e.yield}g out</p>
          <div class="chips small">${e.notes.map((n) => `<span class="chip static">${esc(cap(n))}</span>`).join('')}</div>
          <p class="advice"><span class="tag">Advice</span> ${esc(e.top)}</p>
        </article>`).join('')}</div>`}
    </section>`;
}

function render() {
  const nav = state.view === 'setup' && !state.profile.onboarded ? '' : `
    <button type="button" class="navbtn" data-action="view" data-value="${state.view === 'log' ? 'dial' : 'log'}">${state.view === 'log' ? 'Back to dial-in' : `Logbook${state.history.length ? ` (${state.history.length})` : ''}`}</button>
    <button type="button" class="navbtn" aria-label="Grinder settings" data-action="view" data-value="${state.view === 'setup' ? 'dial' : 'setup'}">Grinder</button>`;
  root.innerHTML = `
    <header class="top"><div class="brand"><img src="icons/icon.svg" alt="" width="28" height="28"><span>Flavour <b>Dial-In</b></span></div><div class="studio">BreVista Studio</div><nav>${nav}</nav></header>
    <main>${state.view === 'setup' ? setupView() : state.view === 'log' ? logView() : dialView()}</main>
    <div id="toast" class="toast" role="status" hidden></div>`;
}

/* ---------- actions ---------- */

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 4500);
}

function persistProfile() { saveProfile(state.profile); }

function runDiagnose() {
  state.error = '';
  const shot = readShot();
  const prev = previousShot(state.history, coffeeKey(state.form.roaster, state.form.coffee));
  const result = diagnose({ shot, profile: state.profile, prev });
  if (!result.ok) {
    state.error = result.error;
    state.result = null;
    render();
    return;
  }
  state.result = result;
  state.pending = { shot, result };
  render();
  document.getElementById('result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveShot() {
  if (!state.pending) return;
  const { shot, result } = state.pending;
  const f = state.form;
  const key = coffeeKey(f.roaster, f.coffee);
  const prev = previousShot(state.history, key);
  const entry = {
    id: Date.now().toString(36), ts: new Date().toISOString(), key,
    roaster: f.roaster.trim(), coffee: f.coffee.trim(), roast: shot.roast,
    dose: shot.dose, yield: shot.yield, ratio: result.ratio,
    grind: fin(shot.grind), time: fin(shot.time), temp: shot.temp, prep: shot.prep, screen: shot.screen,
    notes: shot.notes, dir: result.dir, top: result.primary.headline,
    cls: result.cls, lever: result.lever, tried: result.tried, fill: shot.fill || 'unchecked',
  };
  state.profile.sensitivity = learnSensitivity(prev, entry, state.profile);
  if (result.lockIn) state.profile.prefRatio = learnRatio(state.profile, result.ratio);
  persistProfile();
  state.history = [entry, ...state.history];
  const stored = saveHistory(state.history);

  const next = nextShotFrom(shot, result.primary);
  state.form = {
    ...f, dose: next.dose, yield: next.yield, grind: next.grind == null || Number.isNaN(next.grind) ? '' : next.grind,
    time: '', prep: next.prep, screen: next.screen, fill: 'unchecked',
  };
  state.notes = new Set();
  state.result = null;
  state.pending = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(result.lockIn
    ? 'Recipe locked in. Your preferred ratio was updated.'
    : `Saved. Next shot is set up: ${result.primary.headline.toLowerCase()}.${stored ? '' : ' (Storage is full or blocked, so the log is not being kept.)'}`);
}

function exportLog() {
  const blob = new Blob([JSON.stringify(state.history, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `brevista-shots-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toggleTimer() {
  const t = state.timer;
  const btn = document.getElementById('timer-btn');
  if (!t.running) {
    t.running = true;
    t.start = performance.now();
    t.id = setInterval(() => {
      if (btn) btn.textContent = `Stop timer (${((performance.now() - t.start) / 1000).toFixed(0)}s)`;
    }, 200);
    if (btn) btn.textContent = 'Stop timer (0s)';
  } else {
    clearInterval(t.id);
    t.running = false;
    state.form.time = String(Math.round((performance.now() - t.start) / 1000));
    const input = document.getElementById('f-time');
    if (input) input.value = state.form.time;
    if (btn) btn.textContent = 'Start timer';
  }
}

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, value, field, note, delta } = el.dataset;
  switch (action) {
    case 'view': state.view = value; state.confirmClear = false; render(); window.scrollTo(0, 0); break;
    case 'set-grinder':
      state.profile.grinder = value;
      if (value === 'builtin') state.profile.finerIs = 'lower';
      persistProfile(); render(); break;
    case 'set-finer': state.profile.finerIs = value; persistProfile(); render(); break;
    case 'set-burr': state.profile.burr = value; persistProfile(); render(); break;
    case 'reset-cal': state.profile.sensitivity = null; persistProfile(); render(); break;
    case 'finish-setup': state.profile.onboarded = true; persistProfile(); state.view = 'dial'; render(); break;
    case 'note': {
      if (state.notes.has(note)) state.notes.delete(note); else state.notes.add(note);
      el.classList.toggle('on', state.notes.has(note));
      el.setAttribute('aria-pressed', String(state.notes.has(note)));
      break;
    }
    case 'step': {
      const input = document.getElementById(`f-${field}`);
      const next = Math.round(((num(input.value) || 0) + Number(delta)) * 10) / 10;
      input.value = String(Math.max(0, next));
      state.form[field] = input.value;
      break;
    }
    case 'pick': {
      state.form[field] = value;
      el.closest('.pills').querySelectorAll('.pill-opt').forEach((b) => {
        const on = b === el;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      break;
    }
    case 'toggle': {
      state.form[field] = !state.form[field];
      el.setAttribute('aria-checked', String(Boolean(state.form[field])));
      break;
    }
    case 'timer': toggleTimer(); break;
    case 'diagnose': runDiagnose(); break;
    case 'edit': state.result = null; render(); break;
    case 'save': saveShot(); break;
    case 'export': exportLog(); break;
    case 'clear-log':
      if (state.confirmClear) { state.history = []; saveHistory([]); state.confirmClear = false; }
      else state.confirmClear = true;
      render(); break;
    default:
  }
});

root.addEventListener('input', (e) => {
  const field = e.target.dataset?.field;
  if (!field || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
  state.form[field] = e.target.value;
});

root.addEventListener('change', (e) => {
  const field = e.target.dataset?.field;
  if (!field) return;
  if (e.target.type === 'checkbox') { state.form[field] = e.target.checked; return; }
  state.form[field] = e.target.value;
  if (field === 'roast') {
    const valid = new Set([...TASTE.under, ...TASTE.over, ...TASTE.neutral, ...balancedNotes(e.target.value), ...TASTE.body.weak, ...TASTE.body.optimal, ...TASTE.body.heavy]);
    state.notes = new Set([...state.notes].filter((n) => valid.has(n)));
    state.result = null;
    render();
  }
});

render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
