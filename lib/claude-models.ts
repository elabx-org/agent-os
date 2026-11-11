/**
 * Which Claude models sessions run, as AgentOS shows and sets them: the
 * main model and the sub-agents' model (Claude's
 * CLAUDE_CODE_SUBAGENT_MODEL). Settings → Claude Code holds the defaults for
 * new sessions; each session keeps its own (sessions.model,
 * sessions.subagent_model). No server imports.
 */

import {
  CLAUDE_MODEL_ALIASES,
  isClaudeModelAlias,
  type ClaudeModelAlias,
} from "./handoff-types";

/** The preference (/api/preferences) the defaults are saved under */
export const CLAUDE_MODELS_PREFERENCE_KEY = "claude_models";

export interface ClaudeModels {
  /** New sessions' model; null: Claude Code's own default */
  model: ClaudeModelAlias | null;
  /** Their sub-agents' model; null: the same as the session's */
  subagents: ClaudeModelAlias | null;
}

export const NO_CLAUDE_MODELS: ClaudeModels = { model: null, subagents: null };

/** What a saved or sent value holds, anything unknown dropped */
export function parseClaudeModels(value: unknown): ClaudeModels {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    model: isClaudeModelAlias(v.model) ? v.model : null,
    subagents: isClaudeModelAlias(v.subagents) ? v.subagents : null,
  };
}

/** The model each alias runs in Claude Code 2.1 ("fable" is Fable 5.2) */
const NAME: Record<ClaudeModelAlias, string> = {
  fable: "Fable 5.2",
  opus: "Opus 5.5",
  sonnet: "Sonnet 5.5",
  haiku: "Haiku 5.5",
};

export function claudeModelName(alias: ClaudeModelAlias): string {
  return NAME[alias];
}

/** Every alias with its name, most capable first */
export const CLAUDE_MODEL_CHOICES = CLAUDE_MODEL_ALIASES.map((alias) => ({
  alias,
  name: NAME[alias],
}));

/**
 * The sub-agents' model in words: "Opus 5.5", or "Same as the session"
 * (short: "Same") when it isn't set
 */
export function subagentModelName(
  alias: string | null | undefined,
  short = false
): string {
  if (isClaudeModelAlias(alias)) return NAME[alias];
  return short ? "Same" : "Same as the session";
}
