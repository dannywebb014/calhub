import * as D from "./dates.js?v=32";
import * as google from "./google.js?v=32";
import * as reminders from "/lifeos/shared/reminders.js?v=32";
import { pullToRefresh } from "/lifeos/shared/pull.js?v=32";
import * as T from "./tasks.js?v=32";
import { parseEvent } from "./quickadd.js?v=32";
import { initDrag, isDragging } from "./drag.js?v=32";

// ?demo swaps Google, Craft and Todoist for made-up data held in memory.
const DEMO = new URLSearchParams(location.search).has("demo");
const demo = DEMO ? await import("./demo.js?v=32") : null;
const cal = DEMO ? demo.calendar : google;
const tk = DEMO ? { ...T, ...demo.taskSource } : T;

// ─── Settings ────────────────────────────────────────────────────────
// Which calendars and task lists are shown, the default calendar for new
// events, the last view, and the Google client ID. The client ID isn't a
// secret (it only says which app is asking), but it is kept here rather
// than in the repo so the page works with whichever Google project you use.
const SETTINGS_KEY = DEMO ? "calendar.demo" : "calendar.settings";
function loadSettings() {
  const base = { hidden: [], hiddenSpaces: [], view: "agenda", clientId: "", defaultCal: "", trayOpen: true, showTasks: true, sideOpen: true, theme: "auto" };
  try { return { ...base, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return base; }
}
let settings = loadSettings();
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } };

// "auto" follows the system; light or dark is set on <html> (index.html also
// does this before the first paint) and the browser bar colour follows it.
const THEME_BAR = { light: "#F2F3F4", dark: "#1a1e1a" };
function applyTheme() {
  const forced = settings.theme === "light" || settings.theme === "dark";
  if (forced) document.documentElement.dataset.theme = settings.theme;
  else delete document.documentElement.dataset.theme;
  for (const meta of document.querySelectorAll("meta[name=theme-color]")) {
    const own = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_BAR[forced ? settings.theme : own];
  }
}
applyTheme();

// ─── State ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const html = (s) => { const t = document.createElement("template"); t.innerHTML = s.trim(); return t.content.firstElementChild; };
const wide = matchMedia("(min-width: 960px)");
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

const S = {
  view: settings.view,
  day: D.today(),              // the day in focus
  stripMonth: false,           // phone: the whole month open under the header
  miniMonth: D.startOfMonth(D.today()),
  calendars: [],
  events: new Map(),           // key → event
  loaded: null,                // { from, to } of events fetched so far
  tasks: [],
  tasksLoaded: false,
  taskSpacesOk: new Set(),     // task lists that loaded in full last time
  agenda: null,                // { from, to } of days in the list
  sheet: null,                 // which sheet is open
  qaCal: null,                 // calendar chosen by hand in quick add
  qaPlace: null,               // …and the place ("" once removed)
};

const effectiveView = () => (wide.matches && S.view === "agenda" ? "week" : S.view);
const googleReady = () => DEMO || google.isConnected();
const spaceColour = (id) => `var(--sp-${id})`;
const findTask = (id) => S.tasks.find(t => t.id === id);
const calendarOf = (id) => S.calendars.find(c => c.id === id);
const writableCalendars = () => S.calendars.filter(c => c.writable);
const defaultCalendar = () =>
  writableCalendars().find(c => c.id === settings.defaultCal) || writableCalendars().find(c => c.primary) || writableCalendars()[0];

// ─── Icons ───────────────────────────────────────────────────────────
const svg = (body, size = 16, width = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const I = {
  check: svg(`<polyline points="20 6 9 17 4 12"/>`, 12, 3.4),
  checkSmall: svg(`<polyline points="20 6 9 17 4 12"/>`, 9, 3.6),
  pin: svg(`<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`),
  video: svg(`<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>`),
  people: svg(`<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`),
  notes: svg(`<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>`),
  repeatSmall: svg(`<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`, 10, 2.4),
  repeat: svg(`<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`, 12),
  x: svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`, 16, 2.4),
  grip: svg(`<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>`, 16, 2),
  clock: svg(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`),
  cal: svg(`<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`),
  chev: svg(`<polyline points="6 9 12 15 18 9"/>`, 16, 2.4),
  left: svg(`<polyline points="15 18 9 12 15 6"/>`, 16, 2.4),
  right: svg(`<polyline points="9 18 15 12 9 6"/>`, 16, 2.4),
  ext: svg(`<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`, 11, 2.4),
};

// ─── Toast ───────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, kind = "ok", action) {
  const t = $("toast");
  t.querySelector("span").textContent = msg;
  t.querySelector("button")?.remove();
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => { t.className = "toast"; action.run(); };
    t.append(b);
  }
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = "toast"; }, kind === "err" ? 7000 : 3200);
}

let busy = 0;
const setBusy = (on) => { busy = Math.max(0, busy + (on ? 1 : -1)); $("busy").hidden = !busy; };

// ─── What's on each day ──────────────────────────────────────────────
// Rebuilt before every paint. An event appears on every day it touches.
// A task appears on its date, and an overdue one on today, since it still
// needs doing today.
let index = { evs: new Map(), tasks: new Map(), undated: [], blocks: new Map() };
const byTime = (a, b) =>
  (b.allDay - a.allDay) || (a.start - b.start) || ((b.end - b.start) - (a.end - a.start)) || a.title.localeCompare(b.title);
const spaceOrder = (id) => T.SPACES.findIndex(s => s.id === id);

function reindex() {
  const hidden = new Set(settings.hidden);
  const hiddenSpaces = new Set(settings.hiddenSpaces);
  const evs = new Map();
  const blocks = new Map();
  for (const e of S.events.values()) {
    if (hidden.has(e.calendarId)) continue;
    if (e.taskId) {
      if (!blocks.has(e.taskId)) blocks.set(e.taskId, []);
      blocks.get(e.taskId).push(e);
    }
    for (let d = e.startDay, n = 0; d <= e.endDay && n < 400; d = D.addDays(d, 1), n++) {
      if (!evs.has(d)) evs.set(d, []);
      evs.get(d).push(e);
    }
  }
  for (const list of evs.values()) list.sort(byTime);
  const today = D.today();
  const tasks = new Map();
  const undated = [];
  for (const t of settings.showTasks ? S.tasks : []) {
    if (hiddenSpaces.has(t.spaceId)) continue;
    if (!t.date) { undated.push(t); continue; }
    const d = t.date < today ? today : t.date;
    // A task with a time block that day is shown as the block instead.
    if (blocks.get(t.id)?.some(e => !e.taskDone && e.startDay === d)) continue;
    if (!tasks.has(d)) tasks.set(d, []);
    tasks.get(d).push(t);
  }
  const order = (a, b) => (a.date || "").localeCompare(b.date || "") || spaceOrder(a.spaceId) - spaceOrder(b.spaceId) || a.text.localeCompare(b.text);
  for (const list of tasks.values()) list.sort(order);
  undated.sort(order);
  index = { evs, tasks, undated, blocks };
}
const eventsOn = (d) => index.evs.get(d) || [];
const tasksOn = (d) => index.tasks.get(d) || [];

// ─── Time blocks ─────────────────────────────────────────────────────
// Giving a task a time makes an event on the main calendar that carries the
// task's ID (google.js keeps it in the event's private properties). So the
// block is saved once and shows everywhere: on every device, in Google
// Calendar and on the Android widget. The task keeps its plain date, which
// follows the block's day. Here a block is drawn as its task, with a tick,
// in the task list's colour.
const blockCalendar = () => writableCalendars().find(c => c.primary) || defaultCalendar();
// The traffic light: 3 high (red), 2 medium (amber), 1 low (green), 0 none.
const PRIORITY = ["None", "Low", "Medium", "High"];
function light(el, t) {
  const p = t?.priority || 0;
  el.classList.toggle("prio", Boolean(p));
  if (p) el.style.setProperty("--pc", `var(--p${p})`);
  return el;
}
// Done when ticked off here, or when its task has gone from a list that loaded.
const blockDone = (e) => e.taskDone || (S.tasksLoaded && !findTask(e.taskId) && S.taskSpacesOk.has(e.taskSpace));
const colourOf = (e) => (e.taskId && e.taskSpace ? spaceColour(e.taskSpace) : e.color);
// The task's latest block that isn't done, if one has been loaded.
const blockOf = (t) => (index.blocks.get(t.id) || []).filter(e => !e.taskDone).sort((a, b) => b.start - a.start)[0] || null;
const blockMinutes = (t) => { const b = blockOf(t); return b ? Math.round((b.end - b.start) / 60000) : 60; };

// Up to three dots under a day: its calendars' colours, then its task lists'.
function dots(d) {
  const colours = [...new Set([...eventsOn(d).map(colourOf), ...tasksOn(d).map(t => spaceColour(t.spaceId))])].slice(0, 3);
  return colours.map(c => `<i style="--c:${esc(c)}"></i>`).join("");
}

// ─── Painting ────────────────────────────────────────────────────────
function render() {
  reindex();
  $("shell").dataset.view = S.view;
  renderTop();
  renderBanner();
  renderStrip();
  renderMini();
  renderTray();
  if (wide.matches || S.view === "agenda") renderAgenda();
  if (wide.matches || S.view !== "agenda") renderGrid();
  if (S.sheet === "tray") fillTraySheet();
}

function renderTop() {
  const v = effectiveView();
  const d = S.day;
  const title = $("title-text");
  title.innerHTML = v === "day" && wide.matches
    ? `${esc(D.weekday(d))} <span class="yr">${esc(D.dayMonth(d))}</span>`
    : `${esc(D.monthName(d))}${!wide.matches && d.slice(0, 4) === D.today().slice(0, 4) ? "" : ` <span class="yr">${d.slice(0, 4)}</span>`}`;
  $("title").classList.toggle("open", S.stripMonth);
  document.querySelectorAll("#views button").forEach(b => b.classList.toggle("on", b.dataset.view === v || (!wide.matches && b.dataset.view === S.view)));
  const n = index.undated.length;
  $("inbox-badge").hidden = !n;
  $("inbox-badge").textContent = n;
  $("today-num").textContent = Number(D.today().slice(8));
  // With the sidebar hidden on a desktop, its unscheduled tray is reached from the header instead.
  $("inbox-btn").hidden = wide.matches && settings.sideOpen;
  $("shell").classList.toggle("side-off", !settings.sideOpen);
  $("side-btn").setAttribute("aria-pressed", settings.sideOpen);
  $("inbox-btn").disabled = !settings.showTasks;
  $("tasks-btn").setAttribute("aria-pressed", settings.showTasks);
}

function renderBanner() {
  const box = $("banner");
  let text = "";
  let label = "";
  let run = null;
  if (DEMO) {
    text = "Demo — made-up events and tasks. Nothing you change is saved.";
    label = "Leave demo";
    run = () => { location.href = location.pathname; };
  } else if (!settings.clientId) {
    text = "Connect Google Calendar to see your events here.";
    label = "Set up";
    run = openSettings;
  } else if (!google.isConnected()) {
    text = google.wasConnected() ? "Google needs you to sign in again." : "Sign in to Google to see your calendars.";
    label = "Sign in";
    run = () => google.connect(settings.clientId);
  }
  box.hidden = !text;
  $("banner-text").textContent = text;
  $("banner-btn").textContent = label;
  $("banner-btn").onclick = run;
}

// The days of a month's weeks, Monday to Sunday, without a spare sixth row.
function weeksOf(month) {
  const days = D.monthGrid(month);
  const m = month.slice(0, 7);
  const weeks = [];
  for (let i = 0; i < 42; i += 7) {
    const week = days.slice(i, i + 7);
    if (week.some(d => d.slice(0, 7) === m)) weeks.push(...week);
  }
  return weeks;
}

function dayCell(d, other) {
  const cls = ["cal-day", other && "other", d === D.today() && "today", d === S.day && "sel"].filter(Boolean).join(" ");
  return `<button class="${cls}" data-pick="${d}" data-drop-date="${d}" aria-label="${esc(D.weekday(d))} ${esc(D.dayMonth(d))}"><span class="num">${Number(d.slice(8))}</span><span class="dots">${dots(d)}</span></button>`;
}
const dowRow = () => `<div class="cal-row">${DOW.map(x => `<div class="cal-dow">${x}</div>`).join("")}</div>`;

// Phone: a week of days under the header, or the whole month when the title is tapped.
function renderStrip() {
  if (wide.matches) return;
  const box = $("strip");
  const month = S.day.slice(0, 7);
  const days = S.stripMonth ? weeksOf(S.day) : D.range(D.startOfWeek(S.day), 7);
  box.className = S.stripMonth ? "strip-month" : "";
  box.innerHTML = `${dowRow()}<div class="cal-row">${days.map(d => dayCell(d, S.stripMonth && d.slice(0, 7) !== month)).join("")}</div>`;
}

// Desktop: the month in the sidebar.
function renderMini() {
  if (!wide.matches) return;
  const m = S.miniMonth;
  $("mini").innerHTML = `<div class="mini-head"><b>${esc(D.monthYear(m))}</b>
      <div class="navs"><button class="step" data-mini="-1" aria-label="Previous month">${I.left}</button><button class="step" data-mini="1" aria-label="Next month">${I.right}</button></div></div>
    ${dowRow()}<div class="cal-row">${weeksOf(m).map(d => dayCell(d, d.slice(0, 7) !== m.slice(0, 7))).join("")}</div>`;
}

// ─── Agenda ──────────────────────────────────────────────────────────
function ensureAgendaCovers(day) {
  if (!S.agenda || day < S.agenda.from || day > D.addDays(S.agenda.to, -30)) {
    S.agenda = { from: D.addDays(day, -14), to: D.addDays(day, 60) };
  }
}

// Re-painting keeps whichever day was at the top of the list where it was.
function keepAnchor(box, paint) {
  const top = box.scrollTop;
  const first = [...box.children].find(el => el.offsetTop + el.offsetHeight > top);
  const key = first?.dataset.day;
  const delta = first ? top - first.offsetTop : 0;
  paint();
  const again = key && box.querySelector(`[data-day="${key}"]`);
  if (again) box.scrollTop = again.offsetTop + delta;
}

function renderAgenda() {
  ensureAgendaCovers(S.day);
  const box = $("agenda");
  const days = D.range(S.agenda.from, D.diffDays(S.agenda.from, S.agenda.to) + 1);
  keepAnchor(box, () => box.replaceChildren(...days.map(d => agendaDay(d))));
}

let focusHold = 0;
function scrollAgendaTo(day) {
  const box = $("agenda");
  const el = box.querySelector(`[data-day="${day}"]`);
  if (!el) return;
  focusHold = Date.now() + 400;
  box.scrollTop = el.offsetTop;
}

function agendaDay(d) {
  const today = D.today();
  const sec = document.createElement("section");
  sec.className = `a-day${d === today ? " is-today" : ""}${d < today ? " past" : ""}`;
  sec.dataset.day = d;
  sec.dataset.dropDate = d;
  const tag = d === today ? "Today" : d === D.addDays(today, 1) ? "Tomorrow" : "";
  const year = d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : "";
  sec.innerHTML = `<h3 class="a-head"><span class="dow">${esc(D.weekday(d))}</span><span class="date">${esc(D.dayMonth(d))}${year}</span>${tag ? `<span class="tag">${tag}</span>` : ""}</h3>`;
  const rows = dayRows(d);
  if (!rows.length) {
    sec.insertAdjacentHTML("beforeend", `<div class="a-empty">${d === today ? "Nothing planned today." : "Nothing planned"}</div>`);
  } else {
    const card = document.createElement("div");
    card.className = "a-card";
    card.append(...rows);
    sec.append(card);
  }
  return sec;
}

// All-day events, then tasks (overdue first), then timed events, with a
// "now" line through today.
function dayRows(d) {
  const evs = eventsOn(d);
  const out = evs.filter(e => e.allDay).map(e => eventRow(e, d));
  out.push(...tasksOn(d).map(taskRow));
  const timed = evs.filter(e => !e.allDay);
  const now = new Date();
  let placed = d !== D.today() || !timed.length;
  for (const e of timed) {
    if (!placed && e.start > now) { out.push(nowMarker()); placed = true; }
    out.push(eventRow(e, d));
  }
  if (!placed) out.push(nowMarker());
  return out;
}

function nowMarker() {
  return html(`<div class="a-now" aria-hidden="true"><span>${D.time(new Date())}</span></div>`);
}

function eventWhen(e, d) {
  if (e.allDay) return `<div class="when allday">all-day</div>`;
  const starts = e.startDay === d;
  const ends = e.endDay === d;
  if (starts) return `<div class="when">${D.time(e.start)}<span class="end">${ends ? D.time(e.end) : "→"}</span></div>`;
  if (ends) return `<div class="when"><span class="end">until</span>${D.time(e.end)}</div>`;
  return `<div class="when allday">all-day</div>`;
}

function eventRow(e, d) {
  if (e.taskId) return blockRow(e, d);
  const row = document.createElement("div");
  row.className = `a-row${e.end < new Date() ? " ended" : ""}`;
  row.style.setProperty("--c", e.color);
  row.dataset.open = `event:${e.key}`;
  if (e.editable) row.dataset.drag = `event:${e.key}`;
  const bits = [];
  if (e.location) bits.push(`<span>${I.pin} ${esc(e.location.split("\n")[0])}</span>`);
  if (videoLink(e)) bits.push(`<span>${I.video} Video call</span>`);
  if (e.recurring) bits.push(`<span>${I.repeat}</span>`);
  row.innerHTML = `${eventWhen(e, d)}<div class="bar"></div><div class="body"><div class="title"></div>${bits.length ? `<div class="sub">${bits.join("")}</div>` : ""}</div>`;
  row.querySelector(".title").textContent = e.title;
  return row;
}

// A time block: its time, then a tick and the task, as a task row would show it.
function blockRow(e, d) {
  const done = blockDone(e);
  const t = findTask(e.taskId);
  const row = document.createElement("div");
  row.className = `a-row block${done ? " done" : ""}${e.end < new Date() ? " ended" : ""}${t && tk.isLocked(t) ? " locked" : ""}`;
  row.style.setProperty("--c", colourOf(e));
  row.dataset.open = `event:${e.key}`;
  if (e.editable) row.dataset.drag = `event:${e.key}`;
  const where = t ? `<span>${esc(t.where.label)}</span>` : "";
  row.innerHTML = `${eventWhen(e, d)}<div class="bar"></div><div class="tick-cell"><button class="tick" aria-label="Tick off">${I.check}</button></div>
    <div class="body"><div class="title"></div><div class="sub">${e.taskSpace ? `<span class="sp">${esc(T.spaceLabel(e.taskSpace))}</span>` : ""}${where}${t?.recurring ? `<span title="Repeats">${I.repeat}</span>` : ""}</div></div>`;
  row.querySelector(".title").textContent = e.title;
  row.querySelector(".tick").onclick = (ev) => { ev.stopPropagation(); tickBlock(e); };
  return light(row, t);
}

function taskRow(t) {
  const row = document.createElement("div");
  row.className = `a-row task${tk.isLocked(t) ? " locked" : ""}`;
  row.style.setProperty("--c", spaceColour(t.spaceId));
  row.dataset.open = `task:${t.id}`;
  row.dataset.drag = `task:${t.id}`;
  const late = t.date < D.today();
  row.innerHTML = `<div class="tick-cell"><button class="tick" aria-label="Tick off">${I.check}</button></div><div class="bar"></div>
    <div class="body"><div class="title"></div><div class="sub"><span class="sp">${esc(T.spaceLabel(t.spaceId))}</span><span>${esc(t.where.label)}</span>${t.recurring ? `<span title="Repeats">${I.repeat}</span>` : ""}${late ? `<span class="late">was due ${esc(D.relative(t.date))}</span>` : ""}</div></div>`;
  row.querySelector(".title").textContent = t.text;
  row.querySelector(".tick").onclick = (ev) => { ev.stopPropagation(); tick(t, row); };
  return light(row, t);
}

// ─── Day and week ────────────────────────────────────────────────────
function renderGrid() {
  const box = $("grid");
  const v = effectiveView();
  if (v === "agenda") return;
  if (v === "month") { box.classList.remove("narrow"); return renderMonth(box); }
  renderTimeline(box, v === "day" ? [S.day] : D.range(D.startOfWeek(S.day), 7), v);
}

// Side-by-side columns for events that overlap, as calendars usually do.
function layout(evs, day) {
  const items = evs.map(e => {
    const s = D.minutesInto(day, e.start);
    return { e, s, en: Math.max(D.minutesInto(day, e.end), s + 20) };
  }).sort((a, b) => a.s - b.s || b.en - a.en);
  let cluster = [];
  let columns = [];
  let clusterEnd = -1;
  const close = () => { for (const it of cluster) it.cols = columns.length; cluster = []; columns = []; };
  for (const it of items) {
    if (it.s >= clusterEnd) { close(); clusterEnd = -1; }
    let col = columns.findIndex(end => end <= it.s);
    if (col === -1) { col = columns.length; columns.push(0); }
    columns[col] = it.en;
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.en);
  }
  close();
  return items;
}

let lastPeriod = "";
function renderTimeline(box, days, v) {
  const template = `44px repeat(${days.length}, minmax(0,1fr))`;
  const oldScroll = box.querySelector(".tl-wrap")?.scrollTop;
  const period = `${v}:${days[0]}`;
  const today = D.today();
  const now = new Date();

  const head = html(`<div class="g-head" style="grid-template-columns:${template}"><div class="gutter"></div>
    ${days.map(d => `<button class="col-head${d === today ? " today" : ""}" data-goto-day="${d}" data-drop-date="${d}">
      <div class="d">${esc(D.weekday(d, days.length === 1 ? "long" : "short"))}</div><span class="n">${Number(d.slice(8))}</span></button>`).join("")}</div>`);

  const band = html(`<div class="band" style="grid-template-columns:${template}"><div class="cell label">all-day</div></div>`);
  for (const d of days) {
    const cell = html(`<div class="cell" data-drop-date="${d}"></div>`);
    for (const e of eventsOn(d).filter(e => e.allDay || (e.startDay !== d && e.endDay !== d))) cell.append(eventChip(e, d));
    for (const t of tasksOn(d)) cell.append(taskChip(t));
    band.append(cell);
  }

  const wrap = html(`<div class="tl-wrap scroller"><div class="tl" style="grid-template-columns:${template}">
    <div class="hours">${Array.from({ length: 24 }, (_, h) => `<div>${h ? `${String(h).padStart(2, "0")}:00` : ""}</div>`).join("")}</div></div></div>`);
  const tl = wrap.firstElementChild;
  for (const d of days) {
    const col = html(`<div class="col${d === today ? " today" : ""}" data-drop-date="${d}" data-drop-time="1"></div>`);
    const timed = eventsOn(d).filter(e => !e.allDay && (e.startDay === d || e.endDay === d));
    for (const it of layout(timed, d)) {
      const e = it.e;
      const mins = it.en - it.s;
      const b = document.createElement("div");
      b.className = `ev${mins < 45 ? " short" : ""}${e.end < now ? " past" : ""}${e.taskId ? " block" : ""}${e.taskId && blockDone(e) ? " done" : ""}`;
      b.style.cssText = `top:${(it.s / 1440) * 100}%;height:calc(${(mins / 1440) * 100}% - 2px);left:calc(${(it.col / it.cols) * 100}% + 2px);width:calc(${100 / it.cols}% - 4px);--c:${colourOf(e)}`;
      b.dataset.open = `event:${e.key}`;
      if (e.editable) b.dataset.drag = `event:${e.key}`;
      b.innerHTML = `${e.taskId ? `<button class="tick" aria-label="Tick off">${I.checkSmall}</button>` : ""}<b></b><small>${D.time(e.start)}${mins >= 45 ? ` – ${D.time(e.end)}` : ""}${e.taskId && findTask(e.taskId)?.recurring ? ` <i class="rep" title="Repeats">${I.repeatSmall}</i>` : ""}</small>`;
      b.querySelector(".tick")?.addEventListener("click", (ev) => { ev.stopPropagation(); tickBlock(e); });
      if (e.taskId) light(b, findTask(e.taskId));
      b.querySelector("b").textContent = e.title;
      if (mins >= 75 && e.location) b.insertAdjacentHTML("beforeend", `<small style="display:block">${esc(e.location.split("\n")[0])}</small>`);
      col.append(b);
    }
    if (d === today) col.insertAdjacentHTML("beforeend", `<div class="now-line" style="top:${(D.minutesInto(d, now) / 1440) * 100}%"></div>`);
    tl.append(col);
  }

  box.replaceChildren(head, band, wrap);
  box.classList.toggle("narrow", !wide.matches && days.length > 1);
  // Open a new day or week at the working day, or just before now.
  if (period === lastPeriod && oldScroll != null) wrap.scrollTop = oldScroll;
  else {
    const mins = days.includes(today) ? Math.max(0, D.minutesInto(today, now) - 90) : 7 * 60;
    wrap.scrollTop = (mins / 1440) * tl.offsetHeight;
  }
  lastPeriod = period;
}

function eventChip(e, d) {
  if (e.taskId) return blockChip(e);
  const chip = document.createElement("button");
  chip.className = `chip${e.startDay < d ? " cont-l" : ""}${e.endDay > d ? " cont-r" : ""}`;
  chip.style.setProperty("--c", e.color);
  chip.dataset.open = `event:${e.key}`;
  if (e.editable) chip.dataset.drag = `event:${e.key}`;
  chip.innerHTML = `<span></span>`;
  chip.firstChild.textContent = e.title;
  return chip;
}

function blockChip(e) {
  const chip = document.createElement("div");
  chip.className = `chip task block${blockDone(e) ? " done" : ""}`;
  chip.style.setProperty("--c", colourOf(e));
  chip.dataset.open = `event:${e.key}`;
  if (e.editable) chip.dataset.drag = `event:${e.key}`;
  chip.innerHTML = `<button class="tick" aria-label="Tick off">${I.checkSmall}</button><span></span>${findTask(e.taskId)?.recurring ? `<i class="rep" title="Repeats">${I.repeatSmall}</i>` : ""}`;
  chip.querySelector("span").textContent = e.title;
  light(chip, findTask(e.taskId));
  chip.querySelector(".tick").onclick = (ev) => { ev.stopPropagation(); tickBlock(e); };
  return chip;
}

function taskChip(t) {
  const chip = document.createElement("div");
  chip.className = `chip task${t.date < D.today() ? " overdue" : ""}${tk.isLocked(t) ? " locked" : ""}`;
  chip.style.setProperty("--c", spaceColour(t.spaceId));
  chip.dataset.open = `task:${t.id}`;
  chip.dataset.drag = `task:${t.id}`;
  chip.innerHTML = `<button class="tick" aria-label="Tick off">${I.checkSmall}</button><span></span>${t.recurring ? `<i class="rep" title="Repeats">${I.repeatSmall}</i>` : ""}`;
  chip.querySelector("span").textContent = t.text;
  chip.querySelector(".tick").onclick = (ev) => { ev.stopPropagation(); tick(t, chip); };
  return chip;
}

// ─── Month ───────────────────────────────────────────────────────────
function renderMonth(box) {
  const month = S.day.slice(0, 7);
  const days = weeksOf(S.day);
  const today = D.today();
  const phone = !wide.matches;
  box.innerHTML = `<div class="m-dow">${D.range(D.startOfWeek(today), 7).map(d => `<div>${esc(D.weekday(d, "short"))}</div>`).join("")}</div>
    <div class="m-grid" style="${phone ? "" : `grid-template-rows:repeat(${days.length / 7}, minmax(0,1fr))`}"></div>
    <div class="m-list scroller"></div>`;
  const grid = box.querySelector(".m-grid");
  for (const d of days) {
    const cls = ["m-cell", d.slice(0, 7) !== month && "other", d === today && "today", d === S.day && "sel"].filter(Boolean).join(" ");
    const cell = html(`<button class="${cls}" data-pick="${d}" data-drop-date="${d}"><span class="n">${Number(d.slice(8))}</span></button>`);
    if (phone) {
      cell.insertAdjacentHTML("beforeend", `<span class="mdots">${dots(d)}</span>`);
    } else {
      for (const e of eventsOn(d)) {
        const chip = eventChip(e, d);
        if (!e.allDay && e.startDay === d) chip.lastElementChild.insertAdjacentHTML("beforebegin", `<span class="t">${D.time(e.start)}</span>`);
        cell.append(chip);
      }
      for (const t of tasksOn(d)) cell.append(taskChip(t));
    }
    grid.append(cell);
  }
  if (phone) {
    box.querySelector(".m-list").append(agendaDay(S.day));
  } else {
    // Whatever doesn't fit in a day becomes "+3 more".
    requestAnimationFrame(() => {
      for (const cell of grid.children) {
        const chips = [...cell.querySelectorAll(".chip")];
        let hidden = 0;
        while (chips.length && cell.scrollHeight > cell.clientHeight + 1) {
          chips.pop().remove();
          hidden++;
          if (hidden === 1) cell.insertAdjacentHTML("beforeend", `<span class="more"></span>`);
        }
        if (hidden) {
          // The "+n more" line takes room too, so one more may need to go.
          if (cell.scrollHeight > cell.clientHeight + 1 && chips.length) { chips.pop().remove(); hidden++; }
          cell.querySelector(".more").textContent = `+${hidden} more`;
        }
      }
    });
  }
}

// ─── Inbox tray (tasks without a date) ───────────────────────────────
function trayItems() {
  const list = document.createElement("div");
  list.className = "tray-list";
  if (!S.tasksLoaded) {
    list.innerHTML = `<p class="tray-hint">Loading tasks…</p>`;
    return list;
  }
  if (!index.undated.length) {
    list.innerHTML = `<p class="tray-hint">Nothing unscheduled. Nice.</p>`;
    return list;
  }
  list.innerHTML = `<p class="tray-hint">${wide.matches ? "Drag a task onto a day, or onto a time to block it out." : "Press and hold a task, then drag it onto a day or a time. Or pick a date."}</p>`;
  for (const t of index.undated) {
    const item = html(`<div class="tray-item" data-drag="task:${esc(t.id)}" data-open="task:${esc(t.id)}" style="--c:${spaceColour(t.spaceId)}">
      <span class="grip">${I.grip}</span>
      <button class="tick" aria-label="Tick off">${I.check}</button>
      <div class="body"><div class="title"></div><div class="sub"><span class="sp">${esc(T.spaceLabel(t.spaceId))}</span> · ${esc(t.where.label)}${t.recurring ? ` · <span title="Repeats">${I.repeat}</span>` : ""}</div></div>
      <label class="date-pick" aria-label="Pick a date">${I.cal}<input type="date"></label></div>`);
    item.querySelector(".title").textContent = t.text;
    light(item, t);
    item.querySelector(".tick").onclick = (ev) => { ev.stopPropagation(); tick(t, item); };
    item.querySelector("label").onclick = (ev) => ev.stopPropagation();
    const pick = item.querySelector("input");
    pick.onchange = () => { if (pick.value) moveTask(t, pick.value); };
    list.append(item);
  }
  return list;
}

function renderTray() {
  if (!wide.matches) return;
  const box = $("tray-inline");
  box.hidden = !settings.showTasks;
  box.className = settings.trayOpen ? "" : "tray-closed";
  box.innerHTML = `<button class="tray-head" id="tray-toggle"><b>unscheduled<span class="dot-accent">.</span></b><span class="n">${index.undated.length || ""}</span>${I.chev}</button>`;
  box.append(trayItems());
}

function fillTraySheet() {
  const node = html(`<div><div class="sh-head"><h2>unscheduled<span class="dot-accent">.</span></h2><button class="x-btn" data-close aria-label="Close">${I.x}</button></div></div>`);
  node.append(trayItems());
  $("sheet").replaceChildren(node);
}

// ─── Sheets ──────────────────────────────────────────────────────────
// A sheet that needs tidying when it goes.
let onSheetClose = null;
const sheetGone = () => { const f = onSheetClose; onSheetClose = null; f?.(); };

function openSheet(kind, node) {
  sheetGone();
  S.sheet = kind;
  if (node) $("sheet").replaceChildren(node);
  $("sheet-layer").hidden = false;
  $("sheet").scrollTop = 0;
}
function closeSheet() {
  sheetGone();
  S.sheet = null;
  $("sheet-layer").hidden = true;
  $("sheet-layer").classList.remove("away");
  $("sheet").replaceChildren();
}

const dur = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr${m % 60 ? ` ${m % 60} min` : ""}`;
};

function whenText(e) {
  if (e.allDay) {
    if (e.startDay === e.endDay) return `${esc(D.weekday(e.startDay))} ${esc(D.dayMonth(e.startDay))}<br><span class="muted">all-day</span>`;
    return `${esc(D.relative(e.startDay))} – ${esc(D.relative(e.endDay))}<br><span class="muted">all-day · ${D.diffDays(e.startDay, e.endDay) + 1} days</span>`;
  }
  if (e.startDay === e.endDay) {
    return `${esc(D.weekday(e.startDay))} ${esc(D.dayMonth(e.startDay))}<br>${D.time(e.start)} – ${D.time(e.end)} <span class="muted">· ${dur(e.end - e.start)}</span>`;
  }
  return `${esc(D.relative(e.startDay))}, ${D.time(e.start)} –<br>${esc(D.relative(e.endDay))}, ${D.time(e.end)}`;
}

const VIDEO_URL = /https?:\/\/[^\s<>"']*(?:zoom\.us|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|whereby\.com|webex\.com)[^\s<>"']*/i;
const videoLink = (e) => e.video || (e.location.match(VIDEO_URL) || e.description.match(VIDEO_URL) || [])[0] || null;

// Google Maps everywhere: on a phone with the app, it opens in the app.
const mapsLink = (place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

// Google keeps notes as HTML when they were written in its own app.
function notesText(desc) {
  if (!/<[a-z][\s\S]*>/i.test(desc)) return desc;
  const doc = new DOMParser().parseFromString(desc.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n"), "text/html");
  return doc.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
}
const linkify = (text) => esc(text).replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

function openEvent(key) {
  const e = S.events.get(key);
  if (!e) return;
  const c = calendarOf(e.calendarId);
  const video = videoLink(e);
  const rows = [];
  if (e.location && !(video && e.location.trim() === video)) {
    rows.push(`<div class="d-row">${I.pin}<div class="grow"><a href="${esc(mapsLink(e.location))}" target="_blank" rel="noopener">${esc(e.location)}</a></div></div>`);
  }
  if (video) {
    const host = new URL(video).hostname.replace(/^www\./, "");
    rows.push(`<div class="d-row">${I.video}<div class="grow"><a class="join" href="${esc(video)}" target="_blank" rel="noopener">Join video call</a> <span class="f-note" style="display:inline;margin-left:6px">${esc(host)}</span></div></div>`);
  }
  if (e.attendees.length) {
    const mark = { accepted: "✓", declined: "✕", tentative: "?", needsAction: "·" };
    const people = [...e.attendees].sort((a, b) => (b.organizer ? 1 : 0) - (a.organizer ? 1 : 0));
    rows.push(`<div class="d-row">${I.people}<div class="grow"><ul class="people">${people.map(a => `
      <li><span class="st ${esc(a.responseStatus)}">${mark[a.responseStatus] || "·"}</span>${esc(a.displayName || a.email)}
      ${a.self ? `<span class="role">you</span>` : ""}${a.organizer ? `<span class="role">organiser</span>` : ""}</li>`).join("")}</ul></div></div>`);
  }
  const notes = notesText(e.description);
  if (notes) rows.push(`<div class="d-row">${I.notes}<div class="grow notes">${linkify(notes)}</div></div>`);
  // A time block names its task, and can tick it off.
  const task = e.taskId ? findTask(e.taskId) : null;
  const done = e.taskId && blockDone(e);
  if (e.taskId) {
    const list = e.taskSpace ? T.spaceLabel(e.taskSpace) : "Task";
    rows.unshift(`<div class="d-cal" style="--c:${colourOf(e)}"><i style="border-radius:50%"></i>Time block for a task · ${esc(list)}${task ? ` · ${esc(task.where.label)}` : ""}${done ? " · done" : ""}</div>`);
  }

  const node = html(`<div>
    <div class="sh-head" style="--c:${esc(colourOf(e))}"><span class="swatch"${e.taskId ? ` style="border-radius:50%"` : ""}></span><h2></h2><button class="x-btn" data-close aria-label="Close">${I.x}</button></div>
    <p class="d-when">${whenText(e)}</p>
    <div class="d-cal" style="--c:${esc(c?.color || e.color)}"><i></i>${esc(c?.name || "")}${e.recurring ? ` · ${I.repeat} repeats` : ""}</div>
    ${rows.join("")}
    <div class="sh-foot">
      ${e.editable ? `<button class="btn danger" data-act="delete">${e.taskId ? "Remove block" : "Delete"}</button>` : ""}
      <span class="spacer"></span>
      ${e.htmlLink ? `<a class="btn" href="${esc(e.htmlLink)}" target="_blank" rel="noopener">Google</a>` : ""}
      ${e.editable ? `<button class="btn${e.taskId && !done ? "" : " primary"}" data-act="edit">Edit</button>` : ""}
      ${e.taskId && !done ? `<button class="btn primary" data-act="tick">Tick off</button>` : ""}
    </div></div>`);
  node.querySelector("h2").textContent = e.title;
  node.querySelector("[data-act=edit]")?.addEventListener("click", () => openEditor(e));
  node.querySelector("[data-act=delete]")?.addEventListener("click", () => removeEvent(e));
  node.querySelector("[data-act=tick]")?.addEventListener("click", () => { closeSheet(); tickBlock(e); });
  openSheet("event", node);
}

async function removeEvent(e) {
  const ask = e.taskId ? `Remove the time block for “${e.title}”? The task stays.`
    : e.recurring ? `Delete “${e.title}”? Only this occurrence is deleted.` : `Delete “${e.title}”?`;
  if (!confirm(ask)) return;
  closeSheet();
  S.events.delete(e.key);
  render();
  try {
    await cal.deleteEvent(e);
    toast(e.taskId ? `Removed the time block for ${e.title}` : `Deleted ${e.title}`);
    writeSnapshot();
  } catch (err) {
    S.events.set(e.key, e);
    render();
    googleError(err, "Couldn’t delete it");
  }
}

// ─── Event editor ────────────────────────────────────────────────────
function openEditor(e, draft) {
  const isNew = !e;
  const src = e || draft;
  const c = isNew ? (src.calendar || defaultCalendar()) : calendarOf(e.calendarId);
  if (!c) { toast("Connect Google Calendar in settings first.", "err"); return; }
  const endIncl = src.allDay ? new Date(src.end.getTime() - 86400000) : src.end;
  const node = html(`<form class="form" novalidate>
    <div class="sh-head"><h2>${isNew ? "New event" : "Edit event"}</h2><button type="button" class="x-btn" data-close aria-label="Close">${I.x}</button></div>
    <input class="f-title" name="title" placeholder="Title" autocomplete="off" enterkeyhint="done">
    <div class="f-group">
      <div class="f-line"><label>Calendar</label><select name="cal"></select><span class="sw" style="width:12px;height:12px;border-radius:4px"></span></div>
      <div class="f-line"><label>All-day</label><div class="switch"><input type="checkbox" name="allDay"><span></span></div></div>
      <div class="f-line"><label>Starts</label><input type="date" name="sd"><input type="time" name="st" step="300"></div>
      <div class="f-line"><label>Ends</label><input type="date" name="ed"><input type="time" name="et" step="300"></div>
    </div>
    <div class="f-group"><div class="f-line"><label>Location</label><input type="text" name="location" placeholder="Add a place" autocomplete="off"></div></div>
    <textarea class="f-notes" name="notes" placeholder="Notes"></textarea>
    ${e?.recurring ? `<p class="f-note">This is one of a repeating series. Changes apply to this occurrence only.</p>` : ""}
    <p class="f-err" hidden></p>
    <div class="sh-foot"><button type="button" class="btn" data-close>Cancel</button><span class="spacer"></span><button class="btn primary">${isNew ? "Add" : "Save"}</button></div>
  </form>`);
  const f = node.elements;
  f.title.value = isNew ? (src.title || "") : e.title;
  for (const x of writableCalendars()) f.cal.append(new Option(x.name, x.id, false, x.id === c.id));
  f.cal.disabled = Boolean(e?.recurring);
  const paintSwatch = () => { node.querySelector(".sw").style.background = calendarOf(f.cal.value)?.color || ""; };
  paintSwatch();
  f.cal.onchange = paintSwatch;
  f.allDay.checked = src.allDay;
  f.sd.value = D.iso(src.start);
  f.st.value = D.hhmm(src.start);
  f.ed.value = D.iso(endIncl);
  f.et.value = D.hhmm(src.end);
  f.location.value = src.location || "";
  const initialNotes = notesText(src.description || "");
  f.notes.value = initialNotes;

  const times = () => node.querySelectorAll("input[type=time]").forEach(i => { i.hidden = f.allDay.checked; });
  times();
  // An all-day event's times are both midnight, so turning all-day off
  // would leave a zero-length event that can't be saved. Give it 9–10am
  // (or the next hour, today) on its first day instead.
  f.allDay.onchange = () => {
    times();
    if (!f.allDay.checked && f.st.value === "00:00" && f.et.value === "00:00") {
      const hour = f.sd.value === D.today() ? Math.min(23, new Date().getHours() + 1) : 9;
      const start = D.atMinutes(f.sd.value, hour * 60);
      const end = new Date(start.getTime() + 3600000);
      f.st.value = D.hhmm(start);
      f.ed.value = D.iso(end);
      f.et.value = D.hhmm(end);
      length = end - start;
    }
  };

  const read = () => {
    const allDay = f.allDay.checked;
    const start = allDay ? D.parse(f.sd.value) : new Date(`${f.sd.value}T${f.st.value || "09:00"}`);
    const end = allDay ? D.parse(D.addDays(f.ed.value || f.sd.value, 1)) : new Date(`${f.ed.value || f.sd.value}T${f.et.value || "10:00"}`);
    return { allDay, start, end };
  };
  // Moving the start moves the end with it, keeping the length.
  let length = read().end - read().start;
  const shiftEnd = () => {
    if (!f.sd.value) return;
    const { allDay, start } = read();
    const end = new Date(start.getTime() + Math.max(length, allDay ? 86400000 : 15 * 60000));
    f.ed.value = D.iso(allDay ? new Date(end.getTime() - 86400000) : end);
    f.et.value = D.hhmm(end);
  };
  f.sd.onchange = shiftEnd;
  f.st.onchange = shiftEnd;
  const remember = () => { const r = read(); if (r.end > r.start) length = r.end - r.start; };
  f.ed.onchange = remember;
  f.et.onchange = remember;

  node.onsubmit = async (ev) => {
    ev.preventDefault();
    const err = node.querySelector(".f-err");
    const { allDay, start, end } = read();
    if (!f.title.value.trim()) { err.textContent = "Give it a title."; err.hidden = false; f.title.focus(); return; }
    if (!(end > start) || isNaN(start)) { err.textContent = "It needs to end after it starts."; err.hidden = false; return; }
    const fields = { title: f.title.value.trim(), allDay, start, end, location: f.location.value.trim() };
    if (f.notes.value !== initialNotes) fields.description = f.notes.value;
    const target = calendarOf(f.cal.value);
    const btn = node.querySelector(".btn.primary");
    btn.disabled = true;
    try {
      const saved = isNew ? await cal.createEvent(target, fields) : await cal.updateEvent(e, fields, c, target);
      if (e) S.events.delete(e.key);
      S.events.set(saved.key, saved);
      closeSheet();
      render();
      toast(`${isNew ? "Added" : "Saved"} ${saved.title}`);
      writeSnapshot();
      followBlock(saved);
    } catch (x) {
      btn.disabled = false;
      if (x.status === 401) { googleError(x); return; }
      err.textContent = x instanceof TypeError ? "Couldn’t reach Google. Check your connection." : `Google said no: ${x.message}`;
      err.hidden = false;
    }
  };
  openSheet("editor", node);
  if (isNew && !f.title.value && wide.matches) f.title.focus();
}

// A new event in the day on screen, at the next whole hour, or at a time
// picked by tapping the timeline.
function newEventAt(day, minute) {
  let start;
  if (minute != null) start = D.atMinutes(day, minute);
  else {
    const now = new Date();
    start = D.atMinutes(day, day === D.today() ? Math.min(23, now.getHours() + 1) * 60 : 9 * 60);
  }
  openEditor(null, { title: "", allDay: false, start, end: new Date(start.getTime() + 3600000), location: "", description: "" });
}

// ─── Task sheet ──────────────────────────────────────────────────────
function openTask(id) {
  const t = findTask(id);
  if (!t) return;
  const late = t.date && t.date < D.today();
  const node = html(`<div>
    <div class="sh-head" style="--c:${spaceColour(t.spaceId)}"><span class="swatch" style="border-radius:50%"></span><h2></h2><button class="x-btn" data-close aria-label="Close">${I.x}</button></div>
    <div class="d-cal" style="--c:${spaceColour(t.spaceId)}"><i></i>${esc(T.spaceLabel(t.spaceId))} · ${esc(t.where.label)}${t.recurring ? ` · ${I.repeat} repeats` : ""}</div>
    <div class="f-group">
      <div class="f-line"><label>Priority</label><div class="prio-seg" role="group" aria-label="Priority">${[3, 2, 1, 0].map(p =>
        `<button type="button" data-p="${p}" aria-pressed="${(t.priority || 0) === p}"${p ? ` style="--pc:var(--p${p})"` : ""}><i></i>${PRIORITY[p]}</button>`).join("")}</div></div>
      <div class="f-line"><label>Date</label><input type="date" name="date"></div>
      <div class="f-line"><label>Time</label><input type="time" name="time" step="900"><select name="len" aria-label="How long"></select><button type="button" class="btn" data-act="block" disabled>Block</button></div>
    </div>
    <p class="f-note" style="margin:6px 2px 0">A time blocks it out on your main calendar.</p>
    ${late ? `<p class="f-note late" style="margin-top:8px">Overdue: it was due ${esc(D.relative(t.date))}.</p>` : ""}
    ${tk.isLocked(t) ? `<p class="f-note" style="margin-top:8px">${esc(T.lockedHelp(t))}</p>` : ""}
    <div class="sh-foot"><a class="btn" href="${T.TASKS_APP}" data-hub="tasks">Open tasks.</a>${blockOf(t) ? `<button class="btn" data-act="event">Event</button>` : ""}<span class="spacer"></span><button class="btn primary" data-act="tick">Tick off</button></div>
  </div>`);
  node.querySelector("h2").textContent = t.text;
  const date = node.querySelector("input[type=date]");
  const time = node.querySelector("input[type=time]");
  const len = node.querySelector("select[name=len]");
  const block = blockOf(t);
  const minutes = blockMinutes(t);
  for (const m of [...new Set([15, 30, 45, 60, 90, 120, 180, minutes])].sort((a, b) => a - b)) {
    len.append(new Option(dur(m * 60000), m, false, m === minutes));
  }
  date.value = block?.startDay || t.date || "";
  time.value = block ? D.hhmm(block.start) : "";
  // A new date is saved straight away and the sheet stays open, so a time
  // can be set next. With a block, the date takes the block along at the
  // same time.
  date.onchange = () => {
    if (!date.value) return;
    const b = blockOf(t);
    if (b) moveEvent(b, { date: date.value, minute: D.minutesInto(b.startDay, b.start) });
    else moveTask(t, date.value);
  };
  // A time is saved with the button rather than on change, which some
  // browsers fire after the hour is typed and before the minutes. With the
  // time cleared, the button takes the block away instead.
  const blockBtn = node.querySelector("[data-act=block]");
  const ready = () => {
    const remove = !time.value && Boolean(blockOf(t));
    blockBtn.textContent = remove ? "Remove time" : "Block";
    blockBtn.disabled = !time.value && !remove;
    blockBtn.classList.toggle("primary", Boolean(time.value));
    blockBtn.classList.toggle("danger", remove);
  };
  time.oninput = ready;
  time.onchange = ready;
  ready();
  blockBtn.onclick = () => {
    closeSheet();
    if (!time.value) {
      const b = blockOf(t);
      if (b) { removeBlock(b); toast(`Removed the time for ${t.text}. It stays on ${D.relative(b.startDay)}.`); }
      return;
    }
    const [h, m] = time.value.split(":").map(Number);
    timeBlock(t, date.value || t.date || D.today(), h * 60 + m, Number(len.value));
  };
  node.querySelector("[data-act=event]")?.addEventListener("click", () => { const b = blockOf(t); if (b) openEvent(b.key); });
  node.querySelector("[data-act=tick]").onclick = () => { closeSheet(); tick(t); };
  // Saved straight away, like the date; the sheet stays open.
  node.querySelectorAll(".prio-seg button").forEach(b => b.onclick = async () => {
    const p = Number(b.dataset.p), was = t.priority || 0;
    if (p === was || tk.isLocked(t)) { if (tk.isLocked(t)) toast(T.lockedHelp(t), "err"); return; }
    const mark = (v) => node.querySelectorAll(".prio-seg button").forEach(x => x.setAttribute("aria-pressed", String(Number(x.dataset.p) === v)));
    t.priority = p; mark(p); render();
    try {
      await tk.setPriority(t, p);
      writeSnapshot();
      toast(`${t.text} → ${p ? `${PRIORITY[p].toLowerCase()} priority` : "no priority"}`, "ok");
    } catch (err) {
      console.error("Changing the priority failed:", err);
      t.priority = was; mark(was); render();
      toast(`Couldn’t change the priority: ${err.message}`, "err");
    }
  });
  openSheet("task", node);
}

// ─── Settings ────────────────────────────────────────────────────────
function openSettings() {
  const redirect = location.origin + location.pathname;
  const connected = google.isConnected();
  const node = html(`<div>
    <div class="sh-head"><h2>settings<span class="dot-accent">.</span></h2><button class="x-btn" data-close aria-label="Close">${I.x}</button></div>
    <section class="set-sec"><h3>Google Calendar</h3>
      <div class="f-group">
        <div class="f-line"><label>Client ID</label><input type="text" name="clientId" placeholder="….apps.googleusercontent.com" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <div class="f-line"><span class="grow f-note" id="g-status" style="flex:1"></span><button class="btn ${connected ? "" : "primary"}" data-act="google">${connected ? "Disconnect" : "Connect"}</button></div>
      </div>
      <details><summary>How to get a client ID</summary><ol>
        <li>Open the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> and pick or create a project.</li>
        <li>APIs &amp; Services → Library → turn on <b>Google Calendar API</b>.</li>
        <li>OAuth consent screen → External, add your email as a test user, then <b>Publish app</b>. Left in testing, Google makes you sign in again every week.</li>
        <li>Credentials → Create credentials → OAuth client ID → <b>Web application</b>.</li>
        <li>Authorised JavaScript origin: <code>${esc(location.origin)}</code><br>Authorised redirect URIs: <code>${esc(redirect)}</code> and, for signing in from the lifeOS picker, <code>${esc(location.origin + "/lifeos/")}</code></li>
        <li>Paste the client ID above and tap Connect. Google will warn the app is unverified; that’s expected for your own app.</li>
      </ol></details>
    </section>
    <section class="set-sec" id="cal-sec"><h3>Calendars</h3><div class="f-group" id="cal-list"></div>
      <div class="f-group" style="margin-top:8px"><div class="f-line"><label>New events</label><select name="defaultCal"></select></div></div>
    </section>
    <section class="set-sec"><h3>Task lists</h3><div class="f-group" id="space-list"></div></section>
    <section class="set-sec"><h3>Task connections</h3><div id="conn-list"></div>
      <p class="f-note" style="margin:6px 2px 0">The same connections <a href="${T.TASKS_APP}" data-hub="tasks">tasks.</a> uses: change them here or there. In Craft, open <b>Imagine</b> and create an “All Documents” API connection for each space. For Todoist: Settings → Integrations → Developer → API token.</p>
    </section>
    <section class="set-sec"><h3>Appearance</h3>
      <div class="f-group"><div class="f-line"><label>Theme</label><select name="theme">
        <option value="auto">Match system</option><option value="light">Light</option><option value="dark">Dark</option>
      </select></div></div>
    </section>
    <div class="sh-foot"><button class="btn" data-act="refresh">Refresh</button><span class="spacer"></span><button class="btn primary" data-close>Done</button></div>
  </div>`);

  const id = node.querySelector("[name=clientId]");
  id.value = settings.clientId;
  id.onchange = () => { settings.clientId = id.value.trim(); saveSettings(); renderBanner(); };
  const status = node.querySelector("#g-status");
  status.textContent = DEMO ? "Demo mode: Google isn’t used." : connected ? `Connected${google.auth().email ? ` as ${google.auth().email}` : ""}` : google.wasConnected() ? "Signed out — tap Connect" : "Not connected";
  node.querySelector("[data-act=google]").onclick = () => {
    if (DEMO) return;
    if (google.isConnected()) {
      google.disconnect();
      S.calendars = [];
      S.events.clear();
      S.loaded = null;
      closeSheet();
      render();
      return;
    }
    settings.clientId = id.value.trim();
    saveSettings();
    if (!settings.clientId.endsWith(".apps.googleusercontent.com")) {
      status.textContent = "That doesn’t look like a client ID. It ends in .apps.googleusercontent.com.";
      status.style.color = "var(--danger)";
      return;
    }
    google.connect(settings.clientId);
  };

  const list = node.querySelector("#cal-list");
  if (!S.calendars.length) list.innerHTML = `<div class="f-line"><span class="f-note">Your calendars appear here once Google is connected.</span></div>`;
  for (const c of S.calendars) {
    const line = html(`<div class="f-line cal-toggle" style="--c:${esc(c.color)}"><span class="sw"></span><span class="nm"></span>${c.writable ? "" : `<span class="st">read-only</span>`}
      <div class="switch"><input type="checkbox" aria-label="Show"><span></span></div></div>`);
    line.querySelector(".nm").textContent = c.name;
    const box = line.querySelector("input");
    box.checked = !settings.hidden.includes(c.id);
    box.onchange = () => {
      settings.hidden = box.checked ? settings.hidden.filter(x => x !== c.id) : [...settings.hidden, c.id];
      saveSettings();
      if (box.checked) reloadEvents(); else { render(); writeSnapshot(); }
    };
    list.append(line);
  }
  const theme = node.querySelector("[name=theme]");
  theme.value = settings.theme;
  theme.onchange = () => { settings.theme = theme.value; saveSettings(); applyTheme(); };

  const def = node.querySelector("[name=defaultCal]");
  for (const c of writableCalendars()) def.append(new Option(c.name, c.id, false, c.id === defaultCalendar()?.id));
  def.onchange = () => { settings.defaultCal = def.value; saveSettings(); };
  node.querySelector("#cal-sec").hidden = !S.calendars.length && !googleReady();

  const spaces = node.querySelector("#space-list");
  for (const s of T.SPACES) {
    // Every space can hold tasks, in lifeOS when nothing else is connected.
    const ok = true;
    const line = html(`<div class="f-line cal-toggle" data-space="${s.id}" style="--c:${spaceColour(s.id)}"><span class="sw" style="border-radius:50%"></span><span class="nm">${esc(s.label)}</span>
      ${ok ? "" : `<span class="st">not set up</span>`}
      <div class="switch"${ok ? "" : " hidden"}><input type="checkbox" aria-label="Show"><span></span></div></div>`);
    const box = line.querySelector("input");
    box.checked = !settings.hiddenSpaces.includes(s.id);
    box.onchange = () => {
      settings.hiddenSpaces = box.checked ? settings.hiddenSpaces.filter(x => x !== s.id) : [...settings.hiddenSpaces, s.id];
      saveSettings();
      render();
      writeSnapshot();
    };
    spaces.append(line);
  }
  node.querySelector("#conn-list").replaceChildren(...T.SPACES.map(connectionBox));
  node.querySelector("[data-act=refresh]").onclick = () => { closeSheet(); refreshAll(); };
  openSheet("settings", node);
}

// One list's connection: Craft's API URL and key, or Todoist's token, with a
// test. A connection that tests well reloads the tasks straight away.
function connectionBox(s) {
  const todo = T.isTodoist(s.id);
  const saved = T.connection(s.id);
  const box = html(`<div class="f-group conn" style="--c:${spaceColour(s.id)}">
    <div class="f-line cal-toggle"><span class="sw" style="border-radius:50%"></span><span class="nm">${esc(s.label)}</span><span class="st">${todo ? "Todoist" : "Craft"}</span></div>
    ${todo
      ? `<div class="f-line"><label>Token</label><input type="password" name="token" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Todoist API token"></div>`
      : `<div class="f-line"><label>API URL</label><input type="url" name="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://connect.craft.do/links/…"></div>
         <div class="f-line"><label>API key</label><input type="password" name="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Only if you turned one on"></div>`}
    <div class="f-line"><span class="grow f-note conn-result" style="flex:1"></span><button type="button" class="btn">Test</button></div>
  </div>`);
  const field = (n) => box.querySelector(`[name=${n}]`);
  if (todo) field("token").value = saved.token || "";
  else { field("url").value = saved.url || ""; field("key").value = saved.key || ""; }
  const store = () => T.saveConnection(s.id, todo ? { token: field("token").value } : { url: field("url").value, key: field("key").value });
  box.querySelectorAll("input").forEach(i => { i.onchange = store; });
  const result = box.querySelector(".conn-result");
  result.textContent = T.isConfigured(s.id) ? "Saved" : "Not connected: kept in lifeOS";
  box.querySelector(".btn").onclick = async () => {
    store();
    if (DEMO) { result.textContent = "Demo mode: nothing is connected."; return; }
    if (!T.isConfigured(s.id)) { result.textContent = todo ? "Paste the token first." : "Paste the API URL first."; result.style.color = "var(--danger)"; return; }
    result.style.color = "";
    result.textContent = "Checking…";
    const { ok, message } = await T.testConnection(s.id);
    result.textContent = message;
    result.style.color = ok ? "var(--success, var(--accent-text))" : "var(--danger)";
    if (!ok) return;
    // Its show/hide switch above can be used straight away.
    const line = document.querySelector(`#space-list [data-space="${s.id}"]`);
    line?.querySelector(".st")?.remove();
    const sw = line?.querySelector(".switch");
    if (sw) sw.hidden = false;
    loadTasks();
  };
  return box;
}

// ─── Changing things ─────────────────────────────────────────────────
function taskError(err, t) {
  if (/scope/i.test(err.message)) return T.lockedHelp(t);
  if (err instanceof TypeError) return "Couldn’t reach Craft or Todoist.";
  return `That didn’t work: ${err.message}`;
}

async function tick(t, el) {
  if (tk.isLocked(t)) { toast(T.lockedHelp(t), "err"); return; }
  el?.classList.add("done");
  const prevDate = t.date, prevDue = t.due;
  // Marks this tick, so an Undo before it leaves the screen stops it leaving.
  const tickedAt = t.tickedAt = Date.now();
  try {
    const res = await tk.completeTask(t);
    const undo = DEMO ? undefined : { label: "Undo", run: () => untick(t, { ...res, prevDate, prevDue }) };
    // A repeating task kept in lifeOS moves to its next date and stays.
    if (res?.next) {
      setTimeout(() => { t.date = res.next; el?.classList.remove("done"); render(); writeSnapshot(); }, el ? 650 : 0);
      toast(`${t.text} → next ${D.relative(res.next)}`, "ok", undo);
      return;
    }
    toast(`Ticked off ${t.text}`, "ok", undo);
    // Leave it ticked for a moment so the change is seen, then drop it.
    setTimeout(() => {
      if (t.tickedAt !== tickedAt) return;
      S.tasks = S.tasks.filter(x => x.id !== t.id); render(); writeSnapshot();
    }, el ? 650 : 0);
  } catch (err) {
    console.error("Ticking off failed:", err);
    el?.classList.remove("done");
    toast(taskError(err, t), "err");
  }
}

// Undo for a tick: the task back where it was, open again.
async function untick(t, info) {
  t.tickedAt = null;
  try {
    await T.undoComplete(t, info);
    t.date = info.prevDate;
    if (info.prevDue) t.due = info.prevDue;
    if (!S.tasks.includes(t)) S.tasks = [...S.tasks.filter(x => x.id !== t.id), t];
    render();
    writeSnapshot();
    toast(`${t.text} is back`, "ok");
  } catch (err) {
    console.error("Undo failed:", err);
    toast(`Couldn’t undo: ${err.message}`, "err");
  }
}

// `quiet` when a time block has already said where it went.
async function moveTask(t, date, { quiet = false } = {}) {
  if (tk.isLocked(t)) { if (!quiet) toast(T.lockedHelp(t), "err"); return; }
  if (t.date === date) return;
  const was = t.date;
  t.date = date;
  render();
  try {
    await tk.rescheduleTask(t, date);
    if (!quiet) toast(`${t.text} → ${D.relative(date)}`);
    writeSnapshot();
  } catch (err) {
    console.error("Rescheduling failed:", err);
    t.date = was;
    render();
    toast(taskError(err, t), "err");
  }
}

// Dropped on a timeline, an event starts at that minute (an all-day event
// becomes an hour long). Dropped on a day, it keeps its time. `minutes`
// sets a new length.
async function moveEvent(e, target, minutes) {
  let start;
  let end;
  let allDay = e.allDay;
  if (target.minute != null) {
    start = D.atMinutes(target.date, target.minute);
    end = new Date(start.getTime() + (minutes ? minutes * 60000 : e.allDay ? 3600000 : e.end - e.start));
    allDay = false;
  } else if (e.allDay) {
    start = D.parse(target.date);
    end = D.parse(D.addDays(target.date, D.diffDays(e.startDay, e.endDay) + 1));
  } else {
    start = new Date(e.start);
    start.setDate(start.getDate() + D.diffDays(e.startDay, target.date));
    end = new Date(start.getTime() + (e.end - e.start));
  }
  if (start.getTime() === e.start.getTime() && end.getTime() === e.end.getTime() && allDay === e.allDay) return;
  const moved = {
    ...e, start, end, allDay,
    startDay: D.iso(start),
    endDay: allDay ? D.addDays(D.iso(end), -1) : D.iso(new Date(end.getTime() - 1)),
  };
  S.events.set(e.key, moved);
  render();
  try {
    const saved = await cal.updateEvent(e, { allDay, start, end }, calendarOf(e.calendarId));
    S.events.delete(e.key);
    S.events.set(saved.key, saved);
    render();
    toast(`${e.title} → ${D.relative(D.iso(start))}${allDay ? "" : ` ${D.time(start)}`}`);
    writeSnapshot();
    followBlock(saved);
  } catch (err) {
    S.events.set(e.key, e);
    render();
    googleError(err, "Couldn’t move it");
  }
}

// A task's date follows its time block to another day.
function followBlock(e) {
  const t = e.taskId && !e.taskDone ? findTask(e.taskId) : null;
  if (t && t.date !== e.startDay) moveTask(t, e.startDay, { quiet: true });
}

// A task given a time: its block moves there, or a new one is made on the
// main calendar. The task's date follows.
async function timeBlock(t, date, minute, minutes = blockMinutes(t)) {
  const block = blockOf(t);
  if (block) { await moveEvent(block, { date, minute }, minutes); return; }
  if (!googleReady()) { toast("Connect Google Calendar to give a task a time.", "err", { label: "Settings", run: openSettings }); return; }
  const c = blockCalendar();
  if (!c) { toast("None of your calendars can be added to.", "err"); return; }
  const start = D.atMinutes(date, minute);
  const end = new Date(start.getTime() + minutes * 60000);
  const was = t.date;
  // Undo puts the date back too, where there was one: neither Craft nor
  // Todoist can clear a date.
  const undo = () => { removeBlock(saved); if (was) moveTask(t, was, { quiet: true }); };
  let saved;
  setBusy(true);
  try {
    saved = await cal.createEvent(c, { title: t.text, allDay: false, start, end, task: t });
    S.events.set(saved.key, saved);
    render();
    toast(`${t.text} → ${D.relative(date)} ${D.time(start)}`, "ok", { label: "Undo", run: undo });
    writeSnapshot();
    followBlock(saved);
  } catch (err) {
    googleError(err, "Couldn’t block out the time");
  } finally {
    setBusy(false);
  }
}

async function removeBlock(e) {
  S.events.delete(e.key);
  render();
  try {
    await cal.deleteEvent(e);
    writeSnapshot();
  } catch (err) {
    S.events.set(e.key, e);
    render();
    googleError(err, "Couldn’t remove the block");
  }
}

// Ticking a block ticks off its task, and marks the block done so it stays
// on the calendar as a record of the time.
async function tickBlock(e) {
  if (blockDone(e)) return;
  const t = findTask(e.taskId);
  if (t && tk.isLocked(t)) { toast(T.lockedHelp(t), "err"); return; }
  S.events.set(e.key, { ...e, taskDone: true });
  render();
  if (t) {
    let res;
    try {
      res = await tk.completeTask(t);
    } catch (err) {
      console.error("Ticking off failed:", err);
      S.events.set(e.key, e);
      render();
      toast(taskError(err, t), "err");
      return;
    }
    if (res?.next) { t.date = res.next; toast(`${t.text} → next ${D.relative(res.next)}`, "ok"); }
    else S.tasks = S.tasks.filter(x => x.id !== t.id);
    render();
    writeSnapshot();
  }
  try {
    const saved = await cal.updateEvent(e, { taskDone: true }, calendarOf(e.calendarId));
    S.events.delete(e.key);
    S.events.set(saved.key, saved);
    render();
  } catch (err) {
    googleError(err, "Ticked off, but the block couldn’t be marked done");
  }
}

// ─── Quick add ───────────────────────────────────────────────────────
// The date reader (200 KB) is only needed once something is typed or said,
// so it loads alongside the page instead of holding it up.
let chrono = null;
const chronoReady = import("https://cdn.jsdelivr.net/npm/chrono-node@2.10.1/+esm").then(m => { chrono = m; });
const qa = $("qa-input");
// Anything typed before it arrived is read again once it has.
chronoReady.then(() => { if (qa.value.trim()) qa.dispatchEvent(new Event("input")); });
let qaParsed = null;

// Events only: tasks are added in tasks.
function parseEntry(text) {
  if (!text.trim() || !chrono) return null;
  return parseEvent(text, chrono, { day: S.day, calendars: writableCalendars() });
}
const entryReady = (p) => Boolean(p?.title);

function draftWhen(p) {
  const day = D.iso(p.start);
  let when = D.relative(day);
  if (p.allDay) {
    const last = D.addDays(D.iso(p.end), -1);
    when += last !== day ? ` – ${D.relative(last)}` : ", all-day";
  } else when += `, ${D.time(p.start)}–${D.time(p.end)}`;
  return when;
}

// Saves the event; true once it's done, else it has said why.
async function addEntry(p) {
  try {
    if (!googleReady()) { toast("Connect Google Calendar first.", "err", { label: "Settings", run: openSettings }); return false; }
    const c = p.calendar || defaultCalendar();
    if (!c) { toast("None of your calendars can be added to.", "err"); return false; }
    const saved = await cal.createEvent(c, { title: p.title, allDay: p.allDay, start: p.start, end: p.end, location: p.location });
    S.events.set(saved.key, saved);
    select(saved.startDay);
    toast(`Added ${saved.title} · ${D.relative(saved.startDay)}`, "ok", { label: "Edit", run: () => openEditor(S.events.get(saved.key)) });
    writeSnapshot();
    return true;
  } catch (err) {
    console.error("Quick add failed:", err);
    googleError(err, "Couldn’t add it");
    return false;
  }
}

function reparseQuick() {
  if (!qa.value.trim()) { S.qaCal = null; S.qaPlace = null; }
  qaParsed = parseEntry(qa.value);
  if (qaParsed) {
    if (S.qaCal) qaParsed.calendar = calendarOf(S.qaCal) || qaParsed.calendar;
    if (S.qaPlace !== null) qaParsed.location = S.qaPlace;
  }
  paintQuick();
}

function paintQuick() {
  const p = qaParsed;
  $("qa-preview").hidden = !p;
  $("qa-add").disabled = !entryReady(p);
  if (!p) return;
  $("qa-desc").innerHTML = `<b>${esc(p.title || "…")}</b> · ${esc(draftWhen(p))}`;
  paintQuickChips(p);
}

// Under an event: where (tap to change it, Maps to open it in Google Maps)
// and which calendar. Both can also be typed: "… at 11 Massey Drive",
// "joint calendar …".
function paintQuickChips(p) {
  const c = p.calendar || defaultCalendar();
  const place = p.location
    ? `<button type="button" class="qa-chip set" data-act="place" title="Change the place">${I.pin}<span>${esc(p.location)}</span></button>
       <a class="qa-chip maps" href="${esc(mapsLink(p.location))}" target="_blank" rel="noopener" title="Open in Google Maps">Maps ${I.ext}</a>`
    : `<button type="button" class="qa-chip" data-act="place">${I.pin}<span>Add place</span></button>`;
  const cal = c
    ? `<label class="qa-chip cal" style="--c:${esc(c.color || "var(--accent)")}"><i></i><span>${esc(c.name)}</span>${I.chev}<select aria-label="Calendar"></select></label>`
    : "";
  $("qa-chips").innerHTML = place + cal;
  const sel = $("qa-chips").querySelector("select");
  if (sel) for (const x of writableCalendars()) sel.append(new Option(x.name, x.id, false, x.id === c.id));
}

// Typing a place in by hand: the chip becomes a box until Enter or a tap away.
function editQuickPlace() {
  const box = html(`<input class="qa-chip qa-place" enterkeyhint="done" autocapitalize="words" placeholder="Place or address" aria-label="Place">`);
  box.value = qaParsed?.location || "";
  $("qa-chips").querySelector("[data-act=place]")?.replaceWith(box);
  $("qa-chips").querySelector(".maps")?.remove();
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    if (keep) S.qaPlace = box.value.trim();
    reparseQuick();
  };
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); qa.focus(); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); qa.focus(); }
  });
  box.addEventListener("blur", () => finish(true));
  box.focus();
}

async function submitQuick() {
  const p = qaParsed;
  if (!entryReady(p)) return;
  $("qa-add").disabled = true;
  if (await addEntry(p)) { qa.value = ""; reparseQuick(); }
  else paintQuick();
}

qa.addEventListener("input", reparseQuick);
$("qa-form").addEventListener("submit", (e) => { e.preventDefault(); submitQuick(); });
$("qa-chips").addEventListener("click", (e) => {
  if (e.target.closest("[data-act=place]")) editQuickPlace();
});
$("qa-chips").addEventListener("change", (e) => {
  if (e.target.tagName !== "SELECT") return;
  S.qaCal = e.target.value;
  reparseQuick();
});

// ─── Loading ─────────────────────────────────────────────────────────
// Events are fetched for the days on screen plus a margin, and more as
// the list scrolls or the calendar moves further out.
function neededRange() {
  const month = D.monthGrid(S.day);
  const mini = D.monthGrid(S.miniMonth);
  const froms = [month[0], mini[0], S.agenda?.from || S.day].sort();
  const tos = [D.addDays(month[41], 1), D.addDays(mini[41], 1), D.addDays(S.agenda?.to || S.day, 1)].sort();
  return { from: froms[0], to: tos[tos.length - 1] };
}

let eventsJob = Promise.resolve();
function ensureEvents() {
  if (!googleReady() || !S.calendars.length) return eventsJob;
  eventsJob = eventsJob.then(fetchMissing).catch(err => googleError(err, "Couldn’t load events"));
  return eventsJob;
}

const visibleCalendars = () => S.calendars.filter(c => !settings.hidden.includes(c.id));

async function fetchRange(from, to) {
  const { events, failed } = await cal.loadEvents(visibleCalendars(), from, to);
  if (failed.length) toast(`Couldn’t load ${failed.join(", ")}`, "err");
  return events;
}

async function fetchMissing() {
  const need = neededRange();
  const parts = [];
  if (!S.loaded) parts.push([D.addDays(need.from, -30), D.addDays(need.to, 60)]);
  else {
    if (need.from < S.loaded.from) parts.push([D.addDays(need.from, -30), S.loaded.from]);
    if (need.to > S.loaded.to) parts.push([S.loaded.to, D.addDays(need.to, 60)]);
  }
  if (!parts.length) return;
  setBusy(true);
  try {
    for (const [from, to] of parts) {
      for (const e of await fetchRange(from, to)) S.events.set(e.key, e);
      S.loaded = S.loaded ? { from: from < S.loaded.from ? from : S.loaded.from, to: to > S.loaded.to ? to : S.loaded.to } : { from, to };
    }
  } finally {
    setBusy(false);
  }
  render();
  writeSnapshot();
}

// A full reload replaces what's held, so deleted events disappear too.
async function reloadEvents() {
  if (!googleReady()) return;
  eventsJob = eventsJob.then(async () => {
    setBusy(true);
    try {
      S.calendars = await cal.loadCalendars();
      const need = neededRange();
      const from = S.loaded && S.loaded.from < need.from ? S.loaded.from : D.addDays(need.from, -30);
      const to = S.loaded && S.loaded.to > need.to ? S.loaded.to : D.addDays(need.to, 60);
      const fresh = await fetchRange(from, to);
      S.events = new Map(fresh.map(e => [e.key, e]));
      S.loaded = { from, to };
    } finally {
      setBusy(false);
    }
    render();
    writeSnapshot();
  }).catch(err => googleError(err, "Couldn’t load your calendars"));
  return eventsJob;
}

async function loadTasks() {
  setBusy(true);
  try {
    const { tasks, failed, loaded } = await tk.loadTasks();
    S.tasks = tasks;
    S.taskSpacesOk = new Set(loaded || []);
    S.tasksLoaded = true;
    if (failed.length) toast(`Couldn’t load tasks from ${failed.join(" and ")}`, "err");
  } catch (err) {
    console.error("Loading tasks failed:", err);
    toast("Couldn’t load your tasks.", "err");
  } finally {
    setBusy(false);
  }
  render();
  writeSnapshot();
}

let lastRefresh = 0;
function refreshAll() {
  lastRefresh = Date.now();
  return Promise.all([loadTasks(), reloadEvents()]);
}

// Pull down from the top of the agenda or a day's hours to refresh. Not while
// a sheet is open or something is being dragged.
pullToRefresh({
  refresh: refreshAll,
  scroller: (target) => target.closest?.(".scroller") || null,
  enabled: () => !S.sheet && !document.body.classList.contains("dragging"),
});

// An expired Google token gets one quiet trip through Google for a new one.
function googleError(err, what = "That didn’t work") {
  console.error(what, err);
  if (err.status === 401 && !DEMO) {
    if (settings.clientId && !google.silentTried() && !S.sheet) { google.connect(settings.clientId, { silent: true }); return; }
    render();
    toast("Google needs you to sign in again.", "err", { label: "Sign in", run: () => google.connect(settings.clientId) });
    return;
  }
  toast(err instanceof TypeError ? `${what}: couldn’t reach Google.` : `${what}: ${err.message}`, "err");
}

// ─── lifeOS. ─────────────────────────────────────────────────────────
// The homepage (same site) reads this to show the next event and today's
// task count without loading anything itself.
// Reminders before events (lifeos/shared/reminders.js) follow every change
// made here, a few seconds after the last one.
let remindTimer;
function syncReminders(force = true) {
  if (DEMO || !google.isConnected()) return;
  clearTimeout(remindTimer);
  remindTimer = setTimeout(() => reminders.syncFromGoogle(google.auth().token, { force })
    .catch(err => console.error("Reminders:", err)), 4000);
}

function writeSnapshot() {
  if (DEMO) return;
  syncReminders(S.loaded != null);
  let snap = {};
  try { snap = JSON.parse(localStorage.getItem("calendar.snapshot") || "{}"); } catch { /* start again */ }
  const today = D.today();
  snap.saved = Date.now();
  snap.day = today;
  if (S.loaded) {
    const now = new Date();
    const until = D.parse(D.addDays(today, 2));
    const hidden = new Set(settings.hidden);
    snap.events = [...S.events.values()]
      .filter(e => !hidden.has(e.calendarId) && e.end > now && e.start < until)
      .sort((a, b) => a.start - b.start)
      .slice(0, 12)
      .map(e => ({ title: e.title, start: e.start.toISOString(), end: e.end.toISOString(), allDay: e.allDay, color: e.color, location: e.location }));
    snap.calendars = visibleCalendars().map(c => ({ id: c.id, color: c.color }));
  }
  if (S.tasksLoaded) {
    snap.tasksToday = S.tasks.filter(t => t.date && t.date <= today && !settings.hiddenSpaces.includes(t.spaceId)).length;
  }
  try { localStorage.setItem("calendar.snapshot", JSON.stringify(snap)); } catch { /* private mode */ }
}

// ─── Moving around ───────────────────────────────────────────────────
function select(day, { scroll = true } = {}) {
  S.day = day;
  S.miniMonth = D.startOfMonth(day);
  ensureAgendaCovers(day);
  render();
  if (scroll) scrollAgendaTo(day);
  ensureEvents();
}

function setView(v) {
  S.view = v;
  settings.view = v;
  saveSettings();
  S.stripMonth = false;
  render();
  if (v === "agenda") scrollAgendaTo(S.day);
}

function step(dir) {
  const v = effectiveView();
  if (v === "month") select(D.addMonths(S.day, dir));
  else if (v === "day") select(D.addDays(S.day, dir));
  else select(D.addDays(S.day, dir * 7));
}

// Following the list as it scrolls: the header and week strip show the
// day at the top, and more days are added at either end.
let scrollFrame = null;
function onAgendaScroll() {
  scrollFrame = null;
  const box = $("agenda");
  if (box.scrollTop < 400) {
    S.agenda.from = D.addDays(S.agenda.from, -30);
    renderAgenda();
    ensureEvents();
  } else if (box.scrollHeight - box.scrollTop - box.clientHeight < 900) {
    S.agenda.to = D.addDays(S.agenda.to, 30);
    renderAgenda();
    ensureEvents();
  }
  if (wide.matches || Date.now() < focusHold) return;
  const top = box.scrollTop + 8;
  const first = [...box.children].find(el => el.offsetTop + el.offsetHeight > top);
  if (first && first.dataset.day !== S.day) {
    S.day = first.dataset.day;
    renderTop();
    renderStrip();
  }
}
$("agenda").addEventListener("scroll", () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(onAgendaScroll); }, { passive: true });

// Swiping sideways on the week strip or the grid moves by a week, day or month.
function swipe(el, onSwipe) {
  let sx = 0;
  let sy = 0;
  el.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (isDragging()) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) onSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });
}
swipe($("strip"), (dir) => select(S.stripMonth ? D.addMonths(S.day, dir) : D.addDays(S.day, dir * 7)));
swipe($("grid"), step);

// ─── Clicks ──────────────────────────────────────────────────────────
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-close]")) { closeSheet(); return; }
  const pick = t.closest("[data-pick]");
  if (pick) {
    // On a desktop month, clicking the day that's already picked opens it.
    if (wide.matches && pick.classList.contains("m-cell") && pick.dataset.pick === S.day) { setView("day"); return; }
    select(pick.dataset.pick);
    if (!wide.matches && S.stripMonth && pick.closest("#strip")) { S.stripMonth = false; render(); scrollAgendaTo(S.day); }
    return;
  }
  const open = t.closest("[data-open]");
  if (open) {
    const [kind, ...rest] = open.dataset.open.split(":");
    // An open task's time block opens the task, which can change its time.
    const ev = kind === "event" ? S.events.get(rest.join(":")) : null;
    if (ev?.taskId && !ev.taskDone && findTask(ev.taskId)) openTask(ev.taskId);
    else if (kind === "event") openEvent(rest.join(":"));
    else openTask(rest.join(":"));
    return;
  }
  const goto = t.closest("[data-goto-day]");
  if (goto) { S.day = goto.dataset.gotoDay; setView("day"); return; }
  const mini = t.closest("[data-mini]");
  if (mini) { S.miniMonth = D.addMonths(S.miniMonth, Number(mini.dataset.mini)); renderMini(); ensureEvents(); return; }
  if (t.closest("#tray-toggle")) { settings.trayOpen = !settings.trayOpen; saveSettings(); renderTray(); return; }
  // An empty spot on the timeline: a new event there, on the half hour.
  if (t.classList.contains("col") && t.dataset.dropTime) {
    const r = t.getBoundingClientRect();
    const minute = Math.floor((((e.clientY - r.top) / r.height) * 1440) / 30) * 30;
    newEventAt(t.dataset.dropDate, minute);
  }
});

$("views").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); });
$("today-btn").addEventListener("click", () => select(D.today()));
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("title").addEventListener("click", () => { if (wide.matches) return; S.stripMonth = !S.stripMonth; renderTop(); renderStrip(); });
$("settings-btn").addEventListener("click", openSettings);
// Fetches the calendars, events and tasks afresh, as pulling down does.
$("refresh-btn").addEventListener("click", async () => {
  const b = $("refresh-btn");
  if (b.classList.contains("spin")) return;
  b.classList.add("spin");
  // Turns for at least half a second, so a quick one is still seen.
  try { await Promise.all([refreshAll(), new Promise(r => setTimeout(r, 500))]); } finally { b.classList.remove("spin"); }
});
function toggleTasks() {
  settings.showTasks = !settings.showTasks;
  saveSettings();
  render();
}
$("tasks-btn").addEventListener("click", toggleTasks);
function toggleSide() {
  if (!wide.matches) return;
  settings.sideOpen = !settings.sideOpen;
  saveSettings();
  render();
}
$("side-btn").addEventListener("click", toggleSide);
$("inbox-btn").addEventListener("click", () => { openSheet("tray"); fillTraySheet(); });
$("sheet-back").addEventListener("click", closeSheet);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.sheet) { closeSheet(); return; }
  if (S.sheet || e.metaKey || e.ctrlKey || e.altKey || e.target.closest("input, textarea, select")) return;
  const keys = {
    ".": () => select(D.today()), t: toggleTasks, d: () => setView("day"), w: () => setView("week"), m: () => setView("month"),
    l: () => setView("agenda"), ArrowLeft: () => step(-1), ArrowRight: () => step(1),
    n: () => qa.focus(), "/": () => qa.focus(), s: toggleSide, r: () => $("refresh-btn").click(),
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
});

// ─── Dragging ────────────────────────────────────────────────────────
initDrag({
  start({ kind, id, el, x, y }) {
    if (kind === "task") {
      const t = findTask(id);
      if (!t) return false;
      if (tk.isLocked(t)) { toast(T.lockedHelp(t), "err"); return false; }
      if (el.closest("#sheet")) $("sheet-layer").classList.add("away");
      return { label: t.text, color: spaceColour(t.spaceId), minutes: blockMinutes(t) };
    }
    const e = S.events.get(id);
    if (!e) return false;
    // Keep the point that was grabbed under the finger in a timeline.
    let grab = 0;
    const col = el.closest("[data-drop-time]");
    if (col) {
      const r = col.getBoundingClientRect();
      grab = ((y - r.top) / r.height) * 1440 - D.minutesInto(col.dataset.dropDate, e.start);
    }
    return { label: e.title, color: colourOf(e), grab, minutes: e.allDay ? 60 : (e.end - e.start) / 60000 };
  },
  describe: (t) => `${D.relative(t.date)}${t.minute != null ? ` · ${String(Math.floor(t.minute / 60)).padStart(2, "0")}:${String(t.minute % 60).padStart(2, "0")}` : ""}`,
  drop({ kind, id }, target) {
    // A task dropped on a time gets a time block; on a day, just the date.
    if (kind === "task") {
      const t = findTask(id);
      if (t && target.minute != null) timeBlock(t, target.date, target.minute);
      else if (t) moveTask(t, target.date);
    }
    else { const e = S.events.get(id); if (e) moveEvent(e, target); }
  },
  end({ dropped }) {
    if (!$("sheet-layer").classList.contains("away")) return;
    if (dropped) closeSheet();
    else $("sheet-layer").classList.remove("away");
  },
});

// ─── Start ───────────────────────────────────────────────────────────
// On a desktop the quick-add bar moves up into the header; on a phone it sits along the bottom.
function placeQuick() {
  const quick = $("quick");
  if (wide.matches) $("top").insertBefore(quick, $("top").querySelector(".acts"));
  else $("grid").before(quick);
}
placeQuick();
wide.addEventListener("change", () => { placeQuick(); render(); scrollAgendaTo(S.day); });

// Keep "now" and "today" right while the page stays open.
let shownDay = D.today();
setInterval(() => {
  if (isDragging() || S.sheet) return;
  if (D.today() !== shownDay) { shownDay = D.today(); select(D.today()); return; }
  render();
}, 5 * 60 * 1000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!DEMO && settings.clientId && google.wasConnected() && !google.isConnected() && !google.silentTried() && !S.sheet) {
    google.connect(settings.clientId, { silent: true });
    return;
  }
  if (D.today() !== shownDay) { shownDay = D.today(); select(D.today()); }
  if (Date.now() - lastRefresh > 5 * 60 * 1000) refreshAll();
});

// Links from the Android widget: ?day=2026-09-30 opens that day and ?add
// goes to the add bar. They're kept in this tab while the page goes to
// Google and back for a new sign-in, then used once.
const INTENT_KEY = "calendar.intent";
function stashIntent() {
  const q = new URLSearchParams(location.search);
  if (!q.has("day") && !q.has("add")) return;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get("day") || "") ? q.get("day") : null;
  try { sessionStorage.setItem(INTENT_KEY, JSON.stringify({ day, add: q.has("add") })); } catch { /* private mode */ }
  q.delete("day");
  q.delete("add");
  history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : "") + location.hash);
}
function takeIntent() {
  try {
    const intent = JSON.parse(sessionStorage.getItem(INTENT_KEY) || "null");
    sessionStorage.removeItem(INTENT_KEY);
    return intent || {};
  } catch { return {}; }
}

async function start() {
  stashIntent();
  const back = DEMO ? null : google.takeRedirect();
  if (back?.error) {
    const quiet = ["interaction_required", "login_required", "consent_required"].includes(back.error);
    if (!quiet) toast(back.error === "access_denied" ? "Google access wasn’t given." : `Google sign-in didn’t work (${back.error}).`, "err");
  } else if (!DEMO && !back && settings.clientId && google.wasConnected() && !google.isConnected() && !google.silentTried()) {
    // Signed in before and the hour is up: fetch a new token before anything else.
    google.connect(settings.clientId, { silent: true });
    return;
  }
  const intent = takeIntent();
  if (intent.day) select(intent.day);
  else { render(); scrollAgendaTo(S.day); }
  if (intent.add) qa.focus();
  lastRefresh = Date.now();
  await Promise.all([
    loadTasks(),
    googleReady() ? reloadEvents() : null,
  ]);
  if (back?.ok) toast("Google Calendar connected");
}
start();

// calendar. and tasks. link to each other. Inside the lifeOS picker the
// picker switches tabs; opened on its own, the link is simply followed.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-hub]");
  if (!a) return;
  try {
    if (window.top !== window && window.top.lifeosOpen?.(a.dataset.hub)) e.preventDefault();
  } catch { /* another site's frame: follow the link */ }
});
