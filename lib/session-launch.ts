import { execFile } from "child_process";
import { promisify } from "util";
import * as os from "os";
import { getDb, queries, type Session } from "./db";
import { getProvider } from "./providers";
import { getProviderDefinition } from "./providers/registry";
import { writeProjectContext } from "./project-context";
import { writeInitScript } from "./init-script";
import { sessionBrowserEnv, tmuxEnvArgs } from "./browser-helper";
import { getFlag } from "./flags";
import type { LaunchCaps } from "./permission-mode";

const execFileAsync = promisify(execFile);

export function tmuxNameOf(session: Session): string {
  return session.tmux_name || `${session.agent_type || "claude"}-${session.id}`;
}

export async function isRunning(session: Session): Promise<boolean> {
  try {
    await execFileAsync("tmux", [
      "has-session",
      "-t",
      `=${tmuxNameOf(session)}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

/** What tmux runs for a session, and where */
export interface LaunchCommand {
  /** The session's tmux name */
  name: string;
  /** Its folder, ~ expanded */
  cwd: string;
  /**
   * The init script that starts the agent with the session's flags
   * (resume, mode, model, effort); null for a plain shell
   */
  command: string | null;
}

/**
 * The command a session's agent starts with, as launchSession runs it.
 * Records the launch's capabilities (sessions.launch_caps) like a launch
 * does. Also used to relaunch it in place (`tmux respawn-pane`, M5)
 */
export async function buildLaunchCommand(
  session: Session,
  initialPrompt?: string
): Promise<LaunchCommand> {
  const provider = getProvider(session.agent_type || "claude");
  const name = tmuxNameOf(session);
  const cwd = (session.working_directory || "~").replace(/^~/, os.homedir());

  if (provider.id === "shell") return { name, cwd, command: null };

  let parentSessionId: string | null = null;
  if (!session.claude_session_id && session.parent_session_id) {
    const parent = queries
      .getSession(getDb())
      .get(session.parent_session_id) as Session | undefined;
    parentSessionId = parent?.claude_session_id || null;
  }

  const providerDef = getProviderDefinition(session.agent_type || "claude");
  const nativeWorktreeName =
    session.branch_name && !session.worktree_path && providerDef.worktreeFlag
      ? session.branch_name
      : undefined;

  let systemPromptFile: string | undefined;
  let settingsFile: string | undefined;
  if (provider.id === "claude") {
    try {
      const context = await writeProjectContext(session);
      systemPromptFile = context.file || undefined;
      settingsFile = context.settings || undefined;
    } catch {
      // Starts without the note
    }
  }

  // Full access joins Shift+Tab only when the user opted in (Labs): any
  // agent could press it in its own tmux
  const caps: LaunchCaps = {
    allowBypassCycle: provider.id === "claude" && getFlag("liveFullAccess"),
  };
  queries
    .updateSessionLaunchCaps(getDb())
    .run(JSON.stringify(caps), session.id);

  const flags = provider.buildFlags({
    systemPromptFile,
    settingsFile,
    sessionId: session.claude_session_id,
    parentSessionId,
    autoApprove: session.auto_approve,
    permissionMode: session.permission_mode,
    allowBypassCycle: caps.allowBypassCycle,
    continueSession: session.continue_session,
    model: session.model,
    modelPinned: !!session.model_pinned,
    effort: session.effort,
    initialPrompt,
    worktreeName: nativeWorktreeName,
  });
  const command = writeInitScript(`${provider.command} ${flags.join(" ")}`);
  return { name, cwd, command };
}

/**
 * Starts a session's agent in a detached tmux, as the page does when it
 * opens one (app/page.tsx buildSessionCommand), so it runs with nobody
 * watching; opening it later attaches to the same tmux session.
 * False when it was already running.
 */
export async function launchSession(
  session: Session,
  initialPrompt?: string
): Promise<boolean> {
  if (await isRunning(session)) return false;

  const { name, cwd, command } = await buildLaunchCommand(
    session,
    initialPrompt
  );

  if (command === null) {
    await execFileAsync("tmux", [
      "new-session",
      "-d",
      "-s",
      name,
      "-c",
      cwd,
      ...tmuxEnvArgs(sessionBrowserEnv(), process.env.BROWSER),
    ]);
    return true;
  }

  await execFileAsync("tmux", [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    cwd,
    "-x",
    "200",
    "-y",
    "50",
    command,
  ]);
  return true;
}
