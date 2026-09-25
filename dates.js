// ─── Dates ───────────────────────────────────────────────────────────
// Days are passed around as local "YYYY-MM-DD" strings, the same form
// Craft and Todoist use, so a task's date and a calendar day compare
// directly. Weeks start on Monday.

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parse = (s) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const today = () => iso(new Date());

export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

export const startOfWeek = (s) => {
  const d = parse(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};

export const startOfMonth = (s) => s.slice(0, 8) + "01";

export const addMonths = (s, n) => {
  const d = parse(startOfMonth(s));
  d.setMonth(d.getMonth() + n);
  return iso(d);
};

export const range = (from, count) => Array.from({ length: count }, (_, i) => addDays(from, i));

// The six weeks shown for a month, Monday first.
export const monthGrid = (s) => range(startOfWeek(startOfMonth(s)), 42);

const fmt = (s, opts) => parse(s).toLocaleDateString("en-GB", opts);

export const weekday = (s, style = "long") => fmt(s, { weekday: style });
export const dayMonth = (s) => fmt(s, { day: "numeric", month: "long" });
export const monthYear = (s) => fmt(s, { month: "long", year: "numeric" });
export const monthName = (s, style = "long") => fmt(s, { month: style });

// "Today", "Tomorrow", "Yesterday", else "Fri 26 Sep" (with the year if it
// isn't this one).
export function relative(s) {
  const days = diffDays(today(), s);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (s.slice(0, 4) !== today().slice(0, 4)) opts.year = "numeric";
  return fmt(s, opts);
}

export const time = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Minutes since midnight of the given day, clamped to that day.
export function minutesInto(day, d) {
  const start = parse(day);
  const m = Math.round((d - start) / 60000);
  return Math.max(0, Math.min(24 * 60, m));
}

export const atMinutes = (day, minutes) => {
  const d = parse(day);
  d.setMinutes(minutes);
  return d;
};

// For <input type="time"> and <input type="date">.
export const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
