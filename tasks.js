// ─── Tasks from Craft, Todoist and lifeOS ────────────────────────────
//
// A space with no Craft or Todoist connection keeps its tasks in lifeOS
// itself (lifeos/shared/hubtasks.js), and those always show.
//
// The connections are the ones tasks. saves, under "tasks.settings". Both apps
// live on the same site, so in a browser (and inside lifeOS) they share it and
// nothing has to be pasted twice. A home-screen app on iPhone has storage of
// its own, so they can be set up and tested here too; saving here writes the
// same settings tasks. reads.

import * as todoist from "/lifeos/shared/todoist.js?v=27";
import { SPACES } from "/lifeos/shared/parse.js?v=27";
import * as hub from "/lifeos/shared/hubtasks.js?v=27";

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

// { url, key } for a Craft space, { token } for Todoist.
export const connection = (id) => (isTodoist(id) ? settings().todoist : settings().spaces?.[id]) || {};

// Saved the way tasks. saves them, keeping everything else it stores. The Craft
// space ID tasks. remembers is kept only while the URL is unchanged.
export function saveConnection(id, value) {
  const s = settings();
  if (isTodoist(id)) {
    s.todoist = { token: String(value.token || "").trim() };
    todoist.setToken(s.todoist.token);
  } else {
    const prev = s.spaces?.[id] || {};
    const next = { url: String(value.url || "").trim(), key: String(value.key || "").trim() };
    if (prev.spaceUuid && prev.url === next.url) next.spaceUuid = prev.spaceUuid;
    s.spaces = { ...(s.spaces || {}), [id]: next };
  }
  try { localStorage.setItem("tasks.settings", JSON.stringify(s)); } catch { /* private mode */ }
}

// { ok, message } for the settings sheet. Craft has three kinds of connection
// and only two can manage tasks; a "Daily Notes and Tasks" one has no
// /documents, and can only change tasks in the inbox and daily notes.
export async function testConnection(id) {
  if (isTodoist(id)) {
    try {
      const list = await todoist.loadProjects();
      projects = list;
      return { ok: true, message: `Connected · ${list.length} project${list.length === 1 ? "" : "s"}` };
    } catch (err) {
      return { ok: false, message: err instanceof TypeError ? "Couldn’t reach Todoist." : err.message };
    }
  }
  try {
    const list = await craft(id, "/tasks?scope=inbox");
    const docs = await craft(id, "/documents?limit=1").then(() => true, (err) => err.status !== 404);
    const n = (list.items || []).length;
    return { ok: true, message: docs ? `Connected · ${n} in the inbox` : "Connected, but only tasks in the inbox and daily notes can be changed. An “All Documents” connection can change the rest." };
  } catch (err) {
    if (err instanceof TypeError) return { ok: false, message: "Couldn’t reach Craft. Check the URL." };
    if (err.status === 401 || err.status === 403) return { ok: false, message: "Craft needs the API key for this connection, or the key is wrong." };
    if (err.status === 404) return { ok: false, message: "Craft doesn’t recognise this URL, or it’s a “Selected Documents” connection, which can’t see tasks." };
    return { ok: false, message: err.message };
  }
}
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
// Craft's dated lists and its inbox leave out a task in a document with no
// date, so those come from the whole-space list ("all"), which also holds
// done tasks and anything in the trash or a template; those are dropped.
// A connection that can't see documents has no such list, which is fine.
async function undatedDocTasks(spaceId) {
  try {
    const [all, trash, templates] = await Promise.all([
      craft(spaceId, "/tasks?scope=all"),
      craft(spaceId, "/documents?location=trash"),
      craft(spaceId, "/documents?location=templates"),
    ]);
    const skip = new Set([...(trash.items || []), ...(templates.items || [])].map(d => d.id));
    return (all.items || []).filter(i => i.taskInfo?.state === "todo" && i.location?.type === "document" && !skip.has(i.location.documentId));
  } catch (err) {
    if (err.status !== 404) console.error(`Loading undated ${spaceLabel(spaceId)} tasks failed:`, err);
    return [];
  }
}

export async function loadTasks() {
  todoist.setToken(settings().todoist?.token);
  const found = new Map();
  const failed = [];
  const loaded = [];
  let hubOk = false;
  // Craft has no priority, so lifeOS keeps a light for each Craft task given one.
  let craftLights = new Map();
  const lights = SPACES.some(s => !isTodoist(s.id) && isConfigured(s.id))
    ? hub.loadCraftPriorities().then(m => { craftLights = m; }, err => console.error("Loading Craft priorities failed:", err))
    : null;
  const jobs = SPACES.filter(s => !isTodoist(s.id) && isConfigured(s.id)).map(async (space) => {
    craft(space.id, "/documents?limit=1")
      .then(() => { canEditDocs[space.id] = true; })
      .catch(err => { if (err.status === 404) canEditDocs[space.id] = false; });
    try {
      // Craft counts a task scheduled for later today as upcoming, so all
      // three scopes are needed to see everything.
      const [lists, undated] = await Promise.all([
        Promise.all(["active", "upcoming", "inbox"].map(scope => craft(space.id, `/tasks?scope=${scope}`))),
        undatedDocTasks(space.id),
      ]);
      for (const list of [...lists, { items: undated }]) {
        for (const item of list.items || []) {
          if (item.taskInfo?.state !== "todo") continue;
          found.set(item.id, {
            id: item.id,
            text: (item.markdown || "").replace(/^\s*[-*]\s*\[[ x]\]\s*/, "").trim() || "(no text)",
            date: item.taskInfo?.scheduleDate?.slice(0, 10) || null,
            // The task list puts repeat beside taskInfo, not in it as edits do.
            recurring: Boolean(item.repeat || item.taskInfo?.repeat),
            priority: 0,
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
  jobs.push(hub.loadTasks().then(list => {
    for (const t of list) found.set(t.id, t);
    hubOk = true;
  }, err => {
    console.error("Loading lifeOS tasks failed:", err);
    failed.push("lifeOS");
  }));
  await Promise.all([...jobs, lights]);
  for (const t of found.values()) {
    if (!t.builtin && !isTodoist(t.spaceId)) t.priority = craftLights.get(hub.craftKey(t.spaceId, t.id)) || 0;
  }
  // A space has loaded in full when lifeOS and its connection (if any) both did.
  const whole = hubOk ? SPACES.map(s => s.id).filter(id => !isConfigured(id) || loaded.includes(id)) : [];
  return { tasks: [...found.values()], failed, loaded: whole };
}

// Ticking off or moving a task in a document needs an "All Documents" connection.
export const isLocked = (task) => !isTodoist(task.spaceId) && task.where.inDoc && canEditDocs[task.spaceId] === false;
export const lockedHelp = (task) =>
  `That task is inside a document, and the ${spaceLabel(task.spaceId)} connection can only change tasks in the inbox and daily notes. Create an “All Documents” connection in Craft and paste it into tasks.`;

// Resolves { next } for a repeating task kept in lifeOS, which moves to its
// next date instead of closing.
export async function completeTask(task) {
  if (task.builtin) return hub.completeTask(task);
  if (isTodoist(task.spaceId)) return todoist.closeTask(task.id);
  return craft(task.spaceId, "/tasks", {
    method: "PUT",
    body: JSON.stringify({ tasksToUpdate: [{ id: task.id, taskInfo: { state: "done" } }] }),
  });
}

// Undo for completeTask: open again, or a repeating task back to its date.
export async function undoComplete(task, { prevDate, prevDue, next, logId }) {
  if (task.builtin) return hub.undoComplete(task, { prevDate, next, logId });
  if (isTodoist(task.spaceId)) {
    // A repeating Todoist task moved on when closed; its date goes back instead.
    return task.recurring && prevDue ? todoist.rescheduleTask({ ...task, due: prevDue }, prevDate) : todoist.reopenTask(task.id);
  }
  return craft(task.spaceId, "/tasks", {
    method: "PUT",
    body: JSON.stringify({ tasksToUpdate: [{ id: task.id, taskInfo: { state: "todo" } }] }),
  });
}

// Craft and Todoist both take a plain YYYY-MM-DD. Neither offers a documented
// way to clear a date, so this only ever sets one.
export async function rescheduleTask(task, date) {
  if (task.builtin) return hub.rescheduleTask(task.id, date);
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
// The traffic light: 3 high, 2 medium, 1 low, 0 none. Todoist keeps its own
// (p1–p3); a Craft task's is kept in lifeOS.
export async function setPriority(task, priority) {
  if (task.builtin) return hub.setPriority(task.id, priority);
  if (isTodoist(task.spaceId)) return todoist.setPriority(task.id, priority);
  return hub.setCraftPriority(task.spaceId, task.id, priority);
}

export async function addTask({ text, space, date, priority = 0, repeat = null }) {
  if (hub.sourceOf(settings(), space) === "lifeos") {
    const [made] = await hub.addTasks([{ text, date, spaceId: space, priority, repeat }]);
    return { id: made?.id || null, text };
  }
  if (isTodoist(space)) {
    if (!projects.length) projects = await todoist.loadProjects();
    const { project, text: rest } = todoist.pickProject(text, projects);
    const made = await todoist.addTask({ text: rest, date, projectId: project?.id, priority, repeatText: repeat?.text });
    return { id: made?.id ? String(made.id) : null, text: rest };
  }
  const made = await craft(space, "/tasks", {
    method: "POST",
    body: JSON.stringify({
      tasks: [{ markdown: text, location: { type: "inbox" }, ...(date ? { taskInfo: { scheduleDate: date } } : {}) }],
    }),
  });
  const items = made?.items || made?.tasks || (Array.isArray(made) ? made : []);
  const id = items.length === 1 && items[0]?.id ? String(items[0].id) : null;
  if (priority && id) await hub.setCraftPriority(space, id, priority).catch(err => console.error("Saving the priority failed:", err));
  return { id, text };
}
