/**
 * Plain-English formatting for every figure on the page.
 * Pure functions with no DOM access, so they are safe to reuse anywhere.
 */

const LOCALE = 'en-US';
const countFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
const moneyFormats = new Map();

const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A finite number, or null for anything missing or unreadable. */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 1284 -> "1,284". Missing -> "n/a". */
export function count(value) {
  const n = toNumber(value);
  return n === null ? 'n/a' : countFormat.format(Math.round(n));
}

/** 0.834 -> "83%". Missing -> "n/a". */
export function percent(rate) {
  const n = toNumber(rate);
  return n === null ? 'n/a' : `${Math.round(n * 100)}%`;
}

/** 12 -> "12 min", 65 -> "1 h 05 min". Missing -> "n/a". */
export function minutes(value) {
  const n = toNumber(value);
  if (n === null) return 'n/a';
  const total = Math.round(n);
  if (total <= 0) return n > 0 ? 'under 1 min' : '0 min';
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${countFormat.format(hours)} h ${String(rest).padStart(2, '0')} min`;
}

function moneyFormatter(currency) {
  const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'USD';
  if (!moneyFormats.has(code)) {
    let formatter;
    try {
      formatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code });
    } catch {
      formatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'USD' });
    }
    moneyFormats.set(code, formatter);
  }
  return moneyFormats.get(code);
}

/** 14.8 -> "$14.80", 0.004 -> "under $0.01". Missing -> "Not synced yet". */
export function money(value, currency) {
  const n = toNumber(value);
  if (n === null) return 'Not synced yet';
  const formatter = moneyFormatter(currency);
  if (n > 0 && n < 0.01) return `under ${formatter.format(0.01)}`;
  return formatter.format(n);
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && DAY_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return { date: new Date(Date.UTC(y, m - 1, d)), dayOnly: true };
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : { date, dayOnly: false };
}

function safeTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return undefined;
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/** "Sep 4" (or "Sep 4, 2026" with year). A bare 'YYYY-MM-DD' is treated as a calendar day. */
export function dateShort(value, tz, { year = false } = {}) {
  const parsed = parseDate(value);
  if (!parsed) return '';
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: parsed.dayOnly ? 'UTC' : safeTimeZone(tz),
  }).format(parsed.date);
}

/** "Sep 11, 2026, 3:42 PM" in the given time zone. */
export function dateTime(value, tz) {
  const parsed = parseDate(value);
  if (!parsed) return '';
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: safeTimeZone(tz),
  }).format(parsed.date);
}

/** "just now", "12 minutes ago", "yesterday", "21 days ago". Missing -> "never". */
export function relative(value, now = Date.now()) {
  const parsed = parseDate(value);
  if (!parsed) return 'never';
  const diff = (parsed.date.getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 45 * MINUTE_S) return relativeFormat.format(Math.round(diff / MINUTE_S), 'minute');
  if (abs < 22 * HOUR_S) return relativeFormat.format(Math.round(diff / HOUR_S), 'hour');
  if (abs < 26 * DAY_S) return relativeFormat.format(Math.round(diff / DAY_S), 'day');
  if (abs < 320 * DAY_S) return relativeFormat.format(Math.round(diff / (30.44 * DAY_S)), 'month');
  return relativeFormat.format(Math.round(diff / (365.25 * DAY_S)), 'year');
}

/** Header freshness label: "Updated just now", "Updated 12 s ago", "Updated 3 min ago". */
export function updatedAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'Updated just now';
  if (s < 60) return `Updated ${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `Updated ${m} min ago`;
  return `Updated ${Math.round(m / 60)} h ago`;
}

/** "1 minute ago", "7 minutes ago" (never less than one minute). */
export function minutesAgo(ms) {
  const m = Math.max(1, Math.round(ms / 60_000));
  return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
}

/** "Grace Okafor" -> "GO". */
export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

/** "Grace Okafor" -> "Grace". Missing -> "Someone". */
export function firstName(name) {
  return String(name ?? '').trim().split(/\s+/)[0] || 'Someone';
}

export function plural(n, one, many) {
  return Number(n) === 1 ? one : many;
}
