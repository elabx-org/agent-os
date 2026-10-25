import fs from "fs";
import os from "os";
import path from "path";

import type { Project, Session } from "./db";
import { getProject, getProjectSessions } from "./projects";
import { readClaudeSessionMeta } from "./claude-transcript";

/*
 * Sessions in the same project know about each other: a Claude session in a
 * project starts with a note giving the project's instructions, naming the
 * other sessions and how to reach them (Claude Code's own ListAgents /
 * SendMessage). The note lives under $AGENT_OS_HOME, never in the repo, and
 * is read once when the session starts.
 *
 * Sessions can suggest additions to the instructions by dropping a file in
 * the project's suggestions folder; the user accepts or dismisses each one.
 */

function contextDir(): string {
  const home =
    process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  return path.join(home, "project-context");
}

function suggestionsDir(projectId: string): string {
  return path.join(contextDir(), "suggestions", projectId);
}

function tmuxNameOf(session: Session): string {
  return session.tmux_name || `${session.agent_type || "claude"}-${session.id}`;
}

function home(dir: string): string {
  const h = os.homedir();
  return dir.startsWith(h) ? "~" + dir.slice(h.length) : dir;
}

function folderOf(session: Session): string {
  return home(session.worktree_path || session.working_directory || "~");
}

/** The note a session in this project starts with; `session` null for a preview */
export async function buildProjectNote(
  project: Project,
  session: Session | null
): Promise<string | null> {
  if (project.is_uncategorized) return null;
  const others = getProjectSessions(project.id).filter(
    (s) => s.id !== session?.id && s.agent_type !== "shell"
  );
  const instructions = project.instructions?.trim();
  if (!instructions && others.length === 0) return null;

  const rows = await Promise.all(
    others.map(async (s) => {
      const tmux = tmuxNameOf(s);
      const meta =
        s.agent_type === "claude" ? await readClaudeSessionMeta(tmux) : null;
      const where = [
        folderOf(s),
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

  const you = session
    ? `You are the Agent-OS session "${session.name}", working in ${folderOf(session)}, in the user's project "${project.name}".`
    : `You are an Agent-OS session in the user's project "${project.name}".`;
  const sections = [`# Agent-OS project: ${project.name}`, you];

  if (instructions) {
    sections.push(
      `## Project instructions\n\nThe user's standing instructions for every session in this project:\n\n${instructions}`
    );
  }

  if (rows.length) {
    sections.push(`## Other sessions in this project

${rows.join("\n")}

They are other Claude Code sessions on this machine, working on related code. When something you do matters to one of them (an API or data shape they use, a shared design pattern, naming, a decision the user made), tell it with SendMessage. When you need to know how the other side does something, ask it rather than guess. Find them with ListAgents (the names above can change; the tmux name is stable).

- Keep messages short, and only send what is relevant to the other session.
- Don't ask another session to do work or change its code, and don't change its files. If something needs doing on the other side, tell the user.
- A reply arrives as a message at the end of the other session's turn. Don't wait idle for one.

This list was written when this session started; ListAgents shows who is running now.`);
  }

  const dropFile = path.join(
    suggestionsDir(project.id),
    `${session?.id ?? "<session id>"}-<short-name>.md`
  );
  sections.push(`## Suggesting an instruction

When the user settles something every session in this project should follow (a design rule, a convention, which side leads), suggest it as a project instruction: write one short instruction, in plain words, to a new file ${dropFile}. The user reviews each suggestion. Don't suggest what the instructions above already say, and don't suggest more than one thing per file.`);

  return sections.join("\n\n") + "\n";
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
  const note = project ? await buildProjectNote(project, session) : null;
  if (!note) {
    fs.rmSync(file, { force: true });
    return null;
  }
  fs.mkdirSync(suggestionsDir(project!.id), { recursive: true });
  fs.writeFileSync(file, note, { mode: 0o600 });
  return file;
}

export interface Suggestion {
  id: string;
  text: string;
  from: string | null;
  created_at: string;
}

const SUGGESTION_ID = /^[\w.-]+\.(md|txt)$/;

export function listSuggestions(projectId: string): Suggestion[] {
  const dir = suggestionsDir(projectId);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => SUGGESTION_ID.test(n));
  } catch {
    return [];
  }
  const sessions = getProjectSessions(projectId);
  return names
    .map((id) => {
      const file = path.join(dir, id);
      const text = fs.readFileSync(file, "utf8").trim().slice(0, 2000);
      const author = sessions.find((s) => id.startsWith(`${s.id}-`));
      return {
        id,
        text,
        from: author?.name ?? null,
        created_at: fs.statSync(file).mtime.toISOString(),
      };
    })
    .filter((s) => s.text)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Removes a suggestion and returns its text, or null if it's gone */
export function takeSuggestion(projectId: string, id: string): string | null {
  if (!SUGGESTION_ID.test(id)) return null;
  const file = path.join(suggestionsDir(projectId), id);
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    fs.rmSync(file);
    return text || null;
  } catch {
    return null;
  }
}
