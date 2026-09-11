/**
 * Made-up figures for checking the layout locally. Loaded only when the page is
 * served from localhost or 127.0.0.1 with ?demo=1. Every name here is fictional.
 *
 * No imports, so Node can load this file to check it against the data contract.
 * Optional &state= values: empty, loading, stale, missing, error, offline.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Rough size of each window relative to a month. */
const SCALE = { week: 0.24, month: 1, '90d': 2.7, all: 7.4 };

const CARERS = [
  { id: 'c1', name: 'Grace Okafor', campus: 'North Campus', texts: 142, calls: 18, new_people: 6, last: 12 * MINUTE },
  { id: 'c2', name: 'Daniel Reyes', campus: 'North Campus', texts: 97, calls: 14, new_people: 4, last: 2 * HOUR },
  { id: 'c3', name: 'Hannah Lindqvist', campus: 'South Campus', texts: 88, calls: 9, new_people: 3, last: 26 * HOUR },
  { id: 'c4', name: 'Marcus Bell', campus: 'South Campus', texts: 61, calls: 11, new_people: 2, last: 3 * HOUR },
  { id: 'c5', name: 'Priya Raman', campus: 'Online', texts: 54, calls: 6, new_people: 2, last: 5 * HOUR },
  { id: 'c6', name: 'Tomás Alvarez', campus: 'North Campus', texts: 31, calls: 4, new_people: 1, last: 2 * DAY },
  { id: 'c7', name: 'Esther Mwangi', campus: 'Online', texts: 13, calls: 2, new_people: 0, last: 6 * DAY },
  { id: 'c8', name: 'Sam Turner', campus: 'South Campus', quiet: true, history: { '90d': 9, all: 40 }, last: 21 * DAY },
  { id: 'c9', name: 'Ruth Castellano', campus: 'North Campus', quiet: true, history: {}, last: null },
];

const CAMPUS_PEOPLE = {
  'North Campus': { in_care: 68, past_due: 5 },
  'South Campus': { in_care: 49, past_due: 4 },
  Online: { in_care: 25, past_due: 2 },
};

const FUNNEL = [
  { stage: 'new', label: 'New', n: 37 },
  { stage: 'contacted', label: 'First hello', n: 41 },
  { stage: 'talking', label: 'In conversation', n: 33 },
  { stage: 'visited', label: 'Visited a service', n: 19 },
  { stage: 'connected', label: 'Connected member', n: 12 },
];

const WEEKLY = {
  texts: [96, 104, 88, 121, 117, 109, 132, 98],
  calls: [12, 15, 9, 17, 14, 16, 19, 11],
  new_people: [3, 5, 2, 6, 4, 5, 7, 3],
};

const iso = (ms) => new Date(ms).toISOString();
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (list, key) => list.reduce((total, item) => total + (Number(item[key]) || 0), 0);

function startOfWeekUTC(now) {
  const d = new Date(now);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday);
}

function weekStarts(now) {
  const thisWeek = startOfWeekUTC(now);
  return Array.from({ length: 8 }, (_, i) => iso(thisWeek - (7 - i) * 7 * DAY).slice(0, 10));
}

function windowBounds(key, now) {
  const d = new Date(now);
  let from;
  if (key === 'week') from = startOfWeekUTC(now);
  else if (key === 'month') from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  else if (key === '90d') from = now - 90 * DAY;
  else from = Date.UTC(2025, 2, 2);
  const span = now - from;
  return {
    key,
    from: iso(from),
    to: iso(now),
    prev_from: key === 'all' ? null : iso(from - span),
    prev_to: key === 'all' ? null : iso(from),
    tz: 'America/Chicago',
  };
}

function splitSpend(scale) {
  const sms = round2(14.82 * scale);
  const mms = round2(0.96 * scale);
  const voice = round2(6.41 * scale);
  return { sms, mms, voice, total: round2(sms + mms + voice) };
}

function fullPayload(key, now) {
  const s = SCALE[key];
  const n = (base) => Math.round(base * s);

  const perCarer = CARERS.map((c) => ({
    id: c.id,
    name: c.name,
    campus: c.campus,
    texts: c.quiet ? c.history[key] ?? 0 : n(c.texts),
    calls: c.quiet ? 0 : n(c.calls),
    new_people: c.quiet ? 0 : n(c.new_people),
    last_active_at: c.last === null ? null : iso(now - c.last),
    quiet: Boolean(c.quiet),
  }));

  const texts = sum(perCarer, 'texts');
  const placed = sum(perCarer, 'calls');
  const threadsTexted = Math.min(142, Math.round(texts * 0.24));
  const threadsReplied = Math.round(threadsTexted * 0.6);
  const connected = Math.round(placed * 0.64);

  const prevTexts = Math.round(texts * 0.89);
  const prevTexted = Math.min(142, Math.round(prevTexts * 0.24));
  const prevReplied = Math.round(prevTexted * 0.64);
  const prevPlaced = Math.round(placed * 0.9);
  const prevConnected = Math.round(prevPlaced * 0.57);

  const allTime = { sms: 131.2, mms: 8.76, voice: 47.48, total: 187.44 };

  return {
    generated_at: iso(now),
    window: windowBounds(key, now),
    people: {
      in_care: 142,
      new: key === 'all' ? 163 : n(18),
      past_due: 11,
      on_time_rate: 131 / 142,
    },
    conversations: {
      texts,
      replies: Math.round(texts * 0.44),
      mms: n(12),
      threads_texted: threadsTexted,
      threads_replied: threadsReplied,
      response_rate: threadsTexted ? threadsReplied / threadsTexted : null,
      median_first_reply_minutes: 38,
    },
    calls: {
      placed,
      connected,
      connect_rate: placed ? connected / placed : null,
      minutes: n(312),
    },
    previous:
      key === 'all'
        ? null
        : {
            people: { new: n(14) },
            conversations: {
              texts: prevTexts,
              replies: Math.round(prevTexts * 0.47),
              mms: n(9),
              threads_texted: prevTexted,
              threads_replied: prevReplied,
              response_rate: prevTexted ? prevReplied / prevTexted : null,
              median_first_reply_minutes: 44,
            },
            calls: {
              placed: prevPlaced,
              connected: prevConnected,
              connect_rate: prevPlaced ? prevConnected / prevPlaced : null,
              minutes: n(270),
            },
          },
    team: {
      carers_total: CARERS.length,
      active_carers: CARERS.filter((c) => !c.quiet).length,
      quiet_after_days: 14,
      per_carer: perCarer,
      quiet_carers: perCarer
        .filter((c) => c.quiet)
        .map(({ id, name, campus, last_active_at }) => ({ id, name, campus, last_active_at })),
    },
    campuses: Object.entries(CAMPUS_PEOPLE).map(([name, people]) => {
      const team = perCarer.filter((c) => c.campus === name);
      return { name, ...people, texts: sum(team, 'texts'), calls: sum(team, 'calls') };
    }),
    funnel: FUNNEL.map((stage) => ({ ...stage })),
    weekly: {
      week_starts: weekStarts(now),
      texts: [...WEEKLY.texts],
      calls: [...WEEKLY.calls],
      new_people: [...WEEKLY.new_people],
    },
    spend: {
      window: key === 'all' ? { ...allTime } : splitSpend(s),
      all_time: allTime,
      estimated: {
        window: { sms: 0.01, mms: 0.02, voice: 0, total: 0.03 },
        all_time: { sms: 0.01, mms: 0.02, voice: 0, total: 0.03 },
        rates: { sms_per_segment: 0.0055, mms: 0.02, voice_per_minute: 0.012, observed: { sms: true, mms: true, voice: false } },
      },
      currency: 'USD',
      balance: 42.18,
      available_credit: 42.18,
      synced_at: iso(now - 4 * MINUTE),
      sync_error: null,
      unpriced_count: 3,
    },
    recent_activity: [
      { kind: 'text', at: iso(now - 6 * MINUTE), actor_id: 'c1', actor: 'Grace Okafor', contact_id: 'p1', contact: 'Jordan Brooks', campus: 'North Campus', action: 'texted Jordan' },
      { kind: 'call', at: iso(now - 22 * MINUTE), actor_id: 'c4', actor: 'Marcus Bell', contact_id: 'p2', contact: 'Lena Ortiz', campus: 'South Campus', action: 'called Lena' },
      { kind: 'text', at: iso(now - 48 * MINUTE), actor_id: 'c5', actor: 'Priya Raman', contact_id: 'p3', contact: 'Chen Wei', campus: 'Online', action: 'texted Chen' },
      { kind: 'prayer', at: iso(now - 70 * MINUTE), actor_id: 'c2', actor: 'Daniel Reyes', contact_id: 'p4', contact: 'Abby Nguyen', campus: 'North Campus', action: 'noted a prayer request from Abby' },
      { kind: 'contact', at: iso(now - 2 * HOUR), actor_id: 'c3', actor: 'Hannah Lindqvist', contact_id: 'p5', contact: 'Mateo Silva', campus: 'South Campus', action: 'added Mateo' },
      { kind: 'call', at: iso(now - 3 * HOUR), actor_id: 'c1', actor: 'Grace Okafor', contact_id: 'p6', contact: 'Olivia Hart', campus: 'North Campus', action: 'called Olivia' },
      { kind: 'text', at: iso(now - 5 * HOUR), actor_id: 'c6', actor: 'Tomás Alvarez', contact_id: 'p7', contact: 'Isaac Moore', campus: 'North Campus', action: 'texted Isaac' },
      { kind: 'text', at: iso(now - 26 * HOUR), actor_id: 'c7', actor: 'Esther Mwangi', contact_id: 'p8', contact: 'Naomi Adeyemi', campus: 'Online', action: 'texted Naomi' },
    ],
    overdue_people: [
      { id: 'p9', name: 'Luis Romero', campus: 'North Campus', carer: null, days: null },
      { id: 'p10', name: 'Samuel Osei', campus: 'South Campus', carer: 'Sam Turner', days: 21 },
      { id: 'p11', name: 'Ahmed Karim', campus: 'South Campus', carer: 'Hannah Lindqvist', days: 12 },
      { id: 'p12', name: 'Faith Johnson', campus: 'Online', carer: 'Priya Raman', days: 9 },
      { id: 'p13', name: 'Ivy Chen', campus: 'North Campus', carer: 'Grace Okafor', days: 8 },
      { id: 'p14', name: 'Brianna Scott', campus: 'South Campus', carer: 'Marcus Bell', days: 7 },
      { id: 'p15', name: 'Kevin Park', campus: 'North Campus', carer: 'Daniel Reyes', days: 6 },
      { id: 'p16', name: 'Chloe Bennett', campus: 'North Campus', carer: 'Tomás Alvarez', days: 5 },
    ],
    open_prayers: [
      { id: 'r1', contact_id: 'p4', name: 'Abby Nguyen', campus: 'North Campus', text: "Please pray for my mom's surgery on Thursday.", at: iso(now - 70 * MINUTE), carer: 'Daniel Reyes' },
      { id: 'r2', contact_id: 'p5', name: 'Mateo Silva', campus: 'South Campus', text: 'Job interview next week. Praying for peace and clarity.', at: iso(now - 2 * DAY), carer: 'Hannah Lindqvist' },
      { id: 'r3', contact_id: 'p8', name: 'Naomi Adeyemi', campus: 'Online', text: 'For my family as we settle into a new city.', at: iso(now - 4 * DAY), carer: 'Esther Mwangi' },
      { id: 'r4', contact_id: 'p1', name: 'Jordan Brooks', campus: 'North Campus', text: 'Healing for my back so I can get back to work.', at: iso(now - 9 * DAY), carer: null },
    ],
  };
}

function emptyPayload(key, now) {
  const conversations = () => ({
    texts: 0,
    replies: 0,
    mms: 0,
    threads_texted: 0,
    threads_replied: 0,
    response_rate: null,
    median_first_reply_minutes: null,
  });
  const calls = () => ({ placed: 0, connected: 0, connect_rate: null, minutes: 0 });
  const unsynced = () => ({ sms: null, mms: null, voice: null, total: null });
  const carers = CARERS.slice(0, 2).map(({ id, name, campus }) => ({ id, name, campus }));
  return {
    generated_at: iso(now),
    window: windowBounds(key, now),
    people: { in_care: 0, new: 0, past_due: 0, on_time_rate: null },
    conversations: conversations(),
    calls: calls(),
    previous: key === 'all' ? null : { people: { new: 0 }, conversations: conversations(), calls: calls() },
    team: {
      carers_total: carers.length,
      active_carers: 0,
      quiet_after_days: 14,
      per_carer: carers.map((c) => ({ ...c, texts: 0, calls: 0, new_people: 0, last_active_at: null, quiet: true })),
      quiet_carers: carers.map((c) => ({ ...c, last_active_at: null })),
    },
    campuses: [],
    funnel: FUNNEL.map((stage) => ({ ...stage, n: 0 })),
    weekly: {
      week_starts: weekStarts(now),
      texts: Array(8).fill(0),
      calls: Array(8).fill(0),
      new_people: Array(8).fill(0),
    },
    spend: {
      window: unsynced(),
      all_time: unsynced(),
      estimated: {
        window: { sms: 0, mms: 0, voice: 0, total: 0 },
        all_time: { sms: 0, mms: 0, voice: 0, total: 0 },
        rates: { sms_per_segment: 0.004, mms: 0.02, voice_per_minute: 0.012, observed: { sms: false, mms: false, voice: false } },
      },
      currency: 'USD',
      balance: null,
      available_credit: null,
      synced_at: null,
      sync_error: null,
      unpriced_count: 0,
    },
    recent_activity: [],
    overdue_people: [],
    open_prayers: [],
  };
}

/** A payload shaped exactly like ministry_dashboard's, for the given window. */
export function demoPayload(windowKey = 'month', { empty = false, now = Date.now() } = {}) {
  const key = Object.prototype.hasOwnProperty.call(SCALE, windowKey) ? windowKey : 'month';
  return empty ? emptyPayload(key, now) : fullPayload(key, now);
}

/** A fixed snapshot, handy for checks. */
export const DEMO_PAYLOAD = demoPayload('month', { now: Date.UTC(2026, 8, 11, 15, 0, 0) });
