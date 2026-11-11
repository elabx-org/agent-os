/**
 * Which Claude models sessions run, as AgentOS shows and sets them: the
 * main model and the sub-agents' model (Claude's
 * CLAUDE_CODE_SUBAGENT_MODEL). Settings → Claude Code holds the defaults for
 * new sessions; each session keeps its own (sessions.model,
 * sessions.subagent_model). No server imports.
 */

import {
  CLAUDE_MODEL_ALIASES,
  CLAUDE_MODEL_VERSIONS,
  isClaudeModel,
  isClaudeModelAlias,
  type ClaudeModel,
  type ClaudeModelAlias,
  type ClaudeModelVersion,
} from "./handoff-types";

/** The preference (/api/preferences) the defaults are saved under */
export const CLAUDE_MODELS_PREFERENCE_KEY = "claude_models";

export interface ClaudeModels {
  /** New sessions' model; null: Claude Code's own default */
  model: ClaudeModel | null;
  /** Their sub-agents' model; null: the same as the session's */
  subagents: ClaudeModel | null;
}

export const NO_CLAUDE_MODELS: ClaudeModels = { model: null, subagents: null };

/** What a saved or sent value holds, anything unknown dropped */
export function parseClaudeModels(value: unknown): ClaudeModels {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    model: isClaudeModel(v.model) ? v.model : null,
    subagents: isClaudeModel(v.subagents) ? v.subagents : null,
  };
}

/** The model each alias runs in Claude Code 2.1 ("fable" is Fable 5.2) */
const NAME: Record<ClaudeModel, string> = {
  fable: "Fable 5.2",
  opus: "Opus 5.5",
  sonnet: "Sonnet 5.5",
  haiku: "Haiku 5.5",
  "claude-fable-5-1": "Fable 5.1",
  "claude-fable-5": "Fable 5",
  "claude-opus-5": "Opus 5",
  "claude-opus-4-8": "Opus 4.8",
  "claude-opus-4-7": "Opus 4.7",
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-5": "Sonnet 5",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
};

export function claudeModelName(model: ClaudeModel): string {
  return NAME[model];
}

/** "opus" for "opus" and for "claude-opus-4-8" */
export function claudeModelFamily(model: ClaudeModel): ClaudeModelAlias {
  return isClaudeModelAlias(model)
    ? model
    : CLAUDE_MODEL_ALIASES.find((alias) => model.includes(`-${alias}-`))!;
}

/**
 * The earlier version a model id names, null for anything else (the newest
 * ones included): "claude-opus-4-8" from itself, from "claude-opus-4-8[1m]"
 * and from a dated "claude-opus-4-8-20260115"
 */
export function claudeModelVersion(
  id: string | null | undefined
): ClaudeModelVersion | null {
  const plain = (id ?? "").toLowerCase().replace(/\[[^\]]*\]$/, "");
  const undated = plain.replace(/-\d{8}$/, "");
  return (
    CLAUDE_MODEL_VERSIONS.find((v) => v === plain || v === undated) ?? null
  );
}

/** Every alias with its name, most capable first */
export const CLAUDE_MODEL_CHOICES = CLAUDE_MODEL_ALIASES.map((alias) => ({
  alias,
  name: NAME[alias],
}));

/** The earlier versions with their names, in the aliases' order */
export const CLAUDE_MODEL_VERSION_CHOICES = CLAUDE_MODEL_VERSIONS.map((id) => ({
  id,
  name: NAME[id],
}));

/** A family's choices: the alias (its newest), then its earlier versions */
export function claudeModelVersions(family: ClaudeModelAlias): ClaudeModel[] {
  return [
    family,
    ...CLAUDE_MODEL_VERSIONS.filter((v) => claudeModelFamily(v) === family),
  ];
}

/**
 * The sub-agents' model in words: "Opus 5.5", or "Same as the session"
 * (short: "Same") when it isn't set
 */
export function subagentModelName(
  model: string | null | undefined,
  short = false
): string {
  if (isClaudeModel(model)) return NAME[model];
  return short ? "Same" : "Same as the session";
}
