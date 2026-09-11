/**
 * Draws the dashboard from one ministry_dashboard payload.
 *
 * Every piece of data reaches the page through textContent (names and prayer
 * text are typed by people), never through innerHTML.
 */

import Chart from 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/auto/+esm';
import {
  count,
  percent,
  minutes,
  money,
  relative,
  dateShort,
  dateTime,
  firstName,
  plural,
} from './format.js';

const FONT = '"Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const ROW_PX = 28;
const PAD_PX = 40;

/** Used for print, where the page is always light whatever the screen theme. */
const LIGHT_CHART = { a: '#2E90C4', b: '#E8595E', grid: '#EFEAE1', text: '#5F584E', ink: '#1A1712', card: '#FFFFFF' };

export const WINDOWS = {
  week: { newLabel: 'New this week', vs: 'vs last week', spent: 'Spent this week', phrase: 'this week' },
  month: { newLabel: 'New this month', vs: 'vs last month', spent: 'Spent this month', phrase: 'this month' },
  '90d': { newLabel: 'New in 90 days', vs: 'vs the 90 days before', spent: 'Spent in 90 days', phrase: 'in the last 90 days' },
  all: { newLabel: 'Added all time', vs: '', spent: 'Spent all time', phrase: 'all time' },
};

let current = null;
let printLight = false;
const charts = {};

/* ---------- Small helpers ---------- */

const $ = (selector) => document.querySelector(selector);
const slot = (name) => document.querySelector(`[data-slot="${name}"]`);
const arr = (value) => (Array.isArray(value) ? value : []);
const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const present = (o, key) => Boolean(o) && typeof o === 'object' && o[key] !== null && o[key] !== undefined;
const joinMeta = (...parts) =>
  parts.filter((part) => part !== null && part !== undefined && String(part).trim() !== '').join(' · ');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function fill(node, children) {
  node.replaceChildren(...children.filter(Boolean));
}

function safely(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`Could not draw the ${name} section`, err);
  }
}

/** A table row: the first cell is a row header; strings after it are numeric cells. */
function tableRow(cells) {
  const tr = document.createElement('tr');
  cells.forEach((cell, i) => {
    const isObject = cell && typeof cell === 'object';
    const text = isObject ? cell.text : cell;
    const node = el(i === 0 ? 'th' : 'td', i === 0 ? '' : isObject ? cell.cls ?? '' : 'num', text ?? '');
    if (i === 0) node.scope = 'row';
    tr.append(node);
  });
  return tr;
}

function summarize(labels, values, max = 6) {
  const parts = labels.slice(0, max).map((label, i) => `${label} ${count(values[i])}`);
  const rest = labels.length - max;
  return `${parts.join(', ')}${rest > 0 ? `, and ${rest} more in the table` : ''}.`;
}

/* ---------- Tiles and deltas ---------- */

function deltaEl(cur, prevGroup, key, windowKey, kind = 'count', { neutral = false } = {}) {
  const w = WINDOWS[windowKey];
  if (!w || windowKey === 'all' || !present(prevGroup, key)) return null;
  if (cur === null || cur === undefined) return null;
  const c = Number(cur);
  const p = Number(prevGroup[key]);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;

  let diff;
  let amount;
  if (kind === 'rate') {
    diff = Math.round(c * 100) - Math.round(p * 100);
    amount = `${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'pt' : 'pts'}`;
  } else if (kind === 'minutes') {
    diff = Math.round(c) - Math.round(p);
    amount = minutes(Math.abs(diff));
  } else {
    diff = Math.round(c) - Math.round(p);
    amount = count(Math.abs(diff));
  }

  const node = el('p', 'delta');
  if (diff === 0) {
    node.classList.add('is-flat');
    node.textContent = `No change ${w.vs}`;
    return node;
  }
  const up = diff > 0;
  node.classList.add(neutral ? 'is-flat' : up ? 'is-good' : 'is-bad');
  const arrow = el('span', 'delta-arrow', up ? '▲' : '▼');
  arrow.setAttribute('aria-hidden', 'true');
  node.append(arrow, el('span', 'sr-only', up ? 'Up' : 'Down'), document.createTextNode(` ${amount} ${w.vs}`));
  return node;
}

function tile({ value, label, explain, split, delta, tone, unknown = false, cls = '' }) {
  const node = el('article', `tile ${cls}`.trim());
  const valueEl = el('p', 'tile-value', value);
  if (tone) valueEl.classList.add(`tone-${tone}`);
  if (unknown) valueEl.classList.add('is-unknown');
  node.append(valueEl, el('h3', 'tile-label', label));
  if (explain) node.append(el('p', 'explain', explain));
  if (split) node.append(el('p', 'split', split));
  if (delta) node.append(delta);
  return node;
}

/** Rows beyond this many scroll inside the list instead of lengthening the page. */
const ROWS_BEFORE_SCROLL = 5;

/**
 * Turns a long list into a fixed-height box that scrolls in place. The fade at
 * the bottom lifts once the reader has scrolled to the end.
 */
function compressList(list) {
  const long = list.children.length > ROWS_BEFORE_SCROLL;
  list.classList.toggle('rows-scroll', long);
  if (!list.dataset.scrollBound) {
    list.dataset.scrollBound = '1';
    list.addEventListener('scroll', () => markEnd(list), { passive: true });
  }
  list.scrollTop = 0;
  markEnd(list);
  return long;
}

function markEnd(list) {
  const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
  list.classList.toggle('at-end', atEnd);
}

/* ---------- Charts ---------- */

Chart.defaults.font.family = FONT;
Chart.defaults.font.size = 12;

/** Writes each bar's value (or a stack's total) just past its tip, in ink, not the series colour. */
const tipLabels = {
  id: 'tipLabels',
  afterDatasetsDraw(chart, _args, options) {
    if (!options || options.enabled !== true || chart.options.indexAxis !== 'y') return;
    const metas = chart.getSortedVisibleDatasetMetas();
    if (!metas.length) return;
    const { ctx } = chart;
    ctx.save();
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = options.color || LIGHT_CHART.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    metas[metas.length - 1].data.forEach((bar, i) => {
      let total = 0;
      let tip = -Infinity;
      for (const meta of metas) {
        total += num(chart.data.datasets[meta.index].data[i]);
        const x = meta.data[i]?.x;
        if (Number.isFinite(x)) tip = Math.max(tip, x);
      }
      if (Number.isFinite(tip)) ctx.fillText(count(total), tip + 6, bar.y);
    });
    ctx.restore();
  },
};
Chart.register(tipLabels);

function themeColors() {
  if (printLight) return LIGHT_CHART;
  const styles = getComputedStyle(document.documentElement);
  const v = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    a: v('--chart-a', LIGHT_CHART.a),
    b: v('--chart-b', LIGHT_CHART.b),
    grid: v('--chart-grid', LIGHT_CHART.grid),
    text: v('--chart-text', LIGHT_CHART.text),
    ink: v('--chart-ink', LIGHT_CHART.ink),
    card: v('--card', LIGHT_CHART.card),
  };
}

/** Narrow charts (a phone, or the campus chart beside its number columns) get smaller axis text. */
const axisFontSize = (chart) => (chart.width < 260 ? 10 : 12);

let measureCtx = null;

/** Shortens a label with an ellipsis so it fits within maxWidth pixels at the axis font. */
function fitLabel(value, maxWidth, size = 12) {
  const s = String(value ?? '');
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return s;
  measureCtx.font = `600 ${size}px ${FONT}`;
  if (measureCtx.measureText(s).width <= maxWidth) return s;
  const chars = Array.from(s);
  while (chars.length > 1 && measureCtx.measureText(`${chars.join('').trimEnd()}…`).width > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

function tooltip(t) {
  return {
    backgroundColor: t.ink,
    titleColor: t.card,
    bodyColor: t.card,
    footerColor: t.card,
    cornerRadius: 4,
    padding: 10,
    boxPadding: 4,
    titleFont: { family: FONT, weight: '700' },
    bodyFont: { family: FONT, weight: '500' },
    callbacks: { label: (item) => ` ${item.dataset.label}: ${count(item.raw)}` },
  };
}

function setBoxHeight(selector, rows) {
  // CSSOM, not a style attribute, so the Content Security Policy allows it.
  $(selector).style.height = `${Math.max(1, rows) * ROW_PX + PAD_PX}px`;
}

/** Horizontal bars, optionally stacked. Hidden x axis means 20px padding top and bottom. */
function hbar(t, labels, series, { stacked = false, showX = false } = {}) {
  const biggest = labels.reduce(
    (max, _label, i) => Math.max(max, series.reduce((total, s) => total + num(s.data[i]), 0)),
    0,
  );
  return {
    type: 'bar',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.data,
        backgroundColor: s.color,
        hoverBackgroundColor: s.color,
        borderRadius: 4,
        borderSkipped: 'start',
        // A 2px surface-coloured edge separates stacked segments.
        borderWidth: stacked && i < series.length - 1 ? { top: 0, right: 2, bottom: 0, left: 0 } : 0,
        borderColor: t.card,
        maxBarThickness: 18,
        categoryPercentage: 0.9,
        barPercentage: 0.9,
      })),
    },
    options: {
      indexAxis: 'y',
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: showX ? 8 : 20, bottom: showX ? 0 : 20, left: 0, right: count(biggest).length * 8 + 14 } },
      interaction: { mode: 'index', axis: 'y', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: tooltip(t),
        tipLabels: { enabled: true, color: t.ink },
      },
      scales: {
        x: {
          display: showX,
          stacked,
          beginAtZero: true,
          grid: { color: t.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: t.text, padding: 6, precision: 0, maxTicksLimit: 5, callback: (value) => count(value) },
        },
        y: {
          stacked,
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: t.text,
            autoSkip: false,
            font: (ctx) => ({ family: FONT, weight: '600', size: axisFontSize(ctx.chart) }),
            callback(value) {
              // Chart.js gives the axis at most half the width; staying under 42% means labels are never clipped.
              const size = axisFontSize(this.chart);
              return fitLabel(this.getLabelForValue(value), Math.max(40, this.chart.width * 0.42 - 8), size);
            },
          },
        },
      },
    },
  };
}

/** Grouped columns over time, one y axis. */
function columns(t, labels, series) {
  const tip = tooltip(t);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        backgroundColor: s.color,
        hoverBackgroundColor: s.color,
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 14,
        categoryPercentage: 0.72,
        barPercentage: 0.88,
      })),
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 8, right: 4, bottom: 0, left: 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...tip, callbacks: { ...tip.callbacks, title: (items) => `Week of ${items[0]?.label ?? ''}` } },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: t.text, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 },
        },
        y: {
          beginAtZero: true,
          grid: { color: t.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: t.text, padding: 8, precision: 0, maxTicksLimit: 5, callback: (value) => count(value) },
        },
      },
    },
  };
}

/** Creates the chart once, then updates it in place on later refreshes. */
function upsertChart(name, canvasSelector, build) {
  const config = build(themeColors());
  const existing = charts[name];
  if (existing) {
    existing.data.labels = config.data.labels;
    existing.data.datasets = config.data.datasets;
    existing.options = config.options;
    existing.update('none');
    return;
  }
  charts[name] = new Chart($(canvasSelector), config);
}

function destroyChart(name) {
  if (charts[name]) {
    charts[name].destroy();
    delete charts[name];
  }
}

function destroyAllCharts() {
  Object.keys(charts).forEach(destroyChart);
}

if (document.fonts?.ready) {
  document.fonts.ready.then(() => Object.values(charts).forEach((chart) => chart.update('none'))).catch(() => {});
}

/* ---------- Sections ---------- */

function renderHeader(p) {
  const w = obj(p.window);
  const from = dateShort(w.from, w.tz, { year: w.key === 'all' });
  slot('window-range').textContent = from ? `Since ${from}` : '';
}

function renderHero(p) {
  const inCare = obj(p.people).in_care;
  slot('hero-value').textContent = count(inCare ?? 0);
  $('#hero-empty').hidden = num(inCare) !== 0;
}

function renderKpis(p, key) {
  const w = WINDOWS[key];
  const people = obj(p.people);
  const prevPeople = p.previous ? obj(obj(p.previous).people) : null;
  const win = obj(p.window);
  const from = dateShort(win.from, win.tz);
  const newExplain =
    key === 'all' ? 'Everyone ever added to care' : from ? `Added to care since ${from}` : `Added to care ${w.phrase}`;
  const pastDue = num(people.past_due);

  fill(slot('kpis'), [
    tile({
      cls: 'card',
      value: count(people.new),
      label: w.newLabel,
      explain: newExplain,
      delta: deltaEl(people.new, prevPeople, 'new', key),
    }),
    tile({
      cls: 'card',
      value: count(people.past_due),
      label: 'Past due',
      explain: 'No hello in 5 days or more',
      tone: pastDue > 0 ? 'pastdue' : null,
    }),
    tile({
      cls: 'card',
      value: percent(people.on_time_rate),
      label: 'Cared for on time',
      explain: "Share of people in care who aren't past due",
      delta: deltaEl(people.on_time_rate, prevPeople, 'on_time_rate', key, 'rate'),
    }),
    tile({
      cls: 'card',
      value: count(arr(p.open_prayers).length),
      label: 'Open prayer requests',
      explain: 'Asked for prayer and still waiting on a follow-up',
    }),
  ]);
}

function renderJourney(p) {
  const stages = arr(p.funnel);
  const labels = stages.map((stage) => String(stage.label ?? stage.stage ?? ''));
  const values = stages.map((stage) => num(stage.n));
  const any = stages.length > 0;

  $('#journey-fig').hidden = !any;
  $('#journey-empty').hidden = any;
  fill(slot('journey-table'), stages.map((_stage, i) => tableRow([labels[i], count(values[i])])));
  if (!any) {
    destroyChart('journey');
    return;
  }
  setBoxHeight('#journey-box', labels.length);
  $('#journey-canvas').setAttribute('aria-label', `Bar chart of people at each journey stage. ${summarize(labels, values)}`);
  upsertChart('journey', '#journey-canvas', (t) =>
    hbar(t, labels, [{ label: 'People', data: values, color: t.a }]),
  );
}

function renderCampuses(p) {
  const campuses = arr(p.campuses);
  const labels = campuses.map((campus) => String(campus.name ?? 'No campus'));
  const inCare = campuses.map((campus) => num(campus.in_care));
  const any = campuses.length > 0;

  $('#campus-fig').hidden = !any;
  $('#campus-empty').hidden = any;
  fill(
    slot('campus-table'),
    campuses.map((campus, i) =>
      tableRow([labels[i], count(campus.in_care), count(campus.past_due), count(campus.texts), count(campus.calls)]),
    ),
  );

  const cells = [el('span', 'col-head', 'Past due'), el('span', 'col-head', 'Texts'), el('span', 'col-head', 'Calls')];
  for (const campus of campuses) {
    const pastDue = el('span', num(campus.past_due) > 0 ? 'tone-pastdue' : '', count(campus.past_due));
    cells.push(pastDue, el('span', '', count(campus.texts)), el('span', '', count(campus.calls)));
  }
  fill(slot('campus-cols'), cells);

  if (!any) {
    destroyChart('campus');
    return;
  }
  setBoxHeight('#campus-box', campuses.length);
  $('#campus-canvas').setAttribute('aria-label', `Bar chart of people in care by campus. ${summarize(labels, inCare)}`);
  upsertChart('campus', '#campus-canvas', (t) =>
    hbar(t, labels, [{ label: 'People in care', data: inCare, color: t.a }]),
  );
}

function renderConversations(p, key) {
  const conv = obj(p.conversations);
  const calls = obj(p.calls);
  const prev = p.previous ? obj(p.previous) : null;
  const prevConv = prev ? obj(prev.conversations) : null;
  const prevCalls = prev ? obj(prev.calls) : null;

  const textsExplain =
    `To ${count(conv.threads_texted)} ${plural(conv.threads_texted, 'person', 'people')}` +
    (num(conv.mms) > 0 ? `, including ${count(conv.mms)} ${plural(conv.mms, 'photo', 'photos')}` : '');

  fill(slot('conv-tiles'), [
    tile({
      value: count(conv.texts),
      label: 'Texts sent',
      explain: textsExplain,
      delta: deltaEl(conv.texts, prevConv, 'texts', key),
    }),
    tile({
      value: count(conv.replies),
      label: 'Replies received',
      explain: `From ${count(conv.threads_replied)} ${plural(conv.threads_replied, 'person', 'people')}`,
      delta: deltaEl(conv.replies, prevConv, 'replies', key),
    }),
    tile({
      value: percent(conv.response_rate),
      label: 'Reply rate',
      explain: 'Share of texted people who wrote back',
      delta: deltaEl(conv.response_rate, prevConv, 'response_rate', key, 'rate'),
    }),
    tile({
      value: minutes(conv.median_first_reply_minutes),
      label: 'Typical reply time',
      explain: 'Half of first replies came faster than this',
      // Faster or slower isn't clearly good or bad here, so the change is shown without colour.
      delta: deltaEl(conv.median_first_reply_minutes, prevConv, 'median_first_reply_minutes', key, 'minutes', {
        neutral: true,
      }),
    }),
    tile({
      value: count(calls.placed),
      label: 'Calls made',
      explain: 'Calls the team placed',
      delta: deltaEl(calls.placed, prevCalls, 'placed', key),
    }),
    tile({
      value: count(calls.connected),
      label: 'Calls answered',
      explain: present(calls, 'connect_rate')
        ? `${percent(calls.connect_rate)} of calls made were picked up`
        : 'Calls that were picked up',
      delta: deltaEl(calls.connected, prevCalls, 'connected', key),
    }),
    tile({
      value: minutes(calls.minutes),
      label: 'Time on the phone',
      explain: 'Talk time on answered calls',
      delta: deltaEl(calls.minutes, prevCalls, 'minutes', key, 'minutes'),
    }),
  ]);

  const weekly = obj(p.weekly);
  const starts = arr(weekly.week_starts);
  const labels = starts.map((day) => dateShort(day));
  const texts = starts.map((_day, i) => num(arr(weekly.texts)[i]));
  const callCounts = starts.map((_day, i) => num(arr(weekly.calls)[i]));
  const newPeople = starts.map((_day, i) => num(arr(weekly.new_people)[i]));
  const any = starts.length > 0;

  $('#weekly-fig').hidden = !any;
  fill(
    slot('weekly-table'),
    starts.map((day, i) =>
      tableRow([dateShort(day, null, { year: true }), count(texts[i]), count(callCounts[i]), count(newPeople[i])]),
    ),
  );
  if (!any) {
    destroyChart('weekly');
    return;
  }
  const last = starts.length - 1;
  $('#weekly-canvas').setAttribute(
    'aria-label',
    `Column chart of texts and calls per week for the last ${starts.length} weeks. ` +
      `Week of ${labels[last]}: ${count(texts[last])} texts and ${count(callCounts[last])} calls.`,
  );
  upsertChart('weekly', '#weekly-canvas', (t) =>
    columns(t, labels, [
      { label: 'Texts', data: texts, color: t.a },
      { label: 'Calls', data: callCounts, color: t.b },
    ]),
  );
}

function renderTeam(p, key) {
  const team = obj(p.team);
  slot('team-headline').replaceChildren(
    el('span', 'team-big', count(team.active_carers)),
    document.createTextNode(` of ${count(team.carers_total)} carers active`),
  );

  const carers = arr(team.per_carer);
  const activity = (c) => num(c.texts) + num(c.calls);
  const shown = carers.filter((c) => !(c.quiet && activity(c) === 0)).sort((a, b) => activity(b) - activity(a));
  const any = shown.length > 0;

  $('#team-fig').hidden = !any;
  const empty = $('#team-empty');
  empty.textContent = any ? '' : `No texts or calls from the team ${WINDOWS[key].phrase}.`;
  empty.hidden = any;

  fill(
    slot('team-table'),
    carers.map((c) =>
      tableRow([
        String(c.name ?? 'Unnamed'),
        { text: c.campus ?? '', cls: '' },
        count(c.texts),
        count(c.calls),
        count(c.new_people),
        { text: relative(c.last_active_at), cls: '' },
      ]),
    ),
  );

  if (any) {
    const labels = shown.map((c) => String(c.name ?? 'Unnamed'));
    const texts = shown.map((c) => num(c.texts));
    const calls = shown.map((c) => num(c.calls));
    setBoxHeight('#team-box', shown.length);
    $('#team-canvas').setAttribute(
      'aria-label',
      `Stacked bar chart of texts and calls by carer. ${summarize(labels, shown.map(activity))}`,
    );
    upsertChart('team', '#team-canvas', (t) =>
      hbar(
        t,
        labels,
        [
          { label: 'Texts', data: texts, color: t.a },
          { label: 'Calls', data: calls, color: t.b },
        ],
        { stacked: true, showX: true },
      ),
    );
  } else {
    destroyChart('team');
  }

  const recent = arr(p.recent_activity);
  const list = slot('activity-list');
  if (!recent.length) {
    fill(list, [el('li', 'empty', 'No recent activity yet.')]);
  } else {
    fill(
      list,
      recent.map((item) => {
        const li = el('li', 'act');
        const main = el('div', 'row-main');
        main.append(el('p', 'row-title', `${firstName(item.actor)} ${item.action ?? ''}`.trim()));
        if (item.campus) main.append(el('p', 'row-meta', item.campus));
        li.append(el('p', 'act-time', relative(item.at)), main);
        return li;
      }),
    );
  }
  compressList(list);
}

function renderPrayer(p) {
  const prayers = arr(p.open_prayers);
  const list = slot('prayer-list');
  if (!prayers.length) {
    fill(list, [el('li', 'empty', 'No open prayer requests right now.')]);
  } else {
    fill(
      list,
      prayers.map((request) => {
        const li = el('li', 'prayer');
        const text = String(request.text ?? '').trim();
        li.append(
          el('p', 'prayer-text', text ? `“${text}”` : 'No details were given.'),
          el(
            'p',
            'row-meta',
            joinMeta(request.name, request.campus, relative(request.at), request.carer ? `Carer: ${request.carer}` : 'No primary carer'),
          ),
        );
        return li;
      }),
    );
  }
  compressList(list);
}

function renderSpend(p, key) {
  const spend = obj(p.spend);
  const currency = spend.currency;
  const w = WINDOWS[key];
  const amount = (value) => (value === null || value === undefined ? 'n/a' : money(value, currency));
  const split = (bucket) => {
    const b = obj(bucket);
    if (!present(b, 'sms') && !present(b, 'mms') && !present(b, 'voice')) return '';
    return `SMS ${amount(b.sms)} · Photos (MMS) ${amount(b.mms)} · Calls ${amount(b.voice)}`;
  };
  const moneyTile = (value, label, extra) =>
    tile({ value: money(value, currency), label, unknown: value === null || value === undefined, ...extra });

  const tiles = [];
  if (key !== 'all') tiles.push(moneyTile(obj(spend.window).total, w.spent, { split: split(spend.window) }));
  tiles.push(moneyTile(obj(spend.all_time).total, 'Spent all time', { split: split(spend.all_time) }));
  tiles.push(
    moneyTile(spend.balance, 'Balance', {
      explain: 'Credit left on the Telnyx account',
      split:
        present(spend, 'available_credit') && num(spend.available_credit) !== num(spend.balance)
          ? `Available to spend ${money(spend.available_credit, currency)}`
          : '',
    }),
  );
  fill(slot('spend-tiles'), tiles);

  slot('spend-synced').textContent = spend.synced_at ? `Synced ${relative(spend.synced_at)}` : 'Not synced yet';

  let syncError = spend.sync_error;
  if (syncError && typeof syncError === 'object') syncError = syncError.message ?? JSON.stringify(syncError);
  slot('spend-error').textContent = syncError ? `Couldn't reach Telnyx last time: ${String(syncError)}` : '';

  const unpriced = num(spend.unpriced_count);
  slot('spend-unpriced').textContent =
    unpriced > 0
      ? `${count(unpriced)} ${plural(unpriced, "text or call isn't", "texts or calls aren't")} priced yet, so the total may rise a little.`
      : '';
}

function renderMeta(p) {
  const tz = obj(p.window).tz;
  const at = dateTime(p.generated_at, tz);
  slot('meta-asof').textContent = at
    ? `Figures as of ${at}${typeof tz === 'string' && tz ? ` (${tz.replace(/_/g, ' ')} time)` : ''}.`
    : '';
}

/* ---------- Public API ---------- */

export function renderAll(payload) {
  if (!payload || typeof payload !== 'object') return;
  current = payload;
  const key = WINDOWS[obj(payload.window).key] ? payload.window.key : 'month';

  // Reveal first, so the chart canvases have a size when they are drawn.
  const main = $('#sections');
  main.classList.remove('is-loading', 'is-switching');
  main.removeAttribute('aria-busy');

  safely('header', () => renderHeader(payload));
  safely('people in care', () => renderHero(payload));
  safely('key figures', () => renderKpis(payload, key));
  safely('journey', () => renderJourney(payload));
  safely('campuses', () => renderCampuses(payload));
  safely('conversations', () => renderConversations(payload, key));
  safely('team', () => renderTeam(payload, key));
  safely('prayer', () => renderPrayer(payload));
  safely('spend', () => renderSpend(payload, key));
  safely('footer', () => renderMeta(payload));
}

/** Rebuilds every chart from the current payload (theme change, print). */
export function rebuildCharts() {
  destroyAllCharts();
  if (current) renderAll(current);
}

/** Draws charts in light colours for printing, then back. */
export function setPrintMode(on) {
  if (printLight === on) return;
  printLight = on;
  rebuildCharts();
}

/** Removes every figure from the page and returns it to its loading state. */
export function clearAll() {
  current = null;
  destroyAllCharts();
  document.querySelectorAll('[data-slot]').forEach((node) => {
    node.replaceChildren();
    node.classList.remove('rows-scroll', 'at-end');
  });
  document.querySelectorAll('[data-reset-hidden]').forEach((node) => {
    node.hidden = true;
  });
  document.querySelectorAll('canvas[role="img"]').forEach((canvas) => canvas.setAttribute('aria-label', 'Chart loading'));
  $('#spend-wait').textContent = '';
  $('#spend-note').textContent = '';
  const main = $('#sections');
  main.classList.add('is-loading');
  main.classList.remove('is-switching');
  main.setAttribute('aria-busy', 'true');
}

export function setSwitching(on) {
  const main = $('#sections');
  if (main.classList.contains('is-loading')) return;
  main.classList.toggle('is-switching', on);
  if (on) main.setAttribute('aria-busy', 'true');
  else main.removeAttribute('aria-busy');
}

export function setSpendControl({ busy = false, waitMs = 0, note = '' } = {}) {
  const button = $('#spend-btn');
  button.disabled = busy || waitMs > 0;
  button.textContent = busy ? 'Refreshing spend…' : 'Refresh spend';
  $('#spend-wait').textContent =
    !busy && waitMs > 0
      ? `Spend was refreshed recently. You can refresh it again in ${Math.max(1, Math.ceil(waitMs / 60_000))} min.`
      : '';
  $('#spend-note').textContent = note;
}
