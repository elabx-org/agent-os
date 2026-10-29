/**
 * The Changes page's list from a git status: one row per path, whether its
 * changes are staged, unstaged or both, and what Commit takes.
 */

import type { GitFile, GitStatus } from "@/lib/git-status";

export interface ChangedFile {
  path: string;
  /** The file's name and the folder it sits in ("" at the root) */
  name: string;
  folder: string;
  /** Staged and unstaged lines together; undefined when git gave none */
  additions?: number;
  deletions?: number;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf("/");
  return slash < 0
    ? { name: path, folder: "" }
    : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

function add(a: number | undefined, b: number | undefined) {
  return a === undefined ? b : b === undefined ? a : a + b;
}

/** Staged, unstaged and untracked as one list, each path once, in that order */
export function changedFiles(
  status: Pick<GitStatus, "staged" | "unstaged" | "untracked">
): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  const put = (f: GitFile, kind: "staged" | "unstaged" | "untracked") => {
    let row = byPath.get(f.path);
    if (!row) {
      row = {
        path: f.path,
        ...splitPath(f.path),
        staged: false,
        unstaged: false,
        untracked: false,
      };
      byPath.set(f.path, row);
    }
    row[kind] = true;
    row.additions = add(row.additions, f.additions);
    row.deletions = add(row.deletions, f.deletions);
  };
  for (const f of status.staged) put(f, "staged");
  for (const f of status.unstaged) put(f, "unstaged");
  for (const f of status.untracked) put(f, "untracked");
  return [...byPath.values()];
}

export function totals(files: ChangedFile[]): {
  additions: number;
  deletions: number;
} {
  return files.reduce(
    (t, f) => ({
      additions: t.additions + (f.additions ?? 0),
      deletions: t.deletions + (f.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 }
  );
}

/** The selection, or the first file once it's gone (or none was made) */
export function selectedPath(
  files: ChangedFile[],
  selected: string | null
): string | null {
  if (selected && files.some((f) => f.path === selected)) return selected;
  return files[0]?.path ?? null;
}

/**
 * What Commit takes: what's staged, or, with nothing staged, every listed
 * file (staged first, as `stage`)
 */
export function commitPlan(files: ChangedFile[]): {
  count: number;
  stage: string[];
} {
  const staged = files.filter((f) => f.staged).length;
  return staged > 0
    ? { count: staged, stage: [] }
    : { count: files.length, stage: files.map((f) => f.path) };
}

export function commitLabel(count: number): string {
  return `Commit ${count} ${count === 1 ? "file" : "files"}`;
}
