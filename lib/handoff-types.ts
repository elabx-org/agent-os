/**
 * M4 "Agent and model" (N-Switch): the shapes shared by the routes
 * (app/api/sessions/[id]/{model,handoff,handoff-preview,resume-paused}),
 * lib/handoff.ts and the sheet. No server imports.
 */

import type { Session } from "./db/types";
import type { QueueItem } from "./queue/types";

/** Claude's model aliases, as `/model <alias>` and `--model <alias>` take them */
export const CLAUDE_MODEL_ALIASES = ["opus", "sonnet", "haiku"] as const;
export type ClaudeModelAlias = (typeof CLAUDE_MODEL_ALIASES)[number];

/** `claude --effort <level>` (Claude Code 2.1: low, medium, high, xhigh, max) */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** The agents a session can be handed off to (the sheet's three picks) */
export const HANDOFF_AGENTS = ["claude", "codex", "gemini"] as const;
export type HandoffAgent = (typeof HANDOFF_AGENTS)[number];

export function isClaudeModelAlias(value: unknown): value is ClaudeModelAlias {
  return (CLAUDE_MODEL_ALIASES as readonly unknown[]).includes(value);
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return (EFFORT_LEVELS as readonly unknown[]).includes(value);
}

export function isHandoffAgent(value: unknown): value is HandoffAgent {
  return (HANDOFF_AGENTS as readonly unknown[]).includes(value);
}

/** Handed off: its tmux ended, it stays listed and its chat stays readable */
export function isPaused(
  session: Pick<Session, "paused_at"> | null | undefined
): boolean {
  return !!session?.paused_at;
}

/** POST /api/sessions/[id]/model (Claude sessions only) */
export interface ModelSwitchRequest {
  /** Left out when only the effort changes (no /model is sent then) */
  model?: ClaudeModelAlias;
  effort?: EffortLevel;
}

/**
 * How the effort is applied: `now` through an in-session command queued
 * with the `/model` one, `next_launch` stored in sessions.effort and passed
 * as `--effort` when the session next starts (the sheet says which)
 */
export type EffortApplies = "now" | "next_launch";

export interface ModelSwitchResult {
  /** The first queued command, `/model` or `/effort` (kind='command': sent only at idle) */
  item: QueueItem | null;
  /** False when the queue isn't on for this session: the command was not queued */
  queued: boolean;
  /** Null when only the effort changed */
  model: ClaudeModelAlias | null;
  effort: EffortLevel | null;
  effortApplies: EffortApplies | null;
}

/** POST /api/sessions/[id]/handoff */
export interface HandoffRequest {
  agentType: HandoffAgent;
  /** The new session's model (Claude alias, or the agent's own name) */
  model?: string;
  /** lib/permission-mode.ts mode for the new session; default: the source's */
  permissionMode?: string;
}

export interface HandoffResult {
  newSessionId: string;
  /** The new session's row, to open it */
  session: Session;
}

/**
 * Why a handoff/resume was refused. busy: the source is mid-turn (409; the
 * sheet says "Between turns"). successor_live: resume-paused while the
 * session it was handed to still runs in the same folder (409 unless
 * `force`). not_paused, not_claude, no_transcript: 400
 */
export type HandoffRefusal =
  | "busy"
  | "successor_live"
  | "not_paused"
  | "not_claude"
  | "no_transcript";

export interface HandoffError {
  error: string;
  reason?: HandoffRefusal;
  /** With successor_live: the session working in the same folder */
  successorId?: string;
}

/** GET /api/sessions/[id]/handoff-preview: the sheet's "Carries over" */
export interface HandoffPreview {
  /** Rough size of the summary the new session gets (chars / 4) */
  summaryTokens: number;
  /** Files changed in the working tree (git), what "N files changed" counts */
  filesChanged: number;
  /** The open plan (lib/claude-plan.ts), null when there is none */
  plan: { done: number; total: number } | null;
  /** The source is mid-turn: the hand-off button waits */
  busy: boolean;
}

/** POST /api/sessions/[id]/resume-paused */
export interface ResumePausedRequest {
  /** Resume although the successor still runs in the same folder */
  force?: boolean;
}

export interface ResumePausedResult {
  session: Session;
}

/** What lib/summarize.ts builds for a handoff (and later M5, M8, M9, M11) */
export interface SessionSummary {
  /** The text sent to the new session as its first message */
  text: string;
  /** Rough token count (chars / 4) */
  tokens: number;
  /** Paths changed in the working tree, from git */
  filesChanged: string[];
  plan: { done: number; total: number } | null;
  /** Where it came from: the Claude transcript, `claude -p`, or the pane */
  source: "transcript" | "model" | "scrollback";
  /** Neither a conversation nor terminal history: nothing to carry over */
  empty: boolean;
}
