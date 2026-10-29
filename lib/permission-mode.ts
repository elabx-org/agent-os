/**
 * A session's permission mode: how much its agent may do without asking.
 * Stored in sessions.permission_mode (NULL = the agent's own default, no
 * flag at launch), mapped to each provider's launch flags here.
 */

import type { Session } from "@/lib/db";
import type { AgentType } from "@/lib/providers";
import { getProviderDefinition } from "@/lib/providers/registry";

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
  /** The allow option the card showed; allowPending answers only that */
  prompt?: { index: number; label: string };
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
export function normalizeMode(value: unknown): Mode | null {
  if (value === "default") return "manual";
  return MODES.includes(value as Mode) ? (value as Mode) : null;
}

/**
 * The stored mode, else what auto_approve launches with (Codex's flag is
 * the sandboxed --full-auto, so "auto"), else "manual"
 */
export function effectiveMode(session: Session): Mode {
  const stored = normalizeMode(session.permission_mode);
  if (stored) return stored;
  if (!session.auto_approve) return "manual";
  return session.agent_type === "codex" ? "auto" : "bypassPermissions";
}

/** Whether `mode` lets the agent do more than `than` */
export function isEscalation(mode: Mode, than: Mode): boolean {
  return MODES.indexOf(mode) > MODES.indexOf(than);
}

/** The most an agent may give a session (its own or a worker): never full access */
export function capForAgent(mode: Mode): Mode {
  return mode === "bypassPermissions" ? "auto" : mode;
}

/** sessions.launch_caps parsed; all false when missing or malformed */
export function parseLaunchCaps(raw: string | null): LaunchCaps {
  try {
    const caps = raw ? JSON.parse(raw) : null;
    return { allowBypassCycle: caps?.allowBypassCycle === true };
  } catch {
    return { allowBypassCycle: false };
  }
}

/** Claude Code (and the claude-minimax alias) take its mode names as they are */
function isClaudeCli(agentType: AgentType): boolean {
  return agentType === "claude" || agentType === "minimax";
}

/** Launch flags for a mode; none for NULL, so the agent keeps its default */
export function flagsFor(agentType: AgentType, mode: Mode | null): string[] {
  if (!mode) return [];
  if (isClaudeCli(agentType)) {
    return mode === "bypassPermissions"
      ? ["--dangerously-skip-permissions"]
      : ["--permission-mode", mode];
  }
  switch (agentType) {
    case "codex":
      if (mode === "manual") return ["-a", "untrusted"];
      return mode === "bypassPermissions"
        ? ["--dangerously-bypass-approvals-and-sandbox"]
        : ["--full-auto"];
    case "gemini":
      if (mode === "manual") return ["--approval-mode", "default"];
      return mode === "bypassPermissions"
        ? ["--yolo"]
        : ["--approval-mode", "auto_edit"];
    default: {
      // No modes, only the registry's skip-prompts flag
      const flag = getProviderDefinition(agentType).autoApproveFlag;
      return mode === "bypassPermissions" && flag ? [flag] : [];
    }
  }
}

export interface PermissionFlagsOptions {
  /** sessions.permission_mode as stored */
  permissionMode?: string | null;
  autoApprove?: boolean;
  skipPermissions?: boolean;
  /** Labs liveFullAccess: full access joins Claude's Shift+Tab cycle */
  allowBypassCycle?: boolean;
}

/**
 * The permission flags a provider launches with: the stored mode's, else
 * the registry's auto-approve flag as before modes existed.
 */
export function permissionFlags(
  agentType: AgentType,
  options: PermissionFlagsOptions
): string[] {
  const mode = normalizeMode(options.permissionMode);
  const autoApproveFlag = getProviderDefinition(agentType).autoApproveFlag;
  const flags = mode
    ? flagsFor(agentType, mode)
    : (options.skipPermissions || options.autoApprove) && autoApproveFlag
      ? [autoApproveFlag]
      : [];
  if (
    options.allowBypassCycle &&
    isClaudeCli(agentType) &&
    mode !== "bypassPermissions"
  ) {
    flags.push("--allow-dangerously-skip-permissions");
  }
  return flags;
}

/**
 * Presses Shift+Tab until Claude shows `target`, at most `max` times, and
 * stops early when the cycle comes back round (the mode isn't in it, e.g.
 * full access without --allow-dangerously-skip-permissions) or the footer
 * can't be read (a dialog covers it). `read` gives the footer's mode as
 * Claude names it, plan included.
 */
export async function cycleToMode(
  target: Mode,
  io: {
    read: () => Promise<string | null>;
    press: () => Promise<void>;
    max?: number;
  }
): Promise<{ applied: boolean; live: Mode | null }> {
  const max = io.max ?? 6;
  const start = await io.read();
  let seen = start;
  for (let n = 0; seen && normalizeMode(seen) !== target && n < max; n++) {
    await io.press();
    seen = await io.read();
    if (seen === start) break;
  }
  const live = normalizeMode(seen);
  return { applied: live === target, live };
}
