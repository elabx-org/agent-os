import fs from "fs";
import os from "os";
import path from "path";

import type { Session } from "./db";
import { getProject, getProjectSessions } from "./projects";
import { readClaudeSessionMeta } from "./claude-transcript";

/*
 * Sessions in the same project know about each other: a Claude session in a
 * project starts with a note naming the other sessions and how to reach them
 * (Claude Code's own ListAgents / SendMessage). The note lives under
 * $AGENT_OS_HOME, never in the repo, and is read once when the session starts.
 */

function contextDir(): string {
  const home =
    process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  return path.join(home, "project-context");
}

function tmuxNameOf(session: Session): string {
  return session.tmux_name || `${session.agent_type || "claude"}-${session.id}`;
}

function home(dir: string): string {
  const h = os.homedir();
  return dir.startsWith(h) ? "~" + dir.slice(h.length) : dir;
}

/** Writes the session's project note and returns its path, or null when it has none */
export async function writeProjectContext(
  session: Session
): Promise<string | null> {
  const file = path.join(contextDir(), `${session.id}.md`);
  const project =
    session.agent_type === "claude" && session.project_id
      ? getProject(session.project_id)
      : undefined;
  const others = project
    ? getProjectSessions(project.id).filter(
        (s) => s.id !== session.id && s.agent_type !== "shell"
      )
    : [];

  if (!project || project.is_uncategorized || others.length === 0) {
    fs.rmSync(file, { force: true });
    return null;
  }

  const rows = await Promise.all(
    others.map(async (s) => {
      const tmux = tmuxNameOf(s);
      const meta =
        s.agent_type === "claude" ? await readClaudeSessionMeta(tmux) : null;
      const where = [
        home(s.worktree_path || s.working_directory || "~"),
        s.branch_name ? `branch ${s.branch_name}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      const reach =
        s.agent_type !== "claude"
          ? `a ${s.agent_type} session, not reachable by message`
          : meta?.name
            ? `running; in ListAgents as "${meta.name}" (tmux ${tmux})`
            : `not running now; in ListAgents by tmux ${tmux} once it starts`;
      return `- "${s.name}" (${where}): ${reach}`;
    })
  );

  const note = `# Agent-OS project: ${project.name}

You are the Agent-OS session "${session.name}", working in ${home(session.worktree_path || session.working_directory || "~")}. The user groups related work into projects; these other sessions are in this one, working on related code:

${rows.join("\n")}

They are other Claude Code sessions on this machine. When something you do matters to one of them (an API or data shape they use, a shared design pattern, naming, a decision the user made), tell it with SendMessage. When you need to know how the other side does something, ask it rather than guess. Find them with ListAgents (the names above can change; the tmux name is stable).

- Keep messages short, and only send what is relevant to the other session.
- Don't ask another session to do work or change its code, and don't change its files. If something needs doing on the other side, tell the user.
- A reply arrives as a message at the end of the other session's turn. Don't wait idle for one.

This list was written when this session started; ListAgents shows who is running now.
`;
  fs.mkdirSync(contextDir(), { recursive: true });
  fs.writeFileSync(file, note, { mode: 0o600 });
  return file;
}
