/**
 * What the permission card shows, apart from React: which prompts agents
 * may answer, what a refused agent tried, and what a switch to full access
 * did. Client-safe (no node imports).
 */

import type { AgentAction, AgentActionKind } from "@/lib/agent-actions";
import type { ClaudeTool } from "@/lib/claude-state";
import type {
  PermissionPrompt,
  PromptOption,
  PromptOptionKind,
} from "@/lib/permission-prompt";
import type { SetPermissionModeResult } from "@/lib/permission-mode";
import type { ReplyContext } from "@/lib/reply-context";

// The answer that lets Claude go on is the accent-filled one (the card's
// amber ring says "needs you"); the rest are quiet secondary buttons
const SECONDARY =
  "border border-black/10 bg-black/5 font-medium text-foreground active:bg-accent dark:border-white/12 dark:bg-white/8";

export const KIND_STYLE: Record<PromptOptionKind, string> = {
  allow: "bg-primary font-semibold text-primary-foreground active:opacity-80",
  always: SECONDARY,
  deny: SECONDARY,
  other: SECONDARY,
};

/**
 * The card's one row of answers: allow plus deny (or the last option), or
 * for a question with neither, its first two. The rest go behind More…
 */
export function splitOptions(options: PromptOption[]) {
  const allow = options.find((o) => o.kind === "allow");
  let main: PromptOption[];
  if (allow) {
    const deny =
      options.find((o) => o.kind === "deny") ?? options[options.length - 1];
    main = deny === allow ? [allow] : [allow, deny];
  } else {
    main = options.slice(0, 2);
  }
  return { main, more: options.length > main.length };
}

// The card's buttons are short: a bare "Yes" reads as Allow and "No" or
// "No, and tell Claude..." as Deny; a question's answers keep their label
export function shortLabel(option: PromptOption): string {
  if (option.kind === "allow" && /^yes\W*$/i.test(option.label)) return "Allow";
  if (
    option.kind === "deny" &&
    /^no(\W*$|, and tell claude)/i.test(option.label)
  )
    return "Deny";
  return option.label;
}

/**
 * Whether the prompt on screen is a question an agent may answer: only a
 * pending AskUserQuestion, as the Needs you card classifies it (mergePrompt).
 * Anything else, or anything unclear, is treated as a permission request.
 */
export function isAnswerableQuestion(
  merged: ReplyContext | null,
  prompt: PermissionPrompt
): boolean {
  if (merged?.kind !== "ask" || merged.toolName !== "AskUserQuestion")
    return false;
  // Permission dialogs offer "Yes, and don't ask again"; a question doesn't
  return !prompt.options.some((o) => o.kind === "always");
}

/** What a tool call is about, in one line */
export function toolSummary(tool: ClaudeTool): string {
  const input = tool.tool_input as Record<string, unknown> | null;
  const pick = (k: string) =>
    input && typeof input[k] === "string" ? (input[k] as string) : null;
  return (
    pick("command") ??
    pick("file_path") ??
    pick("url") ??
    pick("pattern") ??
    pick("description") ??
    ""
  );
}

// "<actor> tried to … and was blocked"
const TRIED: Record<AgentActionKind, string> = {
  prompt_answer: "allow this for you",
  keys: "change the permission mode",
  send_keys: "type into this session",
  permission_mode: "switch on full access",
  spawn: "start a session with full access",
  summarize: "copy full access to a new session",
};

/** The newest refused attempt at or after `since` (ms), if any */
export function latestBlocked(
  actions: readonly AgentAction[],
  since = 0
): AgentAction | null {
  let latest: AgentAction | null = null;
  for (const a of actions) {
    if (a.allowed || a.at < since) continue;
    if (!latest || a.at > latest.at) latest = a;
  }
  return latest;
}

/** "Stack health check tried to allow this for you and was blocked" */
export function blockedText(action: AgentAction): string {
  return `${action.actor || "An agent"} tried to ${TRIED[action.action] ?? "act for you"} and was blocked`;
}

/** After a switch to full access: what to say, and whether to offer a restart */
export function fullAccessNote(
  result: Pick<SetPermissionModeResult, "appliedNow" | "needsRestart">,
  claude: boolean
): { text: string; restart: boolean } {
  if (result.appliedNow) return { text: "Full access is on", restart: false };
  if (!claude)
    return { text: "Applies when the session restarts", restart: false };
  return { text: "Full access from the next turn", restart: true };
}
