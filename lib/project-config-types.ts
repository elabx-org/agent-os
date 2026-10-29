/**
 * M3 contract: the shape of a project's `.agent-os.json` and of the routes
 * around it. No server imports, so the Scripts sheet and the editor can use
 * it. lib/project-config.ts reads and writes the file; lib/script-runs.ts
 * runs its scripts.
 */

import type { Mode } from "@/lib/permission-mode";

/** The file the editor writes, in the project's root */
export const CONFIG_FILE = ".agent-os.json";
/** Read first for `setup`/`devServer` when present (legacy), never written */
export const LEGACY_CONFIG_FILE = ".agent-os/worktrees.json";

/** The icon set of the Add script dialog (D-Config), lucide names in ICONS */
export const SCRIPT_ICONS = [
  "monitor",
  "flask",
  "check",
  "package",
  "upload",
  "terminal",
  "database",
  "bug",
  "globe",
  "refresh",
  "zap",
  "rocket",
  "stamp",
  "file",
  "play",
  "clock",
] as const;

export type ScriptIcon = (typeof SCRIPT_ICONS)[number];

/** Where a script runs: the session's shell drawer, or detached with a log */
export type ScriptRunIn = "terminal" | "background";

export interface ProjectScript {
  /** Stable within the file; the editor makes one from the name if missing */
  id: string;
  name: string;
  command: string;
  /** One of SCRIPT_ICONS; anything else draws the terminal icon */
  icon?: string;
  /** "Cmd+Shift+T" style (lib/script-shortcuts.ts) */
  shortcut?: string;
  /** Default "terminal" */
  in?: ScriptRunIn;
  /** Also run after the setup steps when a worktree is created */
  onWorktree?: boolean;
}

/** A default permission mode looser than asking first, if the file sets one */
export function looserDefaultMode(config: AgentOsConfig): string | undefined {
  const mode = config.defaults?.permissionMode;
  return typeof mode === "string" && mode !== "manual" ? mode : undefined;
}

/**
 * Whether the files hold anything that needs the user's approval: setup
 * steps and scripts run, and a default permission mode lets new sessions
 * act unasked. Server (trust) and client (the prompt) share this rule.
 */
export function canRun(config: AgentOsConfig): boolean {
  return (
    (Array.isArray(config.setup) &&
      config.setup.some((s) => typeof s === "string" && s.trim())) ||
    (Array.isArray(config.scripts) && config.scripts.length > 0) ||
    looserDefaultMode(config) !== undefined
  );
}

export interface AgentOsConfig {
  scripts?: ProjectScript[];
  previewUrl?: string;
  /** Worktree setup steps (legacy key, kept) */
  setup?: string[];
  /** Legacy, kept */
  devServer?: { command: string; portEnvVar?: string };
  defaults?: { agent?: string; model?: string; permissionMode?: Mode };
  /** Unknown keys are kept on write */
  [k: string]: unknown;
}

/** GET /api/projects/[id]/config */
export interface ProjectConfigResponse {
  /** `.agent-os.json` as read (legacy setup/devServer merged in when they win) */
  config: AgentOsConfig;
  /** Absolute path of `.agent-os.json` */
  path: string;
  /** Whether `.agent-os.json` exists */
  exists: boolean;
  /** sha256 hex of the config sources (see configHash); "" when neither exists */
  hash: string;
  /** The user approved this hash, or nothing in the files can run */
  trusted: boolean;
  /** Set when `.agent-os/worktrees.json` exists and supplies setup/devServer */
  legacy: {
    path: string;
    setup?: string[];
    devServer?: AgentOsConfig["devServer"];
  } | null;
  /** The defaults a new session gets (file defaults, Full access dropped unless the user chose it in the UI) */
  defaults: ResolvedProjectDefaults;
  /** The file's text as on disk, for the D-Config preview diff ("" if none) */
  text: string;
}

export interface ResolvedProjectDefaults {
  agent?: string;
  model?: string;
  permissionMode?: Mode;
}

/** PUT /api/projects/[id]/config (requireUser) */
export interface PutProjectConfigBody {
  config: AgentOsConfig;
  /** ProjectConfigResponse.hash the edit started from; 409 if it moved */
  baseHash: string;
  /** The user picked Full access in the UI (kept in the DB, not the file) */
  allowFullAccess?: boolean;
}

/** PUT 200; the saved file is trusted only if the one it replaced was */
export interface PutProjectConfigResponse {
  hash: string;
  trusted: boolean;
}

/** PUT 409 */
export interface ConfigConflictError {
  error: "conflict";
  hash: string;
}

/** POST /api/projects/[id]/trust (requireUser) */
export interface TrustConfigBody {
  hash: string;
}

export type ScriptRunStatus = "running" | "passed" | "failed" | "stopped";

/** A script_runs row (migration 27), as the API returns it */
export interface ScriptRun {
  id: string;
  project_id: string;
  script_id: string;
  command: string;
  status: ScriptRunStatus;
  exit_code: number | null;
  pid: number | null;
  /** null for terminal runs */
  log_path: string | null;
  /** Epoch ms, as session_queue and session_turns */
  started_at: number;
  finished_at: number | null;
}

/** POST /api/projects/[id]/scripts/[scriptId]/run (requireUser) */
export interface RunScriptBody {
  /** The session whose shell drawer runs a terminal script; none = background */
  sessionId?: string;
}

export interface RunScriptResponse {
  runId: string;
  in: ScriptRunIn;
  /**
   * Terminal runs: the line to type into the shell drawer. It wraps the
   * command so its exit code lands where lib/script-runs.ts finds it
   */
  shellCommand?: string;
}

/** POST .../run 409 when the file's hash isn't approved */
export interface UntrustedConfigError {
  error: "untrusted";
  hash: string;
}

/** GET /api/projects/[id]/scripts/runs: the last run of each script */
export interface ScriptRunsResponse {
  runs: Record<string, ScriptRun>;
}

/** GET /api/script-runs/[runId]/log?lines=N */
export interface ScriptRunLogResponse {
  lines: string[];
}
