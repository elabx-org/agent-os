import { execFile } from "child_process";
import { promisify } from "util";
import * as os from "os";
import { getDb, queries, type Session } from "./db";
import { getProvider } from "./providers";
import { getProviderDefinition } from "./providers/registry";
import { writeProjectContext } from "./project-context";
import { writeInitScript } from "./init-script";
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

  const provider = getProvider(session.agent_type || "claude");
  const name = tmuxNameOf(session);
  const cwd = (session.working_directory || "~").replace(/^~/, os.homedir());

  if (provider.id === "shell") {
    await execFileAsync("tmux", ["new-session", "-d", "-s", name, "-c", cwd]);
    return true;
  }

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
    initialPrompt,
    worktreeName: nativeWorktreeName,
  });
  const command = writeInitScript(`${provider.command} ${flags.join(" ")}`);

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
