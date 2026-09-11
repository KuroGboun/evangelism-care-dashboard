/**
 * Boot and wiring: sign-in, the admin gate, polling, the window chips, spend
 * refresh, and the local-only demo mode.
 */

import * as auth from './auth.js';
import {
  WINDOW_KEYS,
  fetchDashboard,
  refreshSpend,
  spendWaitMs,
  startPolling,
  stopPolling,
  subscribeNudges,
} from './data.js';
import { renderAll, clearAll, rebuildCharts, setPrintMode, setSpendControl, setSwitching } from './render.js';
import { minutesAgo, updatedAgo } from './format.js';

const $ = (selector) => document.querySelector(selector);
const WINDOW_STORE_KEY = 'ec-pastor-dashboard:window';
const TICK_MS = 10_000;

const state = {
  active: false,
  demo: false,
  demoVariant: '',
  demoPayload: null,
  windowKey: readWindow(),
  payload: null,
  receivedAt: 0,
  lastError: null,
  poller: null,
  stopNudges: null,
  ticker: null,
  spendKicked: false,
  spendBusy: false,
  spendNote: '',
  signingIn: false,
};

/* ---------- Remembered window (a per-browser convenience) ---------- */

function readWindow() {
  try {
    const saved = localStorage.getItem(WINDOW_STORE_KEY);
    return WINDOW_KEYS.includes(saved) ? saved : 'month';
  } catch {
    return 'month';
  }
}

function saveWindow(key) {
  try {
    localStorage.setItem(WINDOW_STORE_KEY, key);
  } catch {
    // Storage blocked: the choice just isn't remembered.
  }
}

/* ---------- Views ---------- */

function showSignIn({ message = '', mode = 'form' } = {}) {
  $('#dashboard-view').hidden = true;
  $('#signin-view').hidden = false;
  $('#boot-note').hidden = mode !== 'boot';
  $('#signin-form').hidden = mode !== 'form';
  $('#gate-retry').hidden = mode !== 'retry';
  $('#signin-status').textContent = mode === 'form' ? message : '';
  $('#gate-text').textContent = mode === 'retry' ? message : '';
}

function showDashboard() {
  $('#signin-view').hidden = true;
  $('#dashboard-view').hidden = false;
}

function hideNotices() {
  $('#stale-banner').hidden = true;
  $('#setup-card').hidden = true;
  $('#error-card').hidden = true;
  $('#sections').hidden = false;
}

function setSigningIn(on) {
  state.signingIn = on;
  const button = $('#signin-btn');
  button.disabled = on;
  button.textContent = on ? 'Signing in…' : 'Sign in';
}

function setRefreshing(on) {
  const button = $('#refresh-btn');
  button.disabled = on;
  button.textContent = on ? 'Refreshing…' : 'Refresh';
  document.querySelectorAll('[data-action="retry"]').forEach((retry) => {
    retry.disabled = on;
    retry.textContent = on ? 'Trying again…' : 'Try again';
  });
}

function syncChips() {
  document.querySelectorAll('.chip[data-window]').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(chip.dataset.window === state.windowKey));
  });
}

function updateSpendControl() {
  setSpendControl({
    busy: state.spendBusy,
    waitMs: state.demo ? 0 : spendWaitMs(),
    note: state.spendNote,
  });
}

function showStale() {
  const why = state.lastError?.kind === 'offline' ? "Can't reach the server." : 'The server ran into a problem.';
  const banner = $('#stale-banner');
  banner.textContent = `Showing figures from ${minutesAgo(Date.now() - state.receivedAt)}. ${why} Retrying.`;
  banner.hidden = false;
}

function tick() {
  if (state.receivedAt) $('#updated').textContent = updatedAgo(Date.now() - state.receivedAt);
  if (state.payload && state.lastError && !$('#stale-banner').hidden) showStale();
  updateSpendControl();
}

function startTicker() {
  stopTicker();
  state.ticker = setInterval(tick, TICK_MS);
}

function stopTicker() {
  if (state.ticker) clearInterval(state.ticker);
  state.ticker = null;
}

/* ---------- Gate ---------- */

function applyGate(result) {
  if (result.kind === 'admin') {
    $('#password').value = '';
    enterDashboard(result.profile);
  } else if (result.kind === 'transient') {
    showSignIn({ mode: 'retry', message: result.error });
  } else {
    showSignIn({ message: result.error });
  }
}

function enterDashboard(profile) {
  state.active = true;
  state.payload = null;
  state.receivedAt = 0;
  state.lastError = null;
  state.spendKicked = false;
  state.spendNote = '';

  clearAll();
  hideNotices();
  syncChips();
  setRefreshing(false);
  $('#who').textContent = profile?.name || 'Pastor';
  $('#updated').textContent = 'Loading figures';
  showDashboard();
  updateSpendControl();

  state.poller = startPolling({ load: loadCurrentWindow, onData, onError });
  try {
    state.stopNudges = subscribeNudges(() => state.poller?.now());
  } catch (err) {
    console.warn('Live updates are unavailable; figures still refresh every minute.', err);
  }
  startTicker();
}

function leaveDashboard(message = '') {
  state.active = false;
  stopPolling(state.poller);
  state.poller = null;
  if (state.stopNudges) state.stopNudges();
  state.stopNudges = null;
  stopTicker();

  state.payload = null;
  state.receivedAt = 0;
  state.lastError = null;
  state.spendBusy = false;
  state.spendNote = '';

  clearAll();
  hideNotices();
  setRefreshing(false);
  $('#who').textContent = '';
  $('#updated').textContent = '';
  $('#password').value = '';
  showSignIn({ message });
}

/* ---------- Data ---------- */

async function loadCurrentWindow() {
  const key = state.windowKey;
  const payload = await fetchDashboard(key);
  return { key, payload };
}

function onData({ key, payload }) {
  // A reply for a window the pastor has already switched away from; the queued fetch brings the right one.
  if (!state.active || key !== state.windowKey) return;
  state.payload = payload;
  state.receivedAt = Date.now();
  state.lastError = null;
  setRefreshing(false);
  hideNotices();
  renderAll(payload);
  tick();
  if (!state.spendKicked) {
    state.spendKicked = true;
    runSpendRefresh({ manual: false });
  }
}

function onError(err) {
  if (!state.active) return;
  setRefreshing(false);
  const kind = err?.kind || 'generic';

  if (kind === 'forbidden') {
    leaveDashboard(auth.MESSAGES.notAdmin);
    auth.signOut();
    return;
  }

  state.lastError = { kind, detail: err?.detail || err?.message || '' };

  if (state.payload) {
    setSwitching(false);
    showStale();
    return;
  }

  $('#sections').hidden = true;
  $('#stale-banner').hidden = true;
  if (kind === 'missing') {
    $('#error-card').hidden = true;
    $('#setup-card').hidden = false;
  } else {
    const offline = kind === 'offline';
    $('#setup-card').hidden = true;
    $('#error-title').textContent = offline ? "Can't reach the server" : "The dashboard didn't load";
    $('#error-text').textContent = offline
      ? 'Check your connection. The page keeps trying on its own.'
      : 'Something went wrong on the server. The page keeps trying on its own.';
    $('#error-pre').textContent = state.lastError.detail;
    $('#error-details').hidden = offline || !state.lastError.detail;
    $('#error-card').hidden = false;
  }
  $('#updated').textContent = 'Not loaded yet';
}

async function runSpendRefresh({ manual }) {
  if (state.demo) {
    if (manual) state.spendNote = 'Demo mode. Spend is not refreshed.';
    updateSpendControl();
    return;
  }
  if (!state.active || state.spendBusy) return;
  if (spendWaitMs() > 0) {
    updateSpendControl();
    return;
  }

  state.spendBusy = true;
  state.spendNote = '';
  updateSpendControl();
  let result;
  try {
    result = await refreshSpend();
  } finally {
    state.spendBusy = false;
  }
  if (!state.active) return;

  if (result.status === 'error' && manual) {
    state.spendNote = result.offline
      ? "Couldn't reach the server to refresh spend. Try again when you're back online."
      : `Couldn't refresh spend: ${result.message}`;
  }
  updateSpendControl();
  // ok, throttled, and error all re-read the RPC: the function records its own outcome there.
  if (result.status !== 'skipped') state.poller?.now();
}

/* ---------- Demo (localhost only) ---------- */

function isDemoRequest() {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return local && new URLSearchParams(location.search).get('demo') === '1';
}

async function bootDemo() {
  const { demoPayload } = await import('./demo.js');
  state.demo = true;
  state.active = true;
  state.demoPayload = demoPayload;
  state.demoVariant = new URLSearchParams(location.search).get('state') || '';
  $('#demo-banner').hidden = false;
  $('#who').textContent = 'Demo pastor';
  syncChips();
  clearAll();
  showDashboard();
  updateSpendControl();
  startTicker();
  renderDemo();
}

function renderDemo() {
  const variant = state.demoVariant;
  hideNotices();
  setRefreshing(false);
  state.lastError = null;

  if (variant === 'loading') {
    $('#updated').textContent = 'Loading figures';
    return;
  }
  if (variant === 'missing' || variant === 'error' || variant === 'offline') {
    state.payload = null;
    const kind = variant === 'error' ? 'generic' : variant;
    onError({ kind, detail: variant === 'error' ? 'Code XX000\nA made-up error so the layout can be checked.' : '' });
    return;
  }

  state.payload = state.demoPayload(state.windowKey, { empty: variant === 'empty' });
  state.receivedAt = Date.now();
  renderAll(state.payload);
  if (variant === 'stale') {
    state.receivedAt = Date.now() - 7 * 60_000;
    state.lastError = { kind: 'offline', detail: '' };
    showStale();
  }
  tick();
}

function leaveDemo() {
  state.active = false;
  stopTicker();
  state.payload = null;
  clearAll();
  hideNotices();
  $('#who').textContent = '';
  showSignIn({ message: 'Demo mode has no sign-in. Remove ?demo=1 from the address to use the real dashboard.' });
}

/* ---------- Live boot ---------- */

async function bootLive() {
  if (!auth.isConfigured()) {
    showSignIn({ message: auth.MESSAGES.notConfigured });
    $('#signin-btn').disabled = true;
    return;
  }
  auth.onAuthChange(() => {
    if (state.active) leaveDashboard(auth.MESSAGES.signedOut);
  });
  showSignIn({ mode: 'boot' });
  const session = await auth.restoreSession();
  if (!session) {
    showSignIn();
    return;
  }
  applyGate(await auth.requireAdmin());
}

/* ---------- Wiring ---------- */

function wire() {
  $('#signin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.signingIn) return;
    const password = $('#password').value;
    if (!password) {
      $('#signin-status').textContent = 'Enter the password.';
      return;
    }
    setSigningIn(true);
    $('#signin-status').textContent = '';
    try {
      applyGate(await auth.signIn(password));
    } catch (err) {
      console.error(err);
      showSignIn({ message: auth.MESSAGES.offline });
    } finally {
      setSigningIn(false);
    }
  });

  $('#gate-retry-btn').addEventListener('click', async () => {
    const button = $('#gate-retry-btn');
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      applyGate(await auth.requireAdmin());
    } finally {
      button.disabled = false;
      button.textContent = 'Try again';
    }
  });

  $('#gate-signout-btn').addEventListener('click', async () => {
    await auth.signOut();
    showSignIn();
  });

  $('#signout-btn').addEventListener('click', async () => {
    if (state.demo) {
      leaveDemo();
      return;
    }
    const button = $('#signout-btn');
    button.disabled = true;
    leaveDashboard('');
    try {
      await auth.signOut();
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll('.chip[data-window]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const key = chip.dataset.window;
      if (!WINDOW_KEYS.includes(key) || key === state.windowKey) return;
      state.windowKey = key;
      saveWindow(key);
      syncChips();
      if (state.demo) {
        renderDemo();
        return;
      }
      if (!state.active) return;
      setSwitching(true);
      state.poller?.now();
    });
  });

  const refreshNow = () => {
    if (state.demo) {
      renderDemo();
      return;
    }
    if (!state.active) return;
    setRefreshing(true);
    state.poller?.now();
  };
  $('#refresh-btn').addEventListener('click', refreshNow);
  document.querySelectorAll('[data-action="retry"]').forEach((button) => button.addEventListener('click', refreshNow));

  $('#spend-btn').addEventListener('click', () => runSpendRefresh({ manual: true }));

  // theme.js flips the palette; the charts read their colours at draw time.
  document.addEventListener('ec:theme', () => rebuildCharts());

  window.addEventListener('beforeprint', () => {
    document.querySelectorAll('details.table-twin').forEach((details) => {
      details.dataset.wasOpen = details.open ? '1' : '0';
      details.open = true;
    });
    setPrintMode(true);
  });
  window.addEventListener('afterprint', () => {
    document.querySelectorAll('details.table-twin').forEach((details) => {
      details.open = details.dataset.wasOpen === '1';
    });
    setPrintMode(false);
  });
}

wire();
if (isDemoRequest()) {
  bootDemo().catch((err) => console.error('Demo failed to start', err));
} else {
  bootLive().catch((err) => {
    console.error(err);
    showSignIn({ message: auth.MESSAGES.offline });
  });
}
