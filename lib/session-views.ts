/**
 * The view (terminal or chat) each session was last shown in, on this
 * device, so opening a session brings back the one you used there
 */

const KEY = "agentos-session-views";
const MAX = 200;

export type SessionView = "terminal" | "chat";

function read(): Record<string, SessionView> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function getSessionView(sessionId: string): SessionView | null {
  return read()[sessionId] ?? null;
}

export function setSessionView(sessionId: string, view: SessionView) {
  const views = read();
  if (views[sessionId] === view) return;
  // Newest last; the oldest go once there are too many
  delete views[sessionId];
  views[sessionId] = view;
  const ids = Object.keys(views);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX)))
    delete views[id];
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {}
}
