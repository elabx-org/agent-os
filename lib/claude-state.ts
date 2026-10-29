import fs from "fs";
import os from "os";
import path from "path";

/*
 * Claude Code's own view of a session, recorded as it runs: every Claude
 * session Agent-OS starts gets a status line wrapper and command hooks
 * (scripts/agentos-statusline.mjs, scripts/agentos-hook.mjs) that write to
 * $AGENT_OS_HOME/claude-state/<session id>/. The UI reads it instead of
 * parsing the screen for the permission mode, model, context and cost.
 */

export interface ClaudeStatus {
  model: { id?: string; display_name?: string } | null;
  context_window: { used_percentage?: number | null } | null;
  cost: { total_cost_usd?: number } | null;
  rate_limits: Record<
    string,
    { used_percentage?: number; resets_at?: number }
  > | null;
  effort: { level?: string } | null;
  fast_mode: boolean | null;
  vim: { mode?: string } | null;
  session_name: string | null;
  /** The first line the user's own status line command printed */
  line: string | null;
}

export interface ClaudeTool {
  tool_name: string;
  tool_input: unknown;
  /** Set when a subagent made the call */
  agent_id: string | null;
  at: number;
}

export interface ClaudeState {
  claudeSessionId: string | null;
  status: ClaudeStatus | null;
  /** default, acceptEdits, plan, auto, dontAsk, bypassPermissions */
  mode: string | null;
  busy: boolean | null;
  currentTool: ClaudeTool | null;
  pendingPermission: ClaudeTool | null;
  notification: {
    type: string | null;
    message: string | null;
    at: number;
  } | null;
  updatedAt: string | null;
}

export const EMPTY_CLAUDE_STATE: ClaudeState = {
  claudeSessionId: null,
  status: null,
  mode: null,
  busy: null,
  currentTool: null,
  pendingPermission: null,
  notification: null,
  updatedAt: null,
};

const SESSION_ID = /^[\w-]+$/;

const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
];

function stateRoot(): string {
  const home =
    process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  return path.join(home, "claude-state");
}

function stateDir(sessionId: string): string {
  return path.join(stateRoot(), sessionId);
}

/** Where a session's hooks write (turn journal: lib/turns.ts) */
export function claudeStateDir(sessionId: string): string | null {
  return SESSION_ID.test(sessionId) ? stateDir(sessionId) : null;
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Copies the scripts next to the state, so running sessions keep working
 * while Agent-OS updates itself in place
 */
function installScripts(): { hook: string; statusLine: string } {
  const bin = path.join(stateRoot(), "bin");
  fs.mkdirSync(bin, { recursive: true });
  const copy = (name: string) => {
    const from = path.join(process.cwd(), "scripts", name);
    const to = path.join(bin, name);
    const text = fs.readFileSync(from, "utf8");
    let current: string | null = null;
    try {
      current = fs.readFileSync(to, "utf8");
    } catch {
      // Not installed yet
    }
    if (current !== text) {
      const tmp = `${to}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, { mode: 0o755 });
      fs.renameSync(tmp, to);
    }
    return to;
  };
  // The hook runs it for turn snapshots; installed first so a new hook
  // never looks for it in vain
  copy("agentos-snapshot.mjs");
  return {
    hook: copy("agentos-hook.mjs"),
    statusLine: copy("agentos-statusline.mjs"),
  };
}

type StatusLineSetting = {
  type: "command";
  command: string;
  padding?: number;
  refreshInterval?: number;
  hideVimModeIndicator?: boolean;
};

/** The user's own status line options, which the wrapper keeps */
function userStatusLine(): Partial<StatusLineSetting> {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(configDir, "settings.json"), "utf8")
    );
    return settings?.statusLine ?? {};
  } catch {
    return {};
  }
}

export type HookGroup = {
  matcher?: string;
  hooks: { type: "command"; command: string; timeout?: number }[];
};

/**
 * The settings a Claude session gets so its state is recorded: a status
 * line wrapper and one command hook per event. Hooks merge with the user's
 * and the project's (Claude Code runs every matching hook).
 */
export function claudeStateSettings(sessionId: string): {
  statusLine: StatusLineSetting;
  hooks: Record<string, HookGroup[]>;
} {
  if (!SESSION_ID.test(sessionId)) throw new Error("Bad session id");
  const scripts = installScripts();
  const node = quote(process.execPath);
  const dir = quote(stateDir(sessionId));

  // Refreshing on a timer redraws the footer, which the status detector
  // reads as activity: only when the user asked for it
  const own = userStatusLine();
  const statusLine: StatusLineSetting = {
    type: "command",
    command: `${node} ${quote(scripts.statusLine)} ${dir}`,
  };
  if (typeof own.padding === "number") statusLine.padding = own.padding;
  if (typeof own.refreshInterval === "number") {
    statusLine.refreshInterval = own.refreshInterval;
  }
  if (own.hideVimModeIndicator) statusLine.hideVimModeIndicator = true;

  const command = `${node} ${quote(scripts.hook)} ${dir}`;
  const hooks: Record<string, HookGroup[]> = {};
  for (const event of HOOK_EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command, timeout: 5 }] }];
  }
  return { statusLine, hooks };
}

/** Adds the state capture to a session's settings, keeping its own hooks */
export function withClaudeState(
  sessionId: string,
  settings: { hooks?: Record<string, HookGroup[]> }
): object {
  let state: ReturnType<typeof claudeStateSettings>;
  try {
    state = claudeStateSettings(sessionId);
  } catch (error) {
    console.error("Claude state capture unavailable:", error);
    return settings;
  }
  const hooks = { ...state.hooks };
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  return { ...settings, statusLine: state.statusLine, hooks };
}

/** Writes settings with only the state capture, for sessions without a project */
export function writeClaudeStateSettings(sessionId: string): string | null {
  try {
    const file = path.join(stateRoot(), `${sessionId}.settings.json`);
    const settings = withClaudeState(sessionId, {});
    fs.mkdirSync(stateRoot(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2), { mode: 0o600 });
    return file;
  } catch {
    return null;
  }
}

function readJson(file: string): { data: unknown; mtime: number } | null {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    return { data: JSON.parse(fs.readFileSync(file, "utf8")), mtime };
  } catch {
    return null;
  }
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function tool(v: unknown): ClaudeTool | null {
  const t = obj(v);
  if (!t || typeof t.name !== "string") return null;
  return {
    tool_name: t.name,
    tool_input: t.input ?? null,
    agent_id: typeof t.agent_id === "string" ? t.agent_id : null,
    at: typeof t.at === "number" ? t.at : 0,
  };
}

/** The status line fields the UI shows, from the last status line run */
function statusOf(raw: unknown): ClaudeStatus | null {
  const s = obj(raw);
  if (!s) return null;
  const model = obj(s.model);
  const context = obj(s.context_window);
  const cost = obj(s.cost);
  const effort = obj(s.effort);
  const vim = obj(s.vim);
  return {
    model: model
      ? {
          id: model.id as string | undefined,
          display_name: model.display_name as string | undefined,
        }
      : null,
    context_window: context
      ? { used_percentage: context.used_percentage as number | null }
      : null,
    cost: cost ? { total_cost_usd: cost.total_cost_usd as number } : null,
    rate_limits: (obj(s.rate_limits) as ClaudeStatus["rate_limits"]) ?? null,
    effort: effort ? { level: effort.level as string | undefined } : null,
    fast_mode: typeof s.fast_mode === "boolean" ? s.fast_mode : null,
    vim: vim ? { mode: vim.mode as string | undefined } : null,
    session_name: typeof s.session_name === "string" ? s.session_name : null,
    line: null,
  };
}

function readLine(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * When Claude's hooks last wrote this session's state (ms), or null: any
 * hook event after a send means Claude took the message in
 */
export function claudeHookAt(sessionId: string): number | null {
  if (!SESSION_ID.test(sessionId)) return null;
  const file = readJson(path.join(stateDir(sessionId), "state.json"));
  const at = obj(file?.data)?.updated_at;
  return typeof at === "number" ? at : null;
}

/** What the session's hooks and status line last recorded */
export function readClaudeState(sessionId: string): ClaudeState {
  if (!SESSION_ID.test(sessionId)) return EMPTY_CLAUDE_STATE;
  const dir = stateDir(sessionId);
  const statusFile = readJson(path.join(dir, "status.json"));
  const stateFile = readJson(path.join(dir, "state.json"));
  if (!statusFile && !stateFile) return EMPTY_CLAUDE_STATE;

  const state = obj(stateFile?.data) ?? {};
  const status = obj(statusFile?.data);
  const notification = obj(state.notification);
  const parsed = statusOf(status);
  const updated = Math.max(statusFile?.mtime ?? 0, stateFile?.mtime ?? 0);
  const claudeSessionId =
    (typeof status?.session_id === "string" && status.session_id) ||
    (typeof state.session_id === "string" && state.session_id) ||
    null;
  return {
    claudeSessionId,
    status: parsed && {
      ...parsed,
      line: readLine(path.join(dir, "statusline.txt")),
    },
    mode:
      typeof state.permission_mode === "string" ? state.permission_mode : null,
    busy: typeof state.busy === "boolean" ? state.busy : null,
    currentTool: tool(state.current_tool),
    pendingPermission: tool(state.pending_permission),
    notification: notification
      ? {
          type: (notification.type as string) ?? null,
          message: (notification.message as string) ?? null,
          at: (notification.at as number) ?? 0,
        }
      : null,
    updatedAt: updated ? new Date(updated).toISOString() : null,
  };
}
