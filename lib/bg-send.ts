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
import { normalizeMode } from "@/lib/permission-mode";

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
export function sendMenuItems(opts: {
  queueOn: boolean;
  mac: boolean;
}): SendMenuItem[] {
  const items: SendMenuItem[] = [
    { choice: "send", label: "Send", caption: null, hint: "Enter" },
    {
      choice: "sendAndNew",
      label: "Send and start a new session",
      caption: "Keeps this one running",
      hint: opts.mac ? "⌘ Enter" : "Ctrl Enter",
    },
  ];
  if (opts.queueOn) {
    items.push({
      choice: "queue",
      label: "Send to queue",
      caption: "After the current turn",
      hint: null,
    });
  }
  return items;
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
export function sendChoiceForKey(e: SendKey, mac: boolean): SendChoice | null {
  if (e.key !== "Enter" || e.isComposing || e.shiftKey || e.altKey) {
    return null;
  }
  if (!e.metaKey && !e.ctrlKey) return "send";
  const primary = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  return primary && !other ? "sendAndNew" : null;
}

/**
 * The POST /api/sessions body for the fresh session: same project, folder,
 * agent, model and permission mode as `from`; no prompt, no new branch or
 * worktree. `projectDir`: the project's own folder, used when `from` runs
 * in an Agent-OS worktree (the fresh one starts in the project, not in
 * another session's worktree). `capFullAccess` (the ⌘Return key, not the
 * menu): Full access becomes Auto, so a habitual keystroke never starts
 * another Full-access session
 */
export function freshSessionInput(
  from: Session,
  projectDir?: string | null,
  capFullAccess = false
): CreateSessionInput {
  let mode = normalizeMode(from.permission_mode);
  let autoApprove = mode ? false : !!from.auto_approve;
  if (capFullAccess && (mode === "bypassPermissions" || autoApprove)) {
    mode = "auto";
    autoApprove = false;
  }
  return {
    // No name: the server numbers it ("Session N")
    workingDirectory:
      from.worktree_path && projectDir ? projectDir : from.working_directory,
    projectId: from.project_id,
    agentType: from.agent_type || "claude",
    model: from.model || undefined,
    permissionMode: mode,
    autoApprove,
    useWorktree: false,
    createBranch: false,
    featureName: null,
    baseBranch: null,
    continueSession: false,
    useTmux: true,
    initialPrompt: null,
  };
}

/** The toast's title: "Sent to Deck state line fix" */
export function sentToastTitle(name: string): string {
  return `Sent to ${name}`;
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
  /** Its composer holds unsent text, an image, a video or an attached session */
  draft: boolean;
  /** The user named it (no longer "Session N") */
  named: boolean;
  /** The agent is working or holds messages (its screen's spinner) */
  working: boolean;
}

/** Removed on leaving only when nothing at all happened in it */
export function isUntouched(use: FreshUse): boolean {
  return (
    !use.sent &&
    !use.hasTranscript &&
    !use.queued &&
    !use.draft &&
    !use.named &&
    !use.working
  );
}

/** GET /api/sessions/[id]/transcript's answer, as far as cleanup reads it */
export interface TranscriptAnswer {
  sessionId?: string;
  items?: unknown[];
  notFound?: boolean;
  unsupported?: boolean;
}

/**
 * Whether the transcript has anything in it: true or false only when it
 * was found (an empty conversation is located with no items); "unknown"
 * when it couldn't be read (`notFound` also covers a failed lookup, so it
 * never counts as empty); "unsupported" for Codex and Gemini, whose
 * terminal can't be read
 */
export function transcriptUse(
  answer: TranscriptAnswer
): boolean | "unknown" | "unsupported" {
  if (answer.unsupported) return "unsupported";
  if (answer.notFound || !answer.sessionId) return "unknown";
  return (answer.items?.length ?? 0) > 0;
}
