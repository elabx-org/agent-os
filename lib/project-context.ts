import fs from "fs";
import os from "os";
import path from "path";

import type { Project, Session } from "./db";
import { getProject, getProjectSessions } from "./projects";
import { readClaudeSessionMeta } from "./claude-transcript";
import { parseProjectHooks } from "./project-hooks";
import { withClaudeState, type HookGroup } from "./claude-state";

export { parseProjectHooks } from "./project-hooks";

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

/** The project's instructions as last saved, for the hook that passes on changes */
function instructionsFile(projectId: string): string {
  return path.join(contextDir(), "instructions", `${projectId}.md`);
}

/** The instructions a session has already been given */
function seenFile(sessionId: string): string {
  return path.join(contextDir(), "seen", `${sessionId}.md`);
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
    ? `You are the AgentOS session "${session.name}", working in ${folderOf(session)}, in the user's project "${project.name}".`
    : `You are an AgentOS session in the user's project "${project.name}".`;
  const sections = [`# AgentOS project: ${project.name}`, you];

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

/** Keep the file the instructions hook reads in step with the database */
export function syncInstructionsFile(project: Project | undefined): void {
  if (!project) return;
  const file = instructionsFile(project.id);
  const text = project.instructions?.trim();
  if (!text) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text + "\n", { mode: 0o600 });
}

/*
 * Claude Code runs this before each message the user sends. When the
 * project's instructions changed since the session last saw them, its output
 * goes to Claude with the message; otherwise it prints nothing.
 */
const INSTRUCTIONS_HOOK = `#!/bin/bash
# AgentOS: pass changed project instructions to a running session
dir="$(dirname "$0")"
cur="$dir/instructions/$1.md"
seen="$dir/seen/$2.md"
cat > /dev/null
if [ -f "$cur" ]; then
  cmp -s "$cur" "$seen" 2>/dev/null && exit 0
  mkdir -p "$dir/seen" && cp "$cur" "$seen"
  printf 'The user updated the project instructions. They now read:\\n\\n'
  cat "$cur"
elif [ -f "$seen" ]; then
  rm -f "$seen"
  echo "The user removed the project instructions."
fi
`;

/** Claude Code settings for a session in the project: its hooks */
function sessionSettings(project: Project, session: Session) {
  const hooks: Record<string, HookGroup[]> = {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: `bash '${path.join(contextDir(), "instructions-hook.sh")}' '${project.id}' '${session.id}'`,
          },
        ],
      },
    ],
  };
  for (const hook of parseProjectHooks(project.hooks)) {
    (hooks[hook.event] ??= []).push({
      ...(hook.matcher ? { matcher: hook.matcher } : {}),
      hooks: [{ type: "command", command: hook.command }],
    });
  }
  return { hooks };
}

/**
 * Writes what a Claude session starts with: its project note (null when it
 * has none) and its settings (the project's hooks, and the hooks and status
 * line that record Claude's state for every session)
 */
export async function writeProjectContext(
  session: Session
): Promise<{ file: string | null; settings: string | null }> {
  const file = path.join(contextDir(), `${session.id}.md`);
  const settingsFile = path.join(contextDir(), `${session.id}.settings.json`);
  if (session.agent_type !== "claude") {
    fs.rmSync(file, { force: true });
    fs.rmSync(settingsFile, { force: true });
    return { file: null, settings: null };
  }
  const project = session.project_id
    ? getProject(session.project_id)
    : undefined;
  if (!project || project.is_uncategorized) {
    fs.rmSync(file, { force: true });
    fs.mkdirSync(contextDir(), { recursive: true });
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(withClaudeState(session.id, {}), null, 2),
      { mode: 0o600 }
    );
    return { file: null, settings: settingsFile };
  }

  fs.mkdirSync(suggestionsDir(project.id), { recursive: true });
  fs.mkdirSync(path.dirname(seenFile(session.id)), { recursive: true });

  // The note carries the instructions as they are now: the hook only
  // speaks up when they change after this
  syncInstructionsFile(project);
  const current = instructionsFile(project.id);
  if (fs.existsSync(current)) fs.copyFileSync(current, seenFile(session.id));
  else fs.rmSync(seenFile(session.id), { force: true });

  fs.writeFileSync(
    path.join(contextDir(), "instructions-hook.sh"),
    INSTRUCTIONS_HOOK,
    { mode: 0o700 }
  );
  fs.writeFileSync(
    settingsFile,
    JSON.stringify(
      withClaudeState(session.id, sessionSettings(project, session)),
      null,
      2
    ),
    { mode: 0o600 }
  );

  const note = await buildProjectNote(project, session);
  if (note) fs.writeFileSync(file, note, { mode: 0o600 });
  else fs.rmSync(file, { force: true });
  return { file: note ? file : null, settings: settingsFile };
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
