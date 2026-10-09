// ─── Dragging ────────────────────────────────────────────────────────
//
// Anything with data-drag="kind:id" can be picked up and dropped on anything
// with data-drop-date. A timeline column also has data-drop-time, and a drop
// there carries the minute of the day too, snapped to 15 minutes.
//
// With a mouse a drag starts as soon as the pointer moves. On a touch screen
// it starts after a short press-and-hold, so that an ordinary swipe still
// scrolls. The browser's own drag and drop isn't used: iPhone Safari barely
// supports it.

const HOLD_MS = 320;
const SLOP = 8;
const SNAP = 15;

let pending = null;   // pressed, not yet dragging
let active = null;    // dragging
let swallowClick = false;
let handlers = {};

export const isDragging = () => Boolean(active);

// h.root: where to listen and look things up (the app's shadow root, see
// /lifeos/embed.js; the page by default). h.page: where the ghost goes and
// what gets the "dragging" class (document.body by default).
// Returns a function that stops listening (for the app's unmount).
let where = document;
let page = null;
export function initDrag(h) {
  handlers = h;
  where = h.root || document;
  page = h.page || null;
  const on = [
    ["pointerdown", down],
    ["pointermove", move, { passive: true }],
    ["pointerup", up],
    ["pointercancel", cancel],
    // Once a touch drag has begun, stop the page scrolling under the finger.
    ["touchmove", (e) => { if (active || pending?.armed) e.preventDefault(); }, { passive: false }],
    // The click that follows a drop shouldn't also open whatever was dropped.
    ["click", (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true],
    ["contextmenu", (e) => { if (active || pending?.armed) e.preventDefault(); }],
  ];
  const target = where;
  for (const [type, fn, opts] of on) target.addEventListener(type, fn, opts);
  return () => { for (const [type, fn, opts] of on) target.removeEventListener(type, fn, opts); };
}
const body = () => page || document.body;

function down(e) {
  if (e.button !== 0 || active) return;
  const el = e.target.closest("[data-drag]");
  if (!el || e.target.closest("button:not([data-drag]), input, a, label, select, textarea")) return;
  const touch = e.pointerType !== "mouse";
  pending = { el, x: e.clientX, y: e.clientY, touch, armed: false, timer: null, id: e.pointerId };
  if (touch) {
    pending.timer = setTimeout(() => {
      if (!pending) return;
      pending.armed = true;
      navigator.vibrate?.(10);
      begin(pending.x, pending.y);
    }, HOLD_MS);
  }
}

function move(e) {
  if (active) {
    active.x = e.clientX;
    active.y = e.clientY;
    place();
    return;
  }
  if (!pending) return;
  const far = Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > SLOP;
  if (pending.touch) {
    if (far && !pending.armed) { clearTimeout(pending.timer); pending = null; }  // a scroll, not a hold
    return;
  }
  if (far) begin(e.clientX, e.clientY);
}

function begin(x, y) {
  const el = pending.el;
  const [kind, ...rest] = el.dataset.drag.split(":");
  const info = handlers.start?.({ kind, id: rest.join(":"), el, x, y });
  if (info === false) { pending = null; return; }
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.style.setProperty("--c", info?.color || "var(--accent)");
  ghost.innerHTML = `<small></small><span></span>`;
  ghost.querySelector("span").textContent = info?.label || el.textContent.trim();
  body().append(ghost);
  el.classList.add("dragging-src");
  body().classList.add("dragging");
  active = { kind, id: rest.join(":"), el, ghost, x, y, grab: info?.grab || 0, minutes: info?.minutes || 60, target: null, slot: null };
  pending = null;
  place();
  requestAnimationFrame(autoscroll);
}

function targetAt(x, y) {
  const hit = where.elementFromPoint(x, y);
  const el = hit?.closest("[data-drop-date]");
  if (!el) return null;
  const t = { el, date: el.dataset.dropDate, minute: null };
  if (el.dataset.dropTime) {
    const rect = el.getBoundingClientRect();
    const raw = ((y - rect.top) / rect.height) * 1440 - active.grab;
    t.minute = Math.max(0, Math.min(1440 - SNAP, Math.round(raw / SNAP) * SNAP));
  }
  return t;
}

function place() {
  const { ghost, x, y } = active;
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
  const t = targetAt(x, y);
  if (active.target?.el !== t?.el) {
    active.target?.el.classList.remove("drop-hover");
    t?.el.classList.add("drop-hover");
  }
  active.target = t;
  // In a timeline, an outline shows exactly where it will land.
  if (t?.minute != null) {
    if (!active.slot || active.slot.parentNode !== t.el) {
      active.slot?.remove();
      active.slot = document.createElement("div");
      active.slot.className = "drop-ghost-slot";
      t.el.append(active.slot);
    }
    active.slot.style.top = `${(t.minute / 1440) * 100}%`;
    active.slot.style.height = `${(active.minutes / 1440) * 100}%`;
  } else {
    active.slot?.remove();
    active.slot = null;
  }
  ghost.querySelector("small").textContent = t ? handlers.describe?.(t) || "" : "";
}

// Resting near the top or bottom edge of a scrolling area scrolls it. It
// waits a moment first, so passing over an edge on the way somewhere else
// (the list's top edge, on the way up to the week strip) doesn't.
const EDGE = 56;
const DWELL_MS = 350;
function autoscroll() {
  if (!active) return;
  const hit = where.elementFromPoint(active.x, active.y);
  const box = hit?.closest(".scroller, .band");
  let by = 0;
  if (box) {
    const r = box.getBoundingClientRect();
    if (active.y < r.top + EDGE) by = -Math.ceil((r.top + EDGE - active.y) / 5);
    else if (active.y > r.bottom - EDGE) by = Math.ceil((active.y - (r.bottom - EDGE)) / 5);
  }
  if (!by) active.edgeSince = 0;
  else if (!active.edgeSince) active.edgeSince = performance.now();
  else if (performance.now() - active.edgeSince > DWELL_MS) box.scrollTop += by;
  place();
  requestAnimationFrame(autoscroll);
}

function finish(drop) {
  const a = active;
  active = null;
  a.ghost.remove();
  a.slot?.remove();
  a.el.classList.remove("dragging-src");
  a.target?.el.classList.remove("drop-hover");
  body().classList.remove("dragging");
  if (drop && a.target) handlers.drop?.({ kind: a.kind, id: a.id }, a.target);
  handlers.end?.({ dropped: Boolean(drop && a.target) });
}

function up() {
  if (pending) { clearTimeout(pending.timer); pending = null; }
  if (!active) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 50);
  finish(true);
}

function cancel() {
  if (pending) { clearTimeout(pending.timer); pending = null; }
  if (active) finish(false);
}
