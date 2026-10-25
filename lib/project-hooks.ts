/*
 * Claude Code hooks a project gives every Claude session in it. Shared by the
 * server (lib/project-context.ts) and project settings.
 */

export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "Notification",
  "PreCompact",
] as const;

/** Events whose hooks can be narrowed to some tools */
export const TOOL_EVENTS = new Set<string>(["PreToolUse", "PostToolUse"]);

export interface ProjectHook {
  event: (typeof HOOK_EVENTS)[number];
  /** Tool names for tool events, e.g. "Bash" or "Edit|Write"; empty = all */
  matcher?: string;
  command: string;
}

/** The project's hooks, dropping anything malformed */
export function parseProjectHooks(raw: unknown): ProjectHook[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((h) => {
    const event = h?.event;
    const command = typeof h?.command === "string" ? h.command.trim() : "";
    if (!HOOK_EVENTS.includes(event) || !command) return [];
    const matcher =
      TOOL_EVENTS.has(event) && typeof h.matcher === "string"
        ? h.matcher.trim()
        : "";
    return [{ event, command, ...(matcher ? { matcher } : {}) }];
  });
}

/** What each event means, for the settings */
export const HOOK_EVENT_LABELS: Record<ProjectHook["event"], string> = {
  PreToolUse: "Before a tool runs",
  PostToolUse: "After a tool runs",
  UserPromptSubmit: "When you send a message",
  Stop: "When Claude finishes",
  SubagentStop: "When a subagent finishes",
  SessionStart: "When the session starts",
  SessionEnd: "When the session ends",
  Notification: "When Claude notifies",
  PreCompact: "Before the context is compacted",
};
