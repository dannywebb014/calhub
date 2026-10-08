// ─── Demo mode (?demo) ───────────────────────────────────────────────
// Made-up calendars, events and tasks, kept in memory, so the page can be
// tried and tested without Google, Craft or Todoist. Nothing is saved.

import * as D from "./dates.js?v=32";

const CALS = [
  { id: "me", name: "Personal", color: "#4a8fd0", primary: true, writable: true, selected: true },
  { id: "work", name: "Work", color: "#c77d3a", primary: false, writable: true, selected: true },
  { id: "family", name: "Family", color: "#5a9a6a", primary: false, writable: true, selected: true },
  { id: "hol", name: "UK Holidays", color: "#9a7fd0", primary: false, writable: false, selected: true },
];

let n = 0;
const at = (offset, h, m = 0) => { const d = D.parse(D.addDays(D.today(), offset)); d.setHours(h, m, 0, 0); return d; };
function ev(calId, title, start, end, extra = {}) {
  const cal = CALS.find(c => c.id === calId);
  const allDay = extra.allDay || false;
  return {
    key: `${calId}|d${++n}`, id: `d${n}`, calendarId: calId, title, allDay, start, end,
    startDay: D.iso(start), endDay: allDay ? D.addDays(D.iso(end), -1) : D.iso(new Date(end - 1)),
    color: cal.color, location: "", description: "", video: null, attendees: [], organizer: null,
    htmlLink: null, recurring: false, editable: cal.writable, taskId: null, taskSpace: null, taskDone: false, ...extra,
  };
}
// The task link that google.js keeps in an event's private properties.
const link = (f) => ({
  ...(f.task ? { taskId: f.task.id, taskSpace: f.task.spaceId } : {}),
  ...("taskDone" in f ? { taskDone: f.taskDone } : {}),
});
const day = (offset) => D.parse(D.addDays(D.today(), offset));

let events = [];
function seed() {
  events = [];
  for (let w = -6; w <= 10; w++) {
    const mon = D.diffDays(D.today(), D.startOfWeek(D.addDays(D.today(), w * 7)));
    events.push(ev("work", "Team stand-up", at(mon, 9, 30), at(mon, 9, 45), { recurring: true, video: "https://meet.google.com/abc-defg-hij" }));
    events.push(ev("me", "Gym", at(mon + 2, 7), at(mon + 2, 8), { recurring: true, location: "PureGym Leeds" }));
    events.push(ev("family", "Swimming lessons", at(mon + 5, 10), at(mon + 5, 11), { recurring: true }));
  }
  events.push(
    ev("work", "Quarterly review", at(0, 11), at(0, 12, 30), {
      location: "Board room, 3rd floor", video: "https://meet.google.com/xyz-abcd-efg",
      description: "Agenda:\n1. Q3 numbers\n2. Hiring plan\nSlides: https://example.com/q3",
      attendees: [
        { email: "sam@example.com", displayName: "Sam Patel", responseStatus: "accepted", organizer: true },
        { email: "me@example.com", displayName: "You", responseStatus: "accepted", self: true },
        { email: "jo@example.com", displayName: "Jo King", responseStatus: "tentative" },
        { email: "alex@example.com", responseStatus: "needsAction" },
      ],
    }),
    ev("me", "Lunch with Sam", at(0, 13), at(0, 14), { location: "Nando's, Briggate" }),
    ev("work", "1:1 with Jo", at(0, 13, 30), at(0, 14)),
    ev("family", "Parents' evening", at(0, 18), at(0, 19, 30)),
    ev("me", "Dentist", at(1, 8, 45), at(1, 9, 15), { location: "Smile Dental, Headingley" }),
    ev("work", "Client call — Acme", at(1, 15), at(1, 16), { video: "https://zoom.us/j/123456789" }),
    ev("family", "Weekend in York", day(3), day(5), { allDay: true }),
    ev("hol", "Bank holiday", day(10), day(11), { allDay: true }),
    ev("me", "Haircut", at(-1, 17), at(-1, 17, 45)),
    ev("work", "Planning day", day(6), day(7), { allDay: true }),
    ev("me", "Cinema", at(4, 19, 30), at(4, 22)),
    ev("me", "Send Sam the invoice", at(0, 15), at(0, 16), { taskId: "t1", taskSpace: "work" }),
  );
}
seed();

export const calendar = {
  isConnected: () => true,
  loadCalendars: async () => CALS.map(c => ({ ...c })),
  loadEvents: async (_cals, from, to) => ({
    events: events.filter(e => e.endDay >= from && e.startDay < to).map(e => ({ ...e })),
    failed: [],
  }),
  createEvent: async (cal, f) => {
    const e = ev(cal.id, f.title, f.start, f.end, { allDay: f.allDay, location: f.location || "", description: f.description || "", ...link(f) });
    events.push(e);
    return { ...e };
  },
  updateEvent: async (event, f, cal, toCal) => {
    const i = events.findIndex(e => e.key === event.key);
    const merged = { ...events[i], ...f, ...link(f) };
    const target = toCal || cal;
    const e = ev(target.id, merged.title, merged.start, merged.end, {
      allDay: merged.allDay, location: merged.location, description: merged.description,
      video: merged.video, attendees: merged.attendees, recurring: merged.recurring,
      taskId: merged.taskId, taskSpace: merged.taskSpace, taskDone: merged.taskDone,
    });
    events[i] = e;
    return { ...e };
  },
  deleteEvent: async (event) => { events = events.filter(e => e.key !== event.key); },
};

let tasks = [
  { id: "t1", text: "Send Sam the invoice", date: D.today(), spaceId: "work", where: { label: "Inbox" } },
  { id: "t2", text: "Book MOT", date: D.addDays(D.today(), -2), spaceId: "my", where: { label: "Car" , inDoc: true } },
  { id: "t3", text: "Chase the quote", date: D.addDays(D.today(), 1), spaceId: "work", where: { label: "Inbox" } },
  { id: "t4", text: "Bins out", date: D.addDays(D.today(), 2), spaceId: "todoist", where: { label: "House" }, recurring: true },
  { id: "t5", priority: 2, text: "Renew passport", date: null, spaceId: "my", where: { label: "Inbox" } },
  { id: "t6", text: "Plan team offsite", date: null, spaceId: "work", where: { label: "Q4 plans", inDoc: true } },
  { id: "t7", text: "Buy birthday card for Mum", date: null, spaceId: "todoist", where: { label: "Joint Reminders" } },
  { id: "t8", priority: 3, text: "Call the council", date: D.addDays(D.today(), -1), spaceId: "todoist", where: { label: "House" } },
  { id: "t9", priority: 1, text: "Water the plants", date: D.today(), spaceId: "my", where: { label: "Daily note" }, recurring: true },
];

export const taskSource = {
  loadTasks: async () => ({ tasks: tasks.map(t => ({ ...t })), failed: [], loaded: ["my", "work", "todoist"] }),
  completeTask: async (task) => { tasks = tasks.filter(t => t.id !== task.id); },
  rescheduleTask: async (task, date) => { tasks.find(t => t.id === task.id).date = date; },
  setPriority: async (task, priority) => { tasks.find(t => t.id === task.id).priority = priority; },
  addTask: async ({ text, space, date, priority = 0 }) => {
    const id = `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    tasks.push({ id, text, date, priority, spaceId: space, where: { label: "Inbox" } });
    return { id, text };
  },
  isLocked: () => false,
  isConfigured: () => true,
};
