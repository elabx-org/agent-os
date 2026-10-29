/**
 * A session's permission mode: how much its agent may do without asking.
 * Stored in sessions.permission_mode (NULL = the agent's own default, no
 * flag at launch), mapped to each provider's launch flags here.
 */

import type { Session } from "@/lib/db";
import type { AgentType } from "@/lib/providers";

/** Claude Code's names; Codex and Gemini get the nearest equivalent */
export const MODES = [
  "manual",
  "acceptEdits",
  "auto",
  "bypassPermissions",
] as const;

export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Record<Mode, string> = {
  manual: "Ask first",
  acceptEdits: "Accept edits",
  auto: "Auto",
  bypassPermissions: "Full access",
};

/** Recorded at launch (sessions.launch_caps, JSON) */
export interface LaunchCaps {
  /** Launched with --allow-dangerously-skip-permissions (Labs liveFullAccess) */
  allowBypassCycle: boolean;
}

/** GET /api/sessions/[id]/permission-mode */
export interface PermissionModeState {
  mode: Mode;
  /** Waiting to be applied at the next idle edge */
  pending: Mode | null;
  /** What the running agent reports (Claude's state file), if known */
  live: Mode | null;
  canApplyLive: boolean;
  agentType: AgentType;
}

/** POST /api/sessions/[id]/permission-mode body */
export interface SetPermissionModeRequest {
  mode: Mode;
  /** Also answer the pending permission request "Yes" (user only) */
  allowPending?: boolean;
}

/** POST /api/sessions/[id]/permission-mode response */
export interface SetPermissionModeResult {
  mode: Mode;
  pending: Mode | null;
  appliedNow: boolean;
  needsRestart: boolean;
}

/** 403 body of a user-only request made without proof */
export interface UserOnlyError {
  error: "user_only";
  reason?: string;
}

/**
 * A mode name from the DB, a request or Claude's state file; Claude's
 * "default" is "manual". Null for anything unknown (dontAsk, plan, junk).
 */
export function normalizeMode(_value: unknown): Mode | null {
  throw new Error("not implemented");
}

/** The stored mode, else derived from auto_approve, else "manual" */
export function effectiveMode(_session: Session): Mode {
  throw new Error("not implemented");
}

/** sessions.launch_caps parsed; all false when missing or malformed */
export function parseLaunchCaps(_raw: string | null): LaunchCaps {
  throw new Error("not implemented");
}

/** Launch flags for a mode; none for NULL, so the agent keeps its default */
export function flagsFor(_agentType: AgentType, _mode: Mode | null): string[] {
  throw new Error("not implemented");
}

/**
 * Switches a running session's mode without a restart where the agent
 * allows it (Claude's Shift+Tab cycle, bounded, only while idle or at a
 * prompt). applied=false means it waits for a relaunch.
 */
export async function applyModeLive(
  _session: Session,
  _mode: Mode
): Promise<{ applied: boolean; live: Mode | null }> {
  throw new Error("not implemented");
}
