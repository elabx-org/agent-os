/**
 * Background send (M10, N-BgSend): hold Send (or ⌘Enter) for "Send and
 * start a new session": the message goes to the current session through
 * the normal send (the server queue, so it waits if that one is busy), then
 * a fresh, empty session opens in the same project with the same agent,
 * model and permission mode. A fresh session left without a message is
 * removed when the user moves away from it.
 *
 * Pure helpers, safe on the client and in unit tests. No server change.
 */
import type { CreateSessionInput } from "@/data/sessions";
import type { Session } from "@/lib/db";

/** What the send menu (and its keys) can do with the typed message */
export type SendChoice = "send" | "sendAndNew" | "queue";

export interface SendMenuItem {
  choice: SendChoice;
  /** "Send", "Send and start a new session", "Send to queue" */
  label: string;
  /** "Keeps this one running", "After the current turn" */
  caption: string | null;
  /** The key shown at the end of the row: "Enter", "⌘ Enter", "Ctrl Enter" */
  hint: string | null;
}

/**
 * The menu's rows in mock order. "Send to queue" only while the server
 * queue is on for the session (`queueOn`); `mac` picks ⌘ over Ctrl
 */
export function sendMenuItems(_opts: {
  queueOn: boolean;
  mac: boolean;
}): SendMenuItem[] {
  return [];
}

/** The parts of a key event the composer's Return handling reads */
export interface SendKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

/**
 * Return → "send"; ⌘Return (Ctrl+Return off a Mac) → "sendAndNew";
 * Shift+Return (a new line), Alt, IME composition or any other key → null
 */
export function sendChoiceForKey(
  _e: SendKey,
  _mac: boolean
): SendChoice | null {
  return null;
}

/**
 * The POST /api/sessions body for the fresh session: same project, folder,
 * agent, model and permission mode as `from`; no prompt, no new branch or
 * worktree. `projectDir`: the project's own folder, used when `from` runs
 * in an Agent-OS worktree (the fresh one starts in the project, not in
 * another session's worktree)
 */
export function freshSessionInput(
  _from: Session,
  _projectDir?: string | null
): CreateSessionInput {
  throw new Error("Not implemented");
}

/** The toast's title: "Sent to Deck state line fix" */
export function sentToastTitle(_name: string): string {
  return "";
}

/**
 * Asks the page (app/page.tsx) to show a session in the focused pane, as
 * a click in the list does: detail `OpenSessionDetail`
 */
export const OPEN_SESSION_EVENT = "agentos-open-session";

export interface OpenSessionDetail {
  session: Session;
}

/** Dispatches OPEN_SESSION_EVENT */
export function requestOpenSession(session: Session): void {
  window.dispatchEvent(
    new CustomEvent<OpenSessionDetail>(OPEN_SESSION_EVENT, {
      detail: { session },
    })
  );
}

/** What is known about a fresh session when the user leaves it */
export interface FreshUse {
  /** Something was sent from the composer in it (stores/bgSend.ts) */
  sent: boolean;
  /** The agent has a transcript with anything in it (typed in its terminal) */
  hasTranscript: boolean;
  /** Its server queue holds pending or sent items */
  queued: boolean;
}

/** Removed on leaving only when nothing at all happened in it */
export function isUntouched(_use: FreshUse): boolean {
  return false;
}
