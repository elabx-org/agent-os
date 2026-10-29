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

/**
 * The view a session opens in on this device: the one last used there,
 * else (flag `chatDefault` on) chat for Claude, whose transcript the chat
 * reads, and the terminal for every other agent. Flag off: the terminal,
 * as before chat came first
 */
export function defaultSessionView({
  remembered,
  chatDefault,
  agentType,
}: {
  remembered: SessionView | null;
  chatDefault: boolean;
  /** Session.agent_type; unset is Claude, as everywhere else */
  agentType: string | null | undefined;
}): SessionView {
  if (remembered) return remembered;
  if (!chatDefault) return "terminal";
  return (agentType || "claude") === "claude" ? "chat" : "terminal";
}

/**
 * The session's header: the desktop's (a card per pane when side by side),
 * half folded's (back, title pill, Chat | Terminal), the open Duo's large
 * title, the closed Duo's title in the page (its column holds back, the
 * views and ⋯), or the classic band: no session, the classic toggle in
 * Settings → iPhone Duo, a plain phone
 */
export type HeaderVariant =
  | "classic"
  | "desktop"
  | "card"
  | "fold"
  | "large"
  | "page";

export function headerVariant({
  hasSession,
  layout,
  native,
  paneCount,
  titleInPage,
  columnShown,
}: {
  hasSession: boolean;
  /** useLayoutMode() */
  layout: string;
  native: boolean;
  paneCount: number;
  /** Settings → iPhone Duo; off is the classic header */
  titleInPage: boolean;
  /** The Duo's column (web or the iOS app's) shows */
  columnShown: boolean;
}): HeaderVariant {
  if (!hasSession) return "classic";
  if (layout === "desktop" && !native)
    return paneCount > 1 ? "card" : "desktop";
  if (!titleInPage || !columnShown) return "classic";
  if (layout === "tabletop") return "fold";
  if (layout === "duo-open") return paneCount === 1 ? "large" : "classic";
  if (layout === "duo-closed") return "page";
  return "classic";
}

/** Headers that say what the session is doing themselves: no strip under them */
export function headerShowsActivity(variant: HeaderVariant): boolean {
  return variant === "page" || variant === "card";
}

/** The view a session opens in here: remembered, else its default */
export function openingView(
  sessionId: string,
  agentType: string | null | undefined,
  chatDefault: boolean
): SessionView {
  return defaultSessionView({
    remembered: getSessionView(sessionId),
    chatDefault,
    agentType,
  });
}
