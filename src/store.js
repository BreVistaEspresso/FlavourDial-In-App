// localStorage persistence. Every access is wrapped: storage can be blocked or full
// (private mode, iOS eviction), and the app must keep working in memory when it is.
import { DEFAULT_PROFILE } from './engine.js';

const PROFILE_KEY = 'brevista_profile_v1';
const HISTORY_KEY = 'brevista_history_v3';
const MAX_HISTORY = 200;

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadProfile = () => ({ ...DEFAULT_PROFILE, ...read(PROFILE_KEY, {}) });
export const saveProfile = (profile) => write(PROFILE_KEY, profile);

export const loadHistory = () => {
  const h = read(HISTORY_KEY, []);
  return Array.isArray(h) ? h : [];
};
export const saveHistory = (history) => write(HISTORY_KEY, history.slice(0, MAX_HISTORY));

export function clearAll() {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

export const coffeeKey = (roaster, coffee) =>
  `${(roaster || '').trim().toLowerCase()}|${(coffee || '').trim().toLowerCase()}`;

// History is newest-first, so the first match is the previous shot of that coffee.
export const previousShot = (history, key) => history.find((e) => e.key === key) || null;
