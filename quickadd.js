// ─── Quick add ───────────────────────────────────────────────────────
//
// One line of plain English becomes an event or a task:
//   "Lunch with Sam Friday 1pm at Nando's"  → event, Fri 13:00–14:00, location
//   "Gym tomorrow 7am for 45 mins /personal" → event on the calendar named
//                                             "Personal…", 45 minutes long
//   "Joint calendar add dinner with friends Friday at 7pm at 11 Massey
//    Drive Worcester"                      → event on the calendar named
//                                             "Joint…", with the address
//   "Work send the invoice tomorrow"        → task in work.
//   "Task buy milk"                         → task in the default space
// Starting with a space name ("work", "my space", "joint") or with "task",
// "todo" or "remind me to" makes a task, parsed exactly as tasks. does,
// unless the word "calendar" follows the name. Anything else is an event.
// The page shows which it picked, and a tap switches it.

import { parseTasks, SPACES } from "/lifeos/shared/parse.js?v=29";
import * as D from "./dates.js?v=29";

const TASK_WORDS = /^(?:task|todo|to-do|to do|remind me to|reminder)\b[\s:,.\-–—]*/i;
const SPACE_LEAD = new RegExp(`^(?:(?:in|for|to|into|on)\\s+)?(?:${SPACES.map(s => s.pattern).join("|")})\\b`, "i");

// A calendar can be named in words: "joint calendar …" at the start, or
// "… on the joint calendar" anywhere. The word "calendar" (or "cal") is
// needed, so "family dinner" stays a title. A calendar called "Joint
// calendar" answers to "joint"; the main one also to "my" / "main".
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ADD = String.raw`(?:add|ad|put)\b\s*`;
function calendarWords(calendars) {
  const words = [];
  for (const c of calendars.filter(x => x.writable)) {
    const name = c.name.toLowerCase().replace(/\s+(?:calendar|cal)$/, "").trim();
    if (name) words.push([name, c]);
    if (c.primary) for (const w of ["my", "main", "primary"]) words.push([w, c]);
  }
  // Longest first, so "work rota" is tried before "work".
  return words.sort((a, b) => b[0].length - a[0].length);
}
function findCalendar(s, calendars) {
  const words = calendarWords(calendars);
  if (!words.length) return null;
  const names = words.map(([w]) => esc(w).replace(/\s+/g, "\\s+")).join("|");
  const which = (m) => words.find(([w]) => w === m.toLowerCase().replace(/\s+/g, " "))?.[1] || null;
  const lead = s.match(new RegExp(String.raw`^\s*(?:${ADD})?(?:(?:to|on|in|into)\s+)?(?:(?:the|my|our)\s+)?(${names})\s+(?:calendar|cal)\b[\s:,.\-–—]*(?:${ADD})?`, "i"));
  if (lead) return { calendar: which(lead[1]), rest: ` ${s.slice(lead[0].length)}` };
  const mid = s.match(new RegExp(String.raw`\s(?:to|on|in|into)\s+(?:(?:the|my|our)\s+)?(${names})\s+(?:calendar|cal)\b`, "i"));
  if (mid) return { calendar: which(mid[1]), rest: `${s.slice(0, mid.index)} ${s.slice(mid.index + mid[0].length)}` };
  return null;
}

export const guessKind = (text, calendars = []) => {
  const t = text.trim();
  if (findCalendar(` ${t}`, calendars)) return "event";
  return TASK_WORDS.test(t) || SPACE_LEAD.test(t) ? "task" : "event";
};

export function parseTask(text, chrono, { defaultSpace }) {
  return parseTasks(text.trim().replace(TASK_WORDS, ""), chrono, { defaultSpace });
}

const tidy = (s) => {
  const t = s.replace(/\s{2,}/g, " ").replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
};

const DURATION = /\bfor\s+(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/i;

// `day` is the day on screen: an event with a time but no date goes there.
export function parseEvent(text, chrono, { now = new Date(), day, calendars = [] }) {
  let s = ` ${text.trim()} `;

  // "/work" picks the calendar whose name starts with "work"; so does
  // "work calendar …" or "… on the work calendar".
  let calendar = null;
  const pick = s.match(/\s\/(\S+)/);
  if (pick) {
    const q = pick[1].toLowerCase();
    calendar = calendars.find(c => c.writable && c.name.toLowerCase().replace(/\s+/g, "").startsWith(q)) || null;
    if (calendar) s = s.replace(pick[0], " ");
  }
  const named = calendar ? null : findCalendar(s, calendars);
  if (named) { calendar = named.calendar; s = named.rest; }
  // "Add dinner Friday …": the "add" is an instruction, not the title.
  s = s.replace(/^\s*add\s+/i, " ");

  let minutes = 60;
  const dur = s.match(DURATION);
  if (dur) {
    const n = Number(dur[1]);
    minutes = Math.max(5, Math.round(/^h/i.test(dur[2]) ? n * 60 : n));
    s = s.replace(dur[0], " ");
  }

  let allDay = /\ball[\s-]?day\b/i.test(s);
  s = s.replace(/\ball[\s-]?day\b/i, " ");

  let start;
  let end;
  // "Weekend in York Saturday": "weekend" is a date to chrono, but here it's
  // the title, so another date wins over it.
  // "at 11 Massey Drive" is a house number, not 11 o'clock.
  const hits = chrono.en.GB.parse(s, now, { forwardDate: true })
    .filter(h => !(/^at\s+\d{1,4}$/i.test(h.text.trim()) && /^\s+[a-z]/i.test(s.slice(h.index + h.text.length))));
  const hit = hits.find(h => !/^(?:the\s+)?weekend$/i.test(h.text.trim())) || hits[0];
  if (hit) {
    const certainDay = hit.start.isCertain("day") || hit.start.isCertain("weekday");
    if (!hit.start.isCertain("hour")) allDay = true;
    start = hit.start.date();
    let hitEnd = hit.end?.date() || null;
    if (!certainDay) {
      // A time on its own ("lunch 1pm") belongs to the day being looked at.
      const shift = D.parse(day) - D.parse(D.iso(start));
      start = new Date(start.getTime() + shift);
      if (hitEnd) hitEnd = new Date(hitEnd.getTime() + shift);
    }
    if (allDay) {
      start = D.parse(D.iso(start));
      end = D.parse(D.addDays(D.iso(hitEnd && hitEnd > start ? hitEnd : start), 1));
    } else {
      end = hitEnd && hitEnd > start && hit.end.isCertain("hour") ? hitEnd : new Date(start.getTime() + minutes * 60000);
    }
    const before = s.slice(0, hit.index).replace(/\b(?:on|at|from|this|for|by)\s*$/i, "");
    s = `${before} ${s.slice(hit.index + hit.text.length)}`;
  } else {
    allDay = true;
    start = D.parse(day);
    end = D.parse(D.addDays(day, 1));
  }

  // "... at Nando's", "... in Leeds", "... @ the office". A capital letter is
  // needed after "at"/"in", so "in the garden" stays part of the title.
  let location = "";
  const loc = s.match(/\s(?:(?:at|in)\s+(?=[A-Z0-9])|@\s*)(.+?)\s*$/);
  if (loc) {
    location = loc[1].trim().replace(/[.,;]+$/, "");
    // An address typed all in small letters is tidied: "11 massey drive" → "11 Massey Drive".
    if (location === location.toLowerCase()) location = location.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    s = s.slice(0, loc.index);
  }

  return { kind: "event", title: tidy(s), start, end, allDay, location, calendar };
}
