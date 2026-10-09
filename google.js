// ─── Google Calendar ─────────────────────────────────────────────────
//
// Signs in with a full-page redirect to Google rather than a popup: popups
// are unreliable in a home-screen web app on iPhone, while a redirect always
// comes back to the page. Google hands back an access token that lasts an
// hour; when it runs out the page bounces through Google again with
// prompt=none, which returns straight away with no screen as long as you
// are still signed in to Google in this browser.
//
// The token is kept in this browser under "calendar.google", where lifeOS.
// (same site) can also read it to show the next event.

// Since 2026-10: connecting goes through lifeOS's google-auth function
// (/lifeos/shared/gserver.js), which keeps Google's long-lived refresh token
// on the server and hands out new hour-long tokens, so there's no trip
// through Google each hour. The redirect below is the fallback when the
// server isn't set up, and how anyone connected the old way carries on.
import * as D from "./dates.js?v=34";
import * as gs from "/lifeos/shared/gserver.js?v=1";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar";
const KEY = "calendar.google";
const STATE_KEY = "calendar.oauthState";
const SILENT_KEY = "calendar.silentTried";

const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const auth = () => read(KEY, {});
export const isConnected = () => { const a = auth(); return Boolean(a.server || (a.token && a.expires > Date.now())); };
// A token good for the next call (renewed by the server when it holds one).
export const freshToken = () => gs.freshToken();
// Connected before, so a quiet trip through Google should bring a new token.
export const wasConnected = () => Boolean(auth().email);
export const silentTried = () => { try { return sessionStorage.getItem(SILENT_KEY) === "1"; } catch { return true; } };

// Google refuses to show its sign-in page inside a frame (a bare 403). When
// calendar. is framed by a page on this site, such as the lifeos picker, the
// whole page goes to Google instead and Google returns to that page, which
// hands the reply back to this frame. That page's address must also be an
// authorised redirect URI on the OAuth client.
function sameSiteTop() {
  try {
    return window.top !== window && window.top.location.origin === location.origin ? window.top : null;
  } catch { return null; }
}

export function connect(clientId, { silent = false } = {}) {
  // Asked for: through the server, so it stays connected. Quiet renewals keep the old way.
  if (!silent) { gs.connect().catch((err) => { console.warn("Google through the server didn’t start, so the old way:", err.message); redirect(clientId, { silent }); }); return; }
  redirect(clientId, { silent });
}
function redirect(clientId, { silent = false } = {}) {
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(STATE_KEY, state);
    if (silent) sessionStorage.setItem(SILENT_KEY, "1");
  } catch { /* private mode: the state check below will fail safe */ }
  const page = sameSiteTop() || window;
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    // From inside lifeOS (wherever it is served), back to /lifeos/, the address Google knows.
    redirect_uri: page.location.origin + (page.document.querySelector('meta[name="lifeos-shell"]') ? "/lifeos/" : page.location.pathname),
    response_type: "token",
    scope: SCOPE,
    include_granted_scopes: "true",
    state,
  });
  if (silent) params.set("prompt", "none");
  const email = auth().email;
  if (email) params.set("login_hint", email);
  page.location.assign(`${AUTH}?${params}`);
}

// Called once on load. Returns null when the page wasn't opened by Google,
// else { ok } or { error }.
// Inside lifeOS (/lifeos/embed.js) the reply arrives in lifeOS's address and
// is handed over as `hash`, and lifeOS tidies its own address (tidy: false).
export function takeRedirect(hash = location.hash, { tidy = true } = {}) {
  if (!/(?:^#|&)(?:access_token|error)=/.test(hash)) return null;
  const h = new URLSearchParams(hash.slice(1));
  if (tidy) history.replaceState(null, "", location.pathname + location.search);
  let expected = null;
  try { expected = sessionStorage.getItem(STATE_KEY); sessionStorage.removeItem(STATE_KEY); } catch { /* none */ }
  if (!expected || h.get("state") !== expected) return { error: "state" };
  if (h.get("error")) return { error: h.get("error") };
  const seconds = Number(h.get("expires_in")) || 3600;
  write(KEY, { ...auth(), token: h.get("access_token"), expires: Date.now() + (seconds - 60) * 1000 });
  try { sessionStorage.removeItem(SILENT_KEY); } catch { /* none */ }
  return { ok: true };
}

export function disconnect() {
  if (auth().server) { gs.disconnect(); return; }
  const { token } = auth();
  if (token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
  try { localStorage.removeItem(KEY); } catch { /* none */ }
}

function expire() {
  write(KEY, { ...auth(), token: null, expires: 0 });
}

async function api(path, { method = "GET", body, query } = {}) {
  const token = await gs.freshToken();
  if (!token) {
    const err = new Error("Google sign-in has expired");
    err.status = 401;
    throw err;
  }
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const resp = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 401) {
    expire();
    const err = new Error("Google sign-in has expired");
    err.status = 401;
    throw err;
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    let detail = text;
    try { detail = JSON.parse(text).error.message; } catch { /* not JSON */ }
    const err = new Error(`${resp.status}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`);
    err.status = resp.status;
    throw err;
  }
  return resp.status === 204 ? null : resp.json();
}

// ─── Calendars ───────────────────────────────────────────────────────
let colours = {};

export async function loadCalendars() {
  const [list, palette] = await Promise.all([
    api("/users/me/calendarList", { query: { maxResults: 250 } }),
    api("/colors").catch(() => null),
  ]);
  colours = Object.fromEntries(Object.entries(palette?.event || {}).map(([id, c]) => [id, c.background]));
  const calendars = (list.items || []).map(c => ({
    id: c.id,
    name: c.summaryOverride || c.summary || c.id,
    color: c.backgroundColor || "#6fa8e0",
    primary: Boolean(c.primary),
    writable: c.accessRole === "owner" || c.accessRole === "writer",
    selected: c.selected !== false,
  }));
  // The primary calendar's ID is the account's email, which is kept as the
  // hint for signing in quietly next time.
  const primary = calendars.find(c => c.primary);
  if (primary) write(KEY, { ...auth(), email: primary.id });
  return calendars.sort((a, b) => b.primary - a.primary || b.writable - a.writable || a.name.localeCompare(b.name));
}

// ─── Events ──────────────────────────────────────────────────────────
function normalise(e, cal) {
  const allDay = Boolean(e.start?.date);
  const start = allDay ? D.parse(e.start.date) : new Date(e.start.dateTime);
  let end = allDay ? D.parse(e.end?.date || e.start.date) : new Date(e.end?.dateTime || e.start.dateTime);
  if (end <= start) end = allDay ? D.parse(D.addDays(e.start.date, 1)) : new Date(start.getTime() + 60000);
  const video = e.hangoutLink
    || e.conferenceData?.entryPoints?.find(p => p.entryPointType === "video")?.uri
    || null;
  return {
    key: `${cal.id}|${e.id}`,
    id: e.id,
    calendarId: cal.id,
    title: e.summary || "(No title)",
    allDay,
    start,
    end,
    // First and last day the event touches, both inclusive.
    startDay: allDay ? e.start.date : D.iso(start),
    endDay: allDay ? D.addDays(D.iso(end), -1) : D.iso(new Date(end.getTime() - 1)),
    color: colours[e.colorId] || cal.color,
    location: e.location || "",
    description: e.description || "",
    video,
    attendees: (e.attendees || []).filter(a => !a.resource),
    organizer: e.organizer,
    htmlLink: e.htmlLink,
    recurring: Boolean(e.recurringEventId),
    editable: cal.writable && !e.locked,
    // A time block for a task carries the task's ID, so it can be found
    // again from any device. See "Time blocks" in app.js.
    taskId: e.extendedProperties?.private?.calhubTask || null,
    taskSpace: e.extendedProperties?.private?.calhubSpace || null,
    taskDone: e.extendedProperties?.private?.calhubDone === "1",
  };
}

export async function loadEvents(calendars, from, to) {
  const timeMin = D.parse(from).toISOString();
  const timeMax = D.parse(to).toISOString();
  const failed = [];
  const lists = await Promise.all(calendars.map(async (cal) => {
    try {
      const out = [];
      let pageToken;
      do {
        const page = await api(`/calendars/${encodeURIComponent(cal.id)}/events`, {
          query: { timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: 2500, ...(pageToken ? { pageToken } : {}) },
        });
        out.push(...(page.items || []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return out
        .filter(e => e.status !== "cancelled")
        // An invitation you turned down isn't part of your day.
        .filter(e => !(e.attendees || []).some(a => a.self && a.responseStatus === "declined"))
        .map(e => normalise(e, cal));
    } catch (err) {
      if (err.status === 401) throw err;
      console.error(`Loading ${cal.name} failed:`, err);
      failed.push(cal.name);
      return [];
    }
  }));
  return { events: lists.flat(), failed };
}

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// { title, allDay, start: Date, end: Date, location, description, task, taskDone }
// → Google's shape.
// A PATCH switching between all-day and timed has to clear the other field,
// which is done by sending it as null; a new event leaves it out.
function body(fields, patch = false) {
  const out = {};
  if ("title" in fields) out.summary = fields.title;
  if ("location" in fields) out.location = fields.location;
  if ("description" in fields) out.description = fields.description;
  if ("start" in fields) {
    const when = (d) => fields.allDay
      ? { date: D.iso(d), ...(patch ? { dateTime: null } : {}) }
      : { dateTime: d.toISOString(), timeZone: zone(), ...(patch ? { date: null } : {}) };
    out.start = when(fields.start);
    out.end = when(fields.end);
  }
  // PATCH merges private properties key by key, so marking a block done
  // leaves its task link alone.
  const link = {};
  if (fields.task) Object.assign(link, { calhubTask: fields.task.id, calhubSpace: fields.task.spaceId });
  if ("taskDone" in fields) link.calhubDone = fields.taskDone ? "1" : "0";
  if (Object.keys(link).length) out.extendedProperties = { private: link };
  return out;
}

export async function createEvent(cal, fields) {
  const e = await api(`/calendars/${encodeURIComponent(cal.id)}/events`, { method: "POST", body: body(fields) });
  return normalise(e, cal);
}

// Moving to another calendar is its own call, made before the other changes.
export async function updateEvent(event, fields, cal, toCal) {
  let id = event.id;
  let from = cal;
  if (toCal && toCal.id !== cal.id) {
    const moved = await api(`/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(id)}/move`, {
      method: "POST", query: { destination: toCal.id },
    });
    id = moved.id;
    from = toCal;
  }
  const e = await api(`/calendars/${encodeURIComponent(from.id)}/events/${encodeURIComponent(id)}`, { method: "PATCH", body: body(fields, true) });
  return normalise(e, from);
}

export const deleteEvent = (event) =>
  api(`/calendars/${encodeURIComponent(event.calendarId)}/events/${encodeURIComponent(event.id)}`, { method: "DELETE" });
