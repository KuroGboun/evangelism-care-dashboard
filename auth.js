/**
 * Sign-in for the pastor's dashboard.
 *
 * One shared password, one account. The page asks for a password only and signs
 * in as DASHBOARD_EMAIL, so nobody has to be told an address as well. The
 * password itself is nowhere in this page: Supabase checks it, and the session
 * it hands back is what row-level security judges every read by.
 *
 * Mirrors the app's claimProfile(): the password alone does not get anyone in.
 * After the token round-trip we read the account's own profile row, and only an
 * active admin is let through. A server that could not be asked (offline, a 5xx)
 * decides nothing: the session is kept and the caller offers a retry.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.109.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, DASHBOARD_EMAIL } from './config.js';

export const STORAGE_KEY = 'ec-pastor-dashboard';

export const MESSAGES = {
  incorrect: "That password isn't right.",
  notConfirmed: 'The dashboard account exists but was never confirmed. In Supabase, open that user and confirm it.',
  offline: "Can't reach the server. Check your connection and try again.",
  tooMany: 'Too many sign-in attempts. Wait a minute and try again.',
  notSetUp: 'This account is not set up for Evangelism Care.',
  deactivated: 'This account has been deactivated.',
  notAdmin: "This account isn't an admin. Ask Kuro to make it one in the app's Members tab.",
  unconfirmed: 'Could not confirm who you are. Sign in again.',
  checkFailed: "Couldn't check your account just now. Try again.",
  notConfigured: "This dashboard isn't connected to the ministry's data yet.",
  signedOut: 'You have been signed out. Sign in again to see the dashboard.',
};

/** PostgREST's "no rows for .single()", the one code that means the profile is missing. */
const NO_ROWS = 'PGRST116';

let client = null;

export function isConfigured() {
  return (
    SUPABASE_URL !== '__SUPABASE_URL__' &&
    SUPABASE_ANON_KEY !== '__SUPABASE_ANON_KEY__' &&
    /^https:\/\/\S+$/.test(SUPABASE_URL) &&
    SUPABASE_ANON_KEY.length > 20
  );
}

export function getClient() {
  if (!client) {
    if (!isConfigured()) throw new Error(MESSAGES.notConfigured);
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: STORAGE_KEY,
      },
    });
  }
  return client;
}

/** True when the request never got an answer from the server. */
export function isNetworkError(error) {
  if (!error) return false;
  if (error instanceof TypeError) return true;
  const name = String(error.name ?? '');
  if (name === 'AuthRetryableFetchError' || name === 'FunctionsFetchError') return true;
  if (error.status === 0) return true;
  return /failed to fetch|networkerror|load failed|network request failed|fetcherror|typeerror/i.test(
    `${name} ${error.message ?? ''}`,
  );
}

/** The stored session, if any. Never throws. */
export async function restoreSession() {
  try {
    const { data } = await getClient().auth.getSession();
    return data?.session ?? null;
  } catch {
    return null;
  }
}

/**
 * Password sign-in as the dashboard account, then the admin check.
 * Resolves to one of:
 *   { kind: 'admin', profile }        let them in
 *   { kind: 'failed', error }         credentials or connection; no session was made
 *   { kind: 'rejected', error }       signed in but not allowed; already signed out
 *   { kind: 'transient', error }      signed in but the check could not run; offer a retry
 */
export async function signIn(password) {
  let result;
  try {
    result = await getClient().auth.signInWithPassword({ email: DASHBOARD_EMAIL, password });
  } catch (err) {
    if (!isConfigured()) return { kind: 'failed', error: MESSAGES.notConfigured };
    return { kind: 'failed', error: isNetworkError(err) ? MESSAGES.offline : MESSAGES.checkFailed };
  }
  const { error } = result;
  if (error) {
    // Only blame the password when the server actually judged it.
    if (isNetworkError(error)) return { kind: 'failed', error: MESSAGES.offline };
    if (error.status === 429 || error.code === 'over_request_rate_limit') {
      return { kind: 'failed', error: MESSAGES.tooMany };
    }
    if (error.code === 'email_not_confirmed') return { kind: 'failed', error: MESSAGES.notConfirmed };
    // Supabase answers "invalid credentials" for a wrong password and for an
    // account that doesn't exist alike, so it can't be told apart here. Any
    // other refusal is a setup problem, so its code is shown for whoever is
    // setting the page up.
    console.warn('Sign-in refused', error.status, error.code, error.message);
    if (error.code && error.code !== 'invalid_credentials') {
      return { kind: 'failed', error: `Sign-in was refused by the server (${error.code}).` };
    }
    return { kind: 'failed', error: MESSAGES.incorrect };
  }
  return requireAdmin();
}

/** Confirms the current session belongs to an active admin. See signIn for the result shape. */
export async function requireAdmin() {
  let supabase;
  try {
    supabase = getClient();
  } catch {
    return { kind: 'failed', error: MESSAGES.notConfigured };
  }

  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && isNetworkError(error)) return { kind: 'transient', error: MESSAGES.offline };
    user = data?.user ?? null;
  } catch (err) {
    return { kind: 'transient', error: isNetworkError(err) ? MESSAGES.offline : MESSAGES.checkFailed };
  }
  if (!user) {
    await signOut();
    return { kind: 'rejected', error: MESSAGES.unconfirmed };
  }

  let row;
  try {
    row = await supabase.from('profiles').select('id,name,role,active').eq('id', user.id).single();
  } catch (err) {
    return { kind: 'transient', error: isNetworkError(err) ? MESSAGES.offline : MESSAGES.checkFailed };
  }
  const { data: profile, error } = row;
  if (error && error.code !== NO_ROWS) {
    // A fetch failure or an HTTP-level refusal. Neither says "not an admin",
    // so neither may sign anyone out.
    const offline = row.status === 0 || isNetworkError(error);
    return { kind: 'transient', error: offline ? MESSAGES.offline : MESSAGES.checkFailed };
  }
  if (!profile) {
    await signOut();
    return { kind: 'rejected', error: MESSAGES.notSetUp };
  }
  if (profile.active === false) {
    await signOut();
    return { kind: 'rejected', error: MESSAGES.deactivated };
  }
  if (profile.role !== 'admin') {
    await signOut();
    return { kind: 'rejected', error: MESSAGES.notAdmin };
  }
  return { kind: 'admin', profile };
}

/**
 * Ends this browser's session only (scope 'local'), so the pastor stays signed in
 * to the app on their phone. If the server can't be reached, the stored session
 * is removed by hand so it is not restored on the next visit.
 */
export async function signOut() {
  if (!client) return;
  let failed = false;
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    failed = Boolean(error);
  } catch {
    failed = true;
  }
  if (failed) {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(STORAGE_KEY)) localStorage.removeItem(key);
      }
    } catch {
      // Storage blocked: nothing was persisted there either.
    }
  }
}

/** Calls back when the session ends (sign-out elsewhere, refresh token revoked). Returns an unsubscribe. */
export function onAuthChange(callback) {
  if (!isConfigured()) return () => {};
  const { data } = getClient().auth.onAuthStateChange((event) => {
    // Deferred so the callback never runs inside supabase-js's auth lock.
    if (event === 'SIGNED_OUT') setTimeout(callback, 0);
  });
  return () => data?.subscription?.unsubscribe();
}
