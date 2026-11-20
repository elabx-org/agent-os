/**
 * The folder a machine keeps its repositories in: where a session that
 * continues here looks for its repository, and where one is cloned when
 * the machine doesn't have it. One setting per machine. No server imports.
 */

export const REPOS_DIR_PREFERENCE_KEY = "repos_dir";
export const DEFAULT_REPOS_DIR = "~/AgentOS";

/**
 * Inside the repositories folder: the working folders of sessions that
 * continued on this machine (each a git worktree of a repository there)
 */
export const SESSIONS_FOLDER = ".sessions";
/** Marks a SESSIONS_FOLDER as AgentOS's own, so its folders may be removed */
export const SESSIONS_MARKER = ".agentos";

/** A folder the setting accepts ("~", "~/code", "/srv/code"), else null */
export function normalizeReposDir(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\/+$/, "");
  if (!text || text.length > 1024 || /[\0\r\n]/.test(text)) return null;
  if (text !== "~" && !text.startsWith("~/") && !text.startsWith("/")) {
    return null;
  }
  if (text.split("/").includes("..")) return null;
  return text;
}

/** The setting as an absolute path on this machine */
export function expandReposDir(value: string, home: string): string {
  if (value === "~") return home;
  return value.startsWith("~/") ? `${home}/${value.slice(2)}` : value;
}

/** A path as the user reads it: their home folder written "~" */
export function tildePath(folder: string, home?: string): string {
  if (home && (folder === home || folder.startsWith(`${home}/`))) {
    return `~${folder.slice(home.length)}`;
  }
  return folder.replace(/^\/(Users|home)\/[^/]+/, "~");
}

/** Where a session would land on a machine, asked before it moves */
export interface MovePlan {
  /** return: its old folder; existing: a copy already there; clone: a new one */
  mode: "return" | "existing" | "clone";
  folder: string;
  /** The machine's repositories folder, as the user set it */
  reposDir: string;
}
