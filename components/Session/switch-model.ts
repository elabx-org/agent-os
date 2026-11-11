/**
 * The "Agent and model" sheet's choices in words (N-Switch): which model
 * is current, the picks' labels, the effort levels shown, and what the
 * sheet's button does. Pure, so it is unit tested.
 */

import { refusalText } from "@/lib/client/user-fetch";
import {
  claudeModelFamily,
  claudeModelName,
  claudeModelVersion,
  claudeModelVersions,
} from "@/lib/claude-models";
import {
  CLAUDE_MODEL_ALIASES,
  EFFORT_LEVELS,
  isClaudeModel,
  isClaudeModelAlias,
  isEffortLevel,
  type ClaudeModel,
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
  fable: "Fable",
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

export interface CurrentModel {
  /** Its family, the tile that's lit */
  alias: ClaudeModelAlias | null;
  label: string | null;
  /** The earlier version it is held on, else the alias (its newest) */
  model: ClaudeModel | null;
}

/** The model a session runs: Claude's status line first, else sessions.model */
export function currentModel(
  statusModel: { id?: string; display_name?: string | null } | null | undefined,
  sessionModel: string | null | undefined
): CurrentModel {
  const shown = modelDisplayName(statusModel?.display_name);
  const alias =
    modelAlias(statusModel?.id) ??
    modelAlias(shown) ??
    modelAlias(sessionModel);
  const version = claudeModelVersion(statusModel?.id ?? sessionModel);
  return {
    alias,
    label:
      shown ?? (version ? claudeModelName(version) : alias && FAMILY[alias]),
    model: version ?? alias,
  };
}

export interface ModelPick {
  alias: ClaudeModelAlias;
  /**
   * The current one by Claude's own name ("Opus 5.5"), the picked family by
   * the version picked, the rest by their newest
   */
  label: string;
  caption: string;
}

const CAPTION: Record<ClaudeModelAlias, string> = {
  fable: "Most capable",
  opus: "Strong",
  sonnet: "Faster",
  haiku: "Quickest",
};

type Current = Pick<CurrentModel, "alias" | "label"> & {
  model?: ClaudeModel | null;
};

/**
 * Fable, Opus, Sonnet, Haiku; the one running says Current, unless another
 * version of it is picked (the tile then names that one)
 */
export function modelPicks(
  current: Current,
  picked?: ClaudeModel | null
): ModelPick[] {
  const running = current.model ?? current.alias;
  return CLAUDE_MODEL_ALIASES.map((alias) => {
    const mine = picked && claudeModelFamily(picked) === alias ? picked : null;
    const isCurrent = alias === current.alias && (!mine || mine === running);
    return {
      alias,
      label: (isCurrent && current.label) || claudeModelName(mine ?? alias),
      caption: isCurrent ? "Current" : CAPTION[alias],
    };
  });
}

/** The pick's name in the button: "Switch to Sonnet 5.5" */
export function pickLabel(model: ClaudeModel, current: Current): string {
  return modelPicks(current, model).find(
    (p) => p.alias === claudeModelFamily(model)
  )!.label;
}

/** What tapping a family's tile picks: the running version of the running
 * family (no change), else the family's newest */
export function familyPick(
  alias: ClaudeModelAlias,
  current: Current
): ClaudeModel {
  return alias === current.alias ? (current.model ?? alias) : alias;
}

export interface VersionChoice {
  id: ClaudeModel;
  /** In the segment: "5.5", "4.8" */
  label: string;
  /** Read out: "Opus 5.5, newest", "Opus 4.8" */
  name: string;
}

/** The Version segment for a family: its newest (the alias), then the earlier */
export function versionChoices(family: ClaudeModelAlias): VersionChoice[] {
  return claudeModelVersions(family).map((id) => {
    const name = claudeModelName(id);
    return {
      id,
      label: name.replace(/^\S+\s+/, ""),
      name: isClaudeModelAlias(id) ? `${name}, newest` : name,
    };
  });
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

/** The sub-agents' model picked: the session's own, or a model */
export type SubagentPick = ClaudeModel | "same";

/** The sub-agents segment: Same, then each family */
export const SUBAGENT_PICKS: (ClaudeModelAlias | "same")[] = [
  "same",
  ...CLAUDE_MODEL_ALIASES,
];

/** Its label in the segment: "Same", "Opus" (its aria-label names the version) */
export function subagentPickLabel(pick: ClaudeModelAlias | "same"): string {
  return pick === "same" ? "Same" : FAMILY[pick];
}

/** The segment button a pick lights: its family, or Same */
export function subagentSegment(pick: SubagentPick): ClaudeModelAlias | "same" {
  return pick === "same" ? "same" : claudeModelFamily(pick);
}

/** The session's stored sub-agents' model as a pick */
export function currentSubagents(
  stored: string | null | undefined
): SubagentPick {
  return isClaudeModel(stored) ? stored : "same";
}

export type SwitchAction =
  | { kind: "handoff"; label: string; disabled: boolean; note: string | null }
  | { kind: "model"; label: string; disabled: boolean; note: string | null }
  /** Sub-agents changed: stored, then the session restarts to read it */
  | { kind: "restart"; label: string; disabled: boolean; note: string | null }
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
  /** The sub-agents' model changed (Claude only) */
  subagentsChanged?: boolean;
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
  // Claude reads the sub-agents' model when it starts: a restart, never
  // mid-turn, resuming the same conversation (the model and effort go too)
  if (o.source === "claude" && o.subagentsChanged)
    return {
      kind: "restart",
      label: "Apply and restart",
      disabled: o.busy,
      note: o.busy
        ? `Waits until ${o.sourceName} is done`
        : `${o.sourceName} restarts in the same conversation`,
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
