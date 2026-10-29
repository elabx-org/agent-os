/**
 * The "Move to a worktree" sheet in words (N-Worktree): who may open it,
 * the uncommitted count, the per-agent notes, the footnote, what the
 * button does in each state, and Now's subline for a session being moved.
 * Pure, so it is unit tested.
 */

import { agentName } from "@/components/a/Avatar";
import { refusalText } from "@/lib/client/user-fetch";
import type { Session } from "@/lib/db";
import { isPaused } from "@/lib/handoff-types";
import type {
  MoveError,
  MovePreview,
  MoveState,
  OtherSession,
} from "@/lib/worktree-move-types";

/**
 * Whether the header ⋯ and the Project page offer the move. Not for paused
 * (handed-off) or shell sessions, sessions already in a worktree (an
 * Agent-OS one, or Claude's own `--worktree`), or folders outside git.
 * `isGit` is null while unknown: hidden until it is known.
 */
export function canOfferMove(
  session: Pick<
    Session,
    | "agent_type"
    | "worktree_path"
    | "branch_name"
    | "working_directory"
    | "paused_at"
  >,
  options: { nativeWorktreeFlag: boolean; isGit: boolean | null }
): boolean {
  if (!session.working_directory) return false;
  if ((session.agent_type || "claude") === "shell") return false;
  if (isPaused(session as Session)) return false;
  if (session.worktree_path) return false;
  // Launched with the agent's own --worktree (lib/session-launch.ts)
  if (session.branch_name && options.nativeWorktreeFlag) return false;
  return options.isGit === true;
}

/** "3 uncommitted files", "1 uncommitted file"; null when clean */
export function uncommittedLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} uncommitted ${count === 1 ? "file" : "files"}`;
}

/** One line of the notes card: the agent's tile and what happens to it */
export interface MoveNote {
  agentType: string;
  text: string;
}

function noteFor(agentType: string): MoveNote {
  return {
    agentType,
    text:
      agentType === "claude"
        ? "Claude keeps its whole conversation and continues in the new folder."
        : `${agentName(agentType)} starts fresh in the worktree with a summary.`,
  };
}

/**
 * The notes card: this session's agent first, then the other way a move
 * goes (Codex's handoff under Claude, Claude's resume under the others)
 */
export function moveNotes(agentType: string | null | undefined): MoveNote[] {
  const own = agentType || "claude";
  return [noteFor(own), noteFor(own === "claude" ? "codex" : "claude")];
}

/** A run of the footnote, mono for branch names */
export interface TextPart {
  text: string;
  mono?: boolean;
}

/** "Ana", "Ana and Bo", "Ana, Bo and 2 more" */
export function sessionNames(sessions: OtherSession[]): string {
  const names = sessions.map((s) => s.name || "another session");
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

const KEEPS = " The session keeps its tmux window and its place in Now.";

/**
 * The footnote under the notes. Only claims the checkout gets cleaned when
 * the changes are taken and no other session works in that folder
 */
export function moveFootnote(input: {
  currentBranch: string | null;
  takeChanges: boolean;
  changes: number;
  otherSessions: OtherSession[];
}): TextPart[] {
  const branch = input.currentBranch;
  const checkout: TextPart[] = branch
    ? [{ text: "Your " }, { text: branch, mono: true }, { text: " checkout" }]
    : [{ text: "Your checkout" }];
  const taking = input.takeChanges && input.changes > 0;
  if (taking && input.otherSessions.length > 0) {
    const where: TextPart[] = branch
      ? [{ text: "left in " }, { text: branch, mono: true }]
      : [{ text: "left in your checkout" }];
    const others = input.otherSessions;
    return [
      { text: "Your changes are copied but " },
      ...where,
      {
        text: ` because ${sessionNames(others)} also ${others.length === 1 ? "works" : "work"} there.${KEEPS}`,
      },
    ];
  }
  if (taking) return [...checkout, { text: ` is left clean.${KEEPS}` }];
  if (input.changes > 0) {
    return [
      { text: "Your uncommitted changes stay in " },
      ...(branch
        ? [{ text: branch, mono: true }, { text: ` checkout.${KEEPS}` }]
        : [{ text: `your checkout.${KEEPS}` }]),
    ];
  }
  return [...checkout, { text: ` is left as it is.${KEEPS}` }];
}

/** lib/git.ts slugify, which is server-only (child_process) */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * The folder while the user hasn't edited it: the suggested one, renamed
 * after an edited branch when its name came from the suggested branch
 * (whole, or its last segment). Otherwise the suggestion as it is.
 */
export function followFolder(
  folder: string,
  suggestedBranch: string,
  branch: string
): string {
  const next = branch.trim();
  if (!next || next === suggestedBranch) return folder;
  const cut = folder.lastIndexOf("/");
  const dir = folder.slice(0, cut + 1);
  const base = folder.slice(cut + 1);
  const last = (b: string) => b.split("/").filter(Boolean).pop() ?? b;
  for (const [from, to] of [
    [slugify(suggestedBranch), slugify(next)],
    [slugify(last(suggestedBranch)), slugify(last(next))],
  ]) {
    if (from && to && base.endsWith(from))
      return dir + base.slice(0, base.length - from.length) + to;
  }
  return folder;
}

/**
 * A plausible new branch name before the server checks it
 * (`git check-ref-format --branch`): no spaces, control characters,
 * `~^:?*[\`, `..`, `@{`, `//`, leading `-` or `/`, trailing `/`, `.` or
 * `.lock`
 */
export function branchLooksValid(branch: string): boolean {
  const b = branch.trim();
  if (!b || b === "@") return false;
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(b)) return false;
  if (b.includes("..") || b.includes("@{") || b.includes("//")) return false;
  if (/^[-/]|[/.]$|\.lock$/.test(b)) return false;
  if (b.split("/").some((part) => part.startsWith("."))) return false;
  return true;
}

/**
 * "Unstage or commit first" and the others, from a refusal's body (a
 * MoveError, or requireUser's user_only)
 */
export function moveRefusalText(
  body: MoveError | { error?: string; reason?: string } | null | undefined
): string {
  if (!body) return "Something went wrong";
  if (body.reason === "staged") return "Unstage or commit first";
  return refusalText(body);
}

/** What the sheet shows and its button does */
export interface MoveSheetView {
  kind:
    | "loading"
    | "ready"
    | "busy"
    | "scheduled"
    | "moving"
    | "failed"
    | "refused";
  /** The line above the button (role=status), if any */
  note: string | null;
  /** The note is an error (red) */
  noteError: boolean;
  label: string;
  /** move: POST; cancel: DELETE the scheduled one; none: disabled */
  action: "move" | "cancel" | "none";
  /** The form's fields can be edited */
  editable: boolean;
}

/**
 * The sheet's state: a pending move first (scheduled, moving, failed),
 * then a refusal, then busy (the move waits for the turn) or ready
 */
export function moveSheetView(input: {
  preview: MovePreview | null;
  /** The latest known pending move (preview, or the moves poll) */
  pending: MoveState | null;
  branch: string;
  sending: boolean;
}): MoveSheetView {
  const { preview, pending, sending } = input;
  const name = agentName(preview?.agentType);
  if (!preview)
    return {
      kind: "loading",
      note: null,
      noteError: false,
      label: "Move session",
      action: "none",
      editable: false,
    };
  if (pending?.phase === "scheduled")
    return {
      kind: "scheduled",
      note: `Moves when ${name} finishes this turn`,
      noteError: false,
      label: "Cancel move",
      action: sending ? "none" : "cancel",
      editable: false,
    };
  if (pending?.phase === "moving")
    return {
      kind: "moving",
      note: "Moving…",
      noteError: false,
      label: "Moving…",
      action: "none",
      editable: false,
    };
  const refused = preview.refusal
    ? preview.refusal.reason === "staged"
      ? "You have staged changes. Unstage or commit first"
      : moveRefusalText(preview.refusal)
    : null;
  const ok = !refused && branchLooksValid(input.branch) && !sending;
  if (pending?.phase === "failed") {
    const why = (pending.error || "it was rolled back").replace(/\.+$/, "");
    const kept = pending.keptWorktree
      ? ` The worktree is kept at ${pending.keptWorktree}.`
      : "";
    return {
      kind: "failed",
      note: `Move failed: ${why}.${kept}${refused ? ` ${refused}` : ""}`,
      noteError: true,
      label: "Try again",
      action: ok ? "move" : "none",
      editable: !refused,
    };
  }
  if (refused)
    return {
      kind: "refused",
      note: refused,
      noteError: false,
      label: "Move session",
      action: "none",
      editable: false,
    };
  if (preview.busy)
    return {
      kind: "busy",
      note: `Moves when ${name} finishes this turn`,
      noteError: false,
      label: "Move session",
      action: ok ? "move" : "none",
      editable: true,
    };
  return {
    kind: "ready",
    note: null,
    noteError: false,
    label: "Move session",
    action: ok ? "move" : "none",
    editable: true,
  };
}

/** Now's subline for a session with a move: null when it has none */
export function nowMoveLine(
  state: MoveState | null | undefined
): string | null {
  switch (state?.phase) {
    case "moving":
      return "Moving…";
    case "scheduled":
      return "Moves after this turn";
    case "failed":
      return "Move failed";
    default:
      return null;
  }
}

/** Polling the moves list: quick while one waits or runs, else slow */
export const MOVES_POLL_FAST_MS = 3000;
export const MOVES_POLL_SLOW_MS = 30000;

export function movesPollMs(moves: MoveState[]): number {
  return moves.some((m) => m.phase === "scheduled" || m.phase === "moving")
    ? MOVES_POLL_FAST_MS
    : MOVES_POLL_SLOW_MS;
}
