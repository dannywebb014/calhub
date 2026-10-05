// ─── Tasks from Craft and Todoist ────────────────────────────────────
//
// The connections are the ones tasks. saves. Both apps live on the same site,
// so they share this browser's storage and nothing has to be pasted twice.
// Setting them up (and testing them) stays in tasks.

import * as todoist from "./todoist.js";
import { SPACES } from "./parse.js";

export { SPACES };
export const TASKS_APP = "../taskhub/";

const settings = () => {
  try { return JSON.parse(localStorage.getItem("tasks.settings") || "{}"); } catch { return {}; }
};
todoist.setToken(settings().todoist?.token);
export const isTodoist = (id) => id === "todoist";
export const isConfigured = (id) => {
  const s = settings();
  return isTodoist(id) ? Boolean(s.todoist?.token) : Boolean(s.spaces?.[id]?.url);
};
export const defaultSpace = () => settings().defaultSpace || SPACES[0].id;
export const spaceLabel = (id) => SPACES.find(s => s.id === id)?.label || id;

// Only the link ID matters, so anything around it in a paste is ignored.
function apiBase(url) {
  const u = String(url || "").trim();
  const m = u.match(/^(?:https?:\/\/)?(connect\.craft\.do\/links\/[^/?#\s]+)/i);
  return m ? `https://${m[1]}/api/v1` : u.replace(/\/+$/, "");
}

async function craft(spaceId, path, options = {}) {
  const { url, key } = settings().spaces?.[spaceId] || {};
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const cleanKey = String(key || "").replace(/[\s ​-‍﻿]/g, "");
  if (cleanKey) headers.Authorization = `Bearer ${cleanKey}`;
  const resp = await fetch(apiBase(url) + path, { ...options, headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    let detail = body;
    try { detail = JSON.parse(body).error || JSON.parse(body).message || body; } catch { /* not JSON */ }
    const err = new Error(`${resp.status}${detail ? ` — ${String(detail).slice(0, 140)}` : ""}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

const placeOf = (location) =>
  location?.type === "document" ? { label: location.title || "Untitled", inDoc: true }
    : location?.type === "dailyNote" ? { label: "Daily note", inDoc: false }
      : { label: "Inbox", inDoc: false };

// A "Daily Notes and Tasks" connection can read every task but only change
// the ones in the inbox and daily notes. It has no /documents endpoint, which
// is how the two kinds are told apart.
const canEditDocs = {};
let projects = [];

// Every open task: dated ones for the calendar, undated ones for the inbox tray.
// `loaded` lists the spaces that came back whole, so a task missing from one
// of them is known to be done (or gone), not just unreachable.
export async function loadTasks() {
  todoist.setToken(settings().todoist?.token);
  const found = new Map();
  const failed = [];
  const loaded = [];
  const jobs = SPACES.filter(s => !isTodoist(s.id) && isConfigured(s.id)).map(async (space) => {
    craft(space.id, "/documents?limit=1")
      .then(() => { canEditDocs[space.id] = true; })
      .catch(err => { if (err.status === 404) canEditDocs[space.id] = false; });
    try {
      // Craft counts a task scheduled for later today as upcoming, so all
      // three scopes are needed to see everything.
      const lists = await Promise.all(["active", "upcoming", "inbox"].map(scope => craft(space.id, `/tasks?scope=${scope}`)));
      for (const list of lists) {
        for (const item of list.items || []) {
          if (item.taskInfo?.state !== "todo") continue;
          found.set(item.id, {
            id: item.id,
            text: (item.markdown || "").replace(/^\s*[-*]\s*\[[ x]\]\s*/, "").trim() || "(no text)",
            date: item.taskInfo?.scheduleDate?.slice(0, 10) || null,
            recurring: Boolean(item.taskInfo?.repeat),
            spaceId: space.id,
            where: placeOf(item.location),
          });
        }
      }
      loaded.push(space.id);
    } catch (err) {
      console.error(`Loading ${spaceLabel(space.id)} tasks failed:`, err);
      failed.push(spaceLabel(space.id));
    }
  });
  if (isConfigured("todoist")) {
    jobs.push((async () => {
      try {
        projects = await todoist.loadProjects();
        for (const t of await todoist.loadTasks(projects)) {
          found.set(t.id, { ...t, where: { label: t.where.label, inDoc: false } });
        }
        loaded.push("todoist");
      } catch (err) {
        console.error("Loading Todoist tasks failed:", err);
        failed.push(spaceLabel("todoist"));
      }
    })());
  }
  await Promise.all(jobs);
  return { tasks: [...found.values()], failed, loaded };
}

// Ticking off or moving a task in a document needs an "All Documents" connection.
export const isLocked = (task) => !isTodoist(task.spaceId) && task.where.inDoc && canEditDocs[task.spaceId] === false;
export const lockedHelp = (task) =>
  `That task is inside a document, and the ${spaceLabel(task.spaceId)} connection can only change tasks in the inbox and daily notes. Create an “All Documents” connection in Craft and paste it into tasks.`;

export async function completeTask(task) {
  if (isTodoist(task.spaceId)) return todoist.closeTask(task.id);
  return craft(task.spaceId, "/tasks", {
    method: "PUT",
    body: JSON.stringify({ tasksToUpdate: [{ id: task.id, taskInfo: { state: "done" } }] }),
  });
}

// Craft and Todoist both take a plain YYYY-MM-DD. Neither offers a documented
// way to clear a date, so this only ever sets one.
export async function rescheduleTask(task, date) {
  if (isTodoist(task.spaceId)) return todoist.rescheduleTask(task, date);
  return craft(task.spaceId, "/tasks", {
    method: "PUT",
    body: JSON.stringify({ tasksToUpdate: [{ id: task.id, taskInfo: { scheduleDate: date } }] }),
  });
}

// New tasks go to the space's inbox, or for Todoist to the project named
// first ("joint house fix the gate"), else the shared list. Returns the new
// task's { id, text } where the API hands an ID back, so a time block can be
// tied to it. Craft doesn't document its reply, so its ID may be missing.
export async function addTask({ text, space, date }) {
  if (isTodoist(space)) {
    if (!projects.length) projects = await todoist.loadProjects();
    const { project, text: rest } = todoist.pickProject(text, projects);
    const made = await todoist.addTask({ text: rest, date, projectId: project?.id });
    return { id: made?.id ? String(made.id) : null, text: rest };
  }
  const made = await craft(space, "/tasks", {
    method: "POST",
    body: JSON.stringify({
      tasks: [{ markdown: text, location: { type: "inbox" }, ...(date ? { taskInfo: { scheduleDate: date } } : {}) }],
    }),
  });
  const items = made?.items || made?.tasks || (Array.isArray(made) ? made : []);
  return { id: items.length === 1 && items[0]?.id ? String(items[0].id) : null, text };
}
