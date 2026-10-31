import {
  TASTE,
  STARTING_RATIO,
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
  const ratio = state.profile.prefRatio || STARTING_RATIO;
  const dose = 18;
  return {
    roaster: '', coffee: '', roast: 'medium', dose, yield: Math.round(dose * ratio * 2) / 2,
    grind: '', time: '', temp: 'fixed', prep: 'wdt_tamp', screen: false, ...over,
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
    roast: f.roast, prep: f.prep, screen: f.screen, temp: f.temp, notes: [...state.notes],
  };
}

/* ---------- views ---------- */

const GRINDERS = [
  ['stepped', 'Stepped', 'Clicks or numbered settings. Advice comes as a number of clicks.'],
  ['stepless', 'Stepless', 'Continuous dial. Advice starts as small/medium/big moves, then learns your dial.'],
  ['builtin', 'Built-in grinder', 'Machine with a grinder inside (for example Breville Barista Express). Treated as numbered settings.'],
];

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
      <details>
        <summary>Prep and machine</summary>
        <div class="grid">
          ${select('prep', 'Puck prep', [['tamp', 'Grind and tamp'], ['wdt_tamp', 'WDT + tamp'], ['shaker_tamp', 'Blind shaker + tamp'], ['shaker_wdt_tamp', 'Shaker + WDT + tamp']])}
          <div class="field check"><label for="f-screen">Puck screen</label><input id="f-screen" type="checkbox" data-field="screen" ${f.screen ? 'checked' : ''}></div>
          ${select('temp', 'Brew temperature', [['fixed', 'Not adjustable / unsure'], ['low', 'Set low (91°C or less)'], ['medium', 'Set standard'], ['high', 'Set high (93°C+)']])}
        </div>
      </details>
    </section>

    <section class="card">
      <h2>3. Taste</h2>
      <p class="muted small">Pick everything you notice.</p>
      <h3 class="g-under">Sour side</h3><div class="chips">${TASTE.under.map(chip).join('')}</div>
      <h3 class="g-over">Bitter side</h3><div class="chips">${TASTE.over.map(chip).join('')}</div>
      <h3 class="g-bal">Good notes (${f.roast} roast)</h3><div class="chips">${balancedNotes(f.roast).map(chip).join('')}</div>
      <h3 class="g-body">Body</h3><div class="chips">${[...TASTE.body.weak, ...TASTE.body.optimal, ...TASTE.body.heavy].map(chip).join('')}</div>
      <button type="button" class="btn primary" data-action="diagnose">Diagnose shot</button>
    </section>
    ${state.result ? resultView() : ''}`;
}

const TYPE_LABEL = { grind: 'Grind', yield: 'Shot length', prep: 'Puck prep', revert: 'Grind', hold: 'Done' };

function resultView() {
  const r = state.result;
  const timeTxt = r.timeStatus === 'unknown' ? 'no time' : `${r.timeStatus === 'in' ? 'in range' : r.timeStatus}`;
  return `
    <section class="card result" id="result" aria-live="polite">
      <div class="row"><h2>Next move</h2>
        <span class="pill">1:${r.ratio.toFixed(1)}</span><span class="pill">${esc(timeTxt)}</span></div>
      ${r.channeling ? '<p class="banner">Channeling is likely: water is bypassing part of the puck.</p>' : ''}
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

function logView() {
  const h = state.history;
  return `
    <section class="card">
      <div class="row"><h2>Logbook</h2>
        ${h.length ? `<button type="button" class="link" data-action="export">Export JSON</button>
        <button type="button" class="link danger" data-action="clear-log">${state.confirmClear ? 'Tap again to delete all' : 'Clear'}</button>` : ''}
      </div>
      ${h.length === 0 ? '<p class="muted">No shots yet. Save a diagnosed shot to start your log.</p>' : h.map((e) => `
        <article class="entry">
          <div class="row"><strong>${esc(e.coffee || 'Untitled coffee')}${e.roaster ? ` · ${esc(e.roaster)}` : ''}</strong><span class="muted small">${new Date(e.ts).toLocaleString()}</span></div>
          <div class="stats">
            <span class="pill">1:${(e.ratio || 0).toFixed(1)}</span>
            <span class="pill">grind ${e.grind ?? '–'}</span>
            <span class="pill">${e.time ?? '–'}s</span>
            <span class="pill">${e.dose}g → ${e.yield}g</span>
          </div>
          <div class="chips small">${e.notes.map((n) => `<span class="chip static">${esc(cap(n))}</span>`).join('')}</div>
          <p class="muted small">Advice: ${esc(e.top)}</p>
        </article>`).join('')}
    </section>`;
}

function render() {
  const nav = state.view === 'setup' && !state.profile.onboarded ? '' : `
    <button type="button" class="navbtn" data-action="view" data-value="${state.view === 'log' ? 'dial' : 'log'}">${state.view === 'log' ? 'Back to dial-in' : `Logbook${state.history.length ? ` (${state.history.length})` : ''}`}</button>
    <button type="button" class="navbtn" aria-label="Grinder settings" data-action="view" data-value="${state.view === 'setup' ? 'dial' : 'setup'}">Grinder</button>`;
  root.innerHTML = `
    <header class="top"><div class="brand"><img src="icons/icon.svg" alt="" width="28" height="28"><span>BreVista <b>Studio</b></span></div><nav>${nav}</nav></header>
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
  };
  state.profile.sensitivity = learnSensitivity(prev, entry, state.profile);
  if (result.lockIn) state.profile.prefRatio = learnRatio(state.profile, result.ratio);
  persistProfile();
  state.history = [entry, ...state.history];
  const stored = saveHistory(state.history);

  const next = nextShotFrom(shot, result.primary);
  state.form = {
    ...f, dose: next.dose, yield: next.yield, grind: next.grind == null || Number.isNaN(next.grind) ? '' : next.grind,
    time: '', prep: next.prep, screen: next.screen,
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
    const valid = new Set([...TASTE.under, ...TASTE.over, ...balancedNotes(e.target.value), ...TASTE.body.weak, ...TASTE.body.optimal, ...TASTE.body.heavy]);
    state.notes = new Set([...state.notes].filter((n) => valid.has(n)));
    state.result = null;
    render();
  }
});

render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
