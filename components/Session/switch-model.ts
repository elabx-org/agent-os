/**
 * The "Agent and model" sheet's choices in words (N-Switch): which model
 * is current, the picks' labels, the effort levels shown, and what the
 * sheet's button does. Pure, so it is unit tested.
 */

import { refusalText } from "@/lib/client/user-fetch";
import {
  CLAUDE_MODEL_ALIASES,
  EFFORT_LEVELS,
  isEffortLevel,
  type ClaudeModelAlias,
  type EffortLevel,
  type HandoffRefusal,
} from "@/lib/handoff-types";

/** "opus" from "claude-opus-5-5", "Opus 5.5", "opus[1m]"…; null if none */
export function modelAlias(
  model: string | null | undefined
): ClaudeModelAlias | null {
  const text = (model ?? "").toLowerCase();
  return CLAUDE_MODEL_ALIASES.find((alias) => text.includes(alias)) ?? null;
}

const FAMILY: Record<ClaudeModelAlias, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

/**
 * Claude's own name for its model, as the chip and the pick show it:
 * "Opus 5.5" from "Claude Opus 5.5 (1M context)"; null when it has none
 */
export function modelDisplayName(
  displayName: string | null | undefined
): string | null {
  const name = (displayName ?? "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/^claude\s+/i, "")
    .trim();
  return name || null;
}

/** The model a session runs: Claude's status line first, else sessions.model */
export function currentModel(
  statusModel: { id?: string; display_name?: string } | null | undefined,
  sessionModel: string | null | undefined
): { alias: ClaudeModelAlias | null; label: string | null } {
  const shown = modelDisplayName(statusModel?.display_name);
  const alias =
    modelAlias(statusModel?.id) ??
    modelAlias(shown) ??
    modelAlias(sessionModel);
  return { alias, label: shown ?? (alias ? FAMILY[alias] : null) };
}

export interface ModelPick {
  alias: ClaudeModelAlias;
  /** The current one by Claude's own name ("Opus 5.5"), the rest by family */
  label: string;
  caption: string;
}

const CAPTION: Record<ClaudeModelAlias, string> = {
  opus: "Most capable",
  sonnet: "Faster",
  haiku: "Quickest",
};

/** Opus, Sonnet, Haiku; the one running says Current */
export function modelPicks(current: {
  alias: ClaudeModelAlias | null;
  label: string | null;
}): ModelPick[] {
  return CLAUDE_MODEL_ALIASES.map((alias) => {
    const isCurrent = alias === current.alias;
    return {
      alias,
      label: (isCurrent && current.label) || FAMILY[alias],
      caption: isCurrent ? "Current" : CAPTION[alias],
    };
  });
}

/** The pick's name in the button: "Switch to Sonnet" */
export function pickLabel(
  alias: ClaudeModelAlias,
  current: { alias: ClaudeModelAlias | null; label: string | null }
): string {
  return modelPicks(current).find((p) => p.alias === alias)!.label;
}

const EFFORT_WORD: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

export function effortLabel(level: EffortLevel): string {
  return EFFORT_WORD[level];
}

/**
 * The effort levels the segment shows: Low, Medium, High, Max as in the
 * mock; X-High too while the session runs at it (or it was picked), so
 * the current level is always visible
 */
export function effortOptions(
  ...shown: (string | null | undefined)[]
): EffortLevel[] {
  return EFFORT_LEVELS.filter(
    (level) => level !== "xhigh" || shown.includes("xhigh")
  );
}

/** The session's effort: Claude's status line, else what was stored */
export function currentEffort(
  statusEffort: string | null | undefined,
  sessionEffort: string | null | undefined
): EffortLevel | null {
  if (isEffortLevel(statusEffort)) return statusEffort;
  return isEffortLevel(sessionEffort) ? sessionEffort : null;
}

export type SwitchAction =
  | { kind: "handoff"; label: string; disabled: boolean; note: string | null }
  | { kind: "model"; label: string; disabled: boolean; note: string | null }
  | { kind: "none"; label: string; disabled: true; note: string | null };

/**
 * What the sheet's button does with the picks. Another agent is a handoff
 * (which waits while the session works); the same Claude with another
 * model or effort is a switch, queued for between turns
 */
export function switchAction(o: {
  /** The session's agent_type */
  source: string;
  /** Its name, "Claude" */
  sourceName: string;
  picked: string;
  pickedName: string;
  /** The pick's label, "Sonnet" */
  modelLabel: string | null;
  modelChanged: boolean;
  effortChanged: boolean;
  /** From the preview: mid-turn */
  busy: boolean;
  paused: boolean;
  /** Settled (M8): ended like a paused one */
  settled?: boolean;
}): SwitchAction {
  if (o.paused || o.settled)
    return {
      kind: "none",
      label: o.paused ? "Paused" : "Settled",
      disabled: true,
      note: "Resume this session to switch it",
    };
  if (o.picked !== o.source)
    return {
      kind: "handoff",
      label: `Hand off to ${o.pickedName}`,
      disabled: o.busy,
      note: o.busy ? `Waits until ${o.sourceName} is done` : null,
    };
  if (o.source === "claude" && o.modelChanged && o.modelLabel)
    return {
      kind: "model",
      label: `Switch to ${o.modelLabel}`,
      disabled: false,
      note: o.busy ? `Switches when ${o.sourceName} is done` : null,
    };
  if (o.source === "claude" && o.effortChanged)
    return {
      kind: "model",
      label: "Apply",
      disabled: false,
      note: o.busy ? `Applies when ${o.sourceName} is done` : null,
    };
  return { kind: "none", label: "Apply", disabled: true, note: null };
}

/** Under the greyed model row: why it isn't used */
export function modelRowCaption(o: {
  source: string;
  picked: string;
  pickedName: string;
}): string | null {
  if (o.picked === "claude") return null;
  return o.source === "claude"
    ? `Not used while ${o.pickedName} is picked. Pick Claude to change the model on your next turn.`
    : `Not used while ${o.pickedName} is picked. Pick Claude to hand off to a Claude model.`;
}

/** A model, handoff or resume route's refusal in words */
export function handoffRefusalText(
  status: number,
  body: { error?: string; reason?: string; successorId?: string } | null,
  agentName: string
): string {
  if (status === 403) return refusalText(body ?? {});
  switch (body?.reason as HandoffRefusal | undefined) {
    case "busy":
      return `${agentName} is working: try again once it's done`;
    case "successor_live":
      return "The session it was handed to still works in this folder";
    case "not_paused":
      return "This session isn't paused";
    case "not_claude":
      return "Only Claude sessions switch model";
    case "no_transcript":
      return "Couldn't find this session's conversation";
  }
  if (status === 501) return "Not available yet on this server";
  if (status === 404) return "This session isn't there any more";
  return body?.error ?? "Something went wrong";
}
