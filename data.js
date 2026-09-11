/**
 * The dashboard's only data source: the admin-only `ministry_dashboard` RPC,
 * plus the `telnyx-costs` Edge Function that refreshes the spend figures it reads.
 * Also owns polling and the realtime "something changed" nudge.
 */

import { getClient, isNetworkError } from './auth.js';
import { POLL_MS, SPEND_REFRESH_MIN_MS } from './config.js';

export const WINDOW_KEYS = ['week', 'month', '90d', 'all'];

/** Wait after the 1st, 2nd, and 3rd+ failure in a row. */
const BACKOFF_MS = [POLL_MS, 120_000, 300_000];
const SPEND_STAMP_KEY = 'ec-pastor-dashboard:spend-refreshed-at';
const NUDGE_DEBOUNCE_MS = 5_000;
const NUDGE_MAX_WAIT_MS = 15_000;

export class DashboardError extends Error {
  /** kind: 'forbidden' | 'missing' | 'offline' | 'generic' */
  constructor(kind, message, detail = '') {
    super(message);
    this.name = 'DashboardError';
    this.kind = kind;
    this.detail = detail;
  }
}

export function classifyError(error, status) {
  if (!error) return new DashboardError('generic', 'Something went wrong.');
  const code = String(error.code ?? '');
  const detail = [code && `Code ${code}`, error.message, error.details, error.hint]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join('\n');
  if (code === '42501') {
    return new DashboardError('forbidden', 'This account is not allowed to see the dashboard.', detail);
  }
  if (code === 'PGRST202') {
    return new DashboardError('missing', "The dashboard's data source isn't set up yet.", detail);
  }
  if (status === 0 || isNetworkError(error)) {
    return new DashboardError('offline', "Can't reach the server.", detail);
  }
  return new DashboardError('generic', 'The server ran into a problem loading the dashboard.', detail);
}

/** Resolves to the dashboard payload for a window, or throws a DashboardError. */
export async function fetchDashboard(windowKey) {
  const key = WINDOW_KEYS.includes(windowKey) ? windowKey : 'month';
  let result;
  try {
    result = await getClient().rpc('ministry_dashboard', { p_window: key });
  } catch (err) {
    throw classifyError(err, isNetworkError(err) ? 0 : undefined);
  }
  const { data, error, status } = result;
  if (error) throw classifyError(error, status);
  let payload = data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = null;
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DashboardError('generic', 'The server sent back an empty dashboard.', `Received ${typeof data}`);
  }
  return payload;
}

/* ---------- Spend refresh ---------- */

let memoryStamp = 0;
let spendInFlight = null;

function readStamp() {
  try {
    return Number(localStorage.getItem(SPEND_STAMP_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeStamp(ms) {
  memoryStamp = ms;
  try {
    localStorage.setItem(SPEND_STAMP_KEY, String(ms));
  } catch {
    // Storage blocked: the in-memory stamp still rate-limits this tab.
  }
}

/** How long until spend may be refreshed again (0 = now). Survives reloads. */
export function spendWaitMs(now = Date.now()) {
  const last = Math.max(memoryStamp, readStamp());
  if (last > now + SPEND_REFRESH_MIN_MS) return 0; // clock moved backwards; don't lock the button
  return Math.max(0, last + SPEND_REFRESH_MIN_MS - now);
}

/**
 * Asks the telnyx-costs function to pull fresh charges. Never more than once per
 * SPEND_REFRESH_MIN_MS from this browser. Never throws. Resolves to:
 *   { status: 'ok' } | { status: 'throttled', retryAt } | { status: 'skipped', waitMs }
 *   | { status: 'error', offline, message }
 */
export function refreshSpend() {
  if (spendInFlight) return spendInFlight;
  const wait = spendWaitMs();
  if (wait > 0) return Promise.resolve({ status: 'skipped', waitMs: wait });
  const previousStamp = Math.max(memoryStamp, readStamp());
  writeStamp(Date.now());
  spendInFlight = invokeSpend(previousStamp).finally(() => {
    spendInFlight = null;
  });
  return spendInFlight;
}

async function invokeSpend(previousStamp) {
  let result;
  try {
    result = await getClient().functions.invoke('telnyx-costs', { body: {} });
  } catch (err) {
    const offline = isNetworkError(err);
    if (offline) writeStamp(previousStamp); // never reached the server, so don't spend the allowance
    return { status: 'error', offline, message: err?.message || 'Unknown error' };
  }
  const { error } = result;
  if (!error) return { status: 'ok' };

  const response = error.context;
  if (response && typeof response.status === 'number') {
    let body = null;
    try {
      body = await (typeof response.clone === 'function' ? response.clone() : response).json();
    } catch {
      body = null;
    }
    if (response.status === 429) {
      // Throttled server-side: not an error. Line the local wait up with the server's.
      const retryAt = body?.retryAt ? Date.parse(body.retryAt) : NaN;
      if (Number.isFinite(retryAt)) writeStamp(Math.max(0, retryAt - SPEND_REFRESH_MIN_MS));
      return { status: 'throttled', retryAt: body?.retryAt ?? null };
    }
    const message =
      body && typeof body.error === 'string' && body.error
        ? body.error
        : `The spend service answered with status ${response.status}.`;
    return { status: 'error', offline: false, message };
  }

  const offline = isNetworkError(error);
  if (offline) writeStamp(previousStamp);
  return { status: 'error', offline, message: error.message || 'Unknown error' };
}

/* ---------- Polling ---------- */

/**
 * Starts polling. `load()` resolves to data or throws; `onData(result)` and
 * `onError(error, failuresInARow)` receive the outcome. Polls every POLL_MS while
 * the tab is visible, pauses while hidden, fetches immediately on becoming
 * visible or coming back online, and backs off 60 s, 2 min, 5 min on failure.
 * Returns a controller: { now(), stop() }.
 */
export function startPolling({ load, onData, onError }) {
  let running = true;
  let inFlight = false;
  let queued = false;
  let failures = 0;
  let timer = null;

  const visible = () => document.visibilityState === 'visible';

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    if (!running || !visible()) return;
    const delay = failures === 0 ? POLL_MS : BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
    timer = setTimeout(run, delay);
  }

  async function run() {
    if (!running) return;
    if (inFlight) {
      queued = true;
      return;
    }
    clearTimer();
    inFlight = true;
    let outcome;
    try {
      outcome = { ok: true, value: await load() };
    } catch (err) {
      outcome = { ok: false, error: err };
    }
    inFlight = false;
    if (!running) return;
    try {
      if (outcome.ok) {
        failures = 0;
        onData(outcome.value);
      } else {
        failures += 1;
        onError(outcome.error, failures);
      }
    } catch (err) {
      console.error('Dashboard update failed to apply', err);
    }
    if (!running) return;
    if (queued) {
      queued = false;
      run();
    } else {
      schedule();
    }
  }

  function onVisibility() {
    if (!running) return;
    if (visible()) run();
    else clearTimer();
  }

  function onOnline() {
    if (running && visible()) run();
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  if (visible()) run();

  return {
    now() {
      if (running) run();
    },
    stop() {
      running = false;
      queued = false;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    },
  };
}

export function stopPolling(controller) {
  controller?.stop();
}

/* ---------- Realtime nudge ---------- */

/**
 * Re-fetches soon after any change to messages or calls. Events are debounced
 * by 5 s (capped at 15 s under constant traffic) and ignored while the tab is
 * hidden, since becoming visible fetches anyway. Returns an unsubscribe.
 */
export function subscribeNudges(onNudge) {
  const supabase = getClient();
  let timer = null;
  let firstAt = 0;

  const fire = () => {
    timer = null;
    firstAt = 0;
    if (document.visibilityState === 'visible') onNudge();
  };

  const bump = () => {
    const now = Date.now();
    if (!firstAt) firstAt = now;
    if (timer) clearTimeout(timer);
    const wait = Math.min(NUDGE_DEBOUNCE_MS, Math.max(0, firstAt + NUDGE_MAX_WAIT_MS - now));
    timer = setTimeout(fire, wait);
  };

  const channel = supabase
    .channel(`pastor-dashboard-${Math.random().toString(36).slice(2, 10)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, bump)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, bump)
    .subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
  };
}
