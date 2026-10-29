/**
 * GET /api/sessions/[id]/diff: one turn (pre..post), the branch (its
 * merge-base with the base branch to the working tree) or what is
 * uncommitted (HEAD to the working tree), untracked files as added.
 */

import fs from "fs";
import path from "path";
import type { Session } from "./db";
import { parseMultiDiff, type ParsedDiff } from "./diff-parser";
import type { SessionDiff } from "./turn-types";
import { sessionCwd, turnRange } from "./turns";
import { git, toplevel } from "./turns-git";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_UNTRACKED = 200;
const MAX_UNTRACKED_BYTES = 1024 * 1024;

const DIFF = ["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff"];

export class DiffRequestError extends Error {}

/** A repo-relative file inside the repo, or throws */
export function cleanFile(file: string | null): string | null {
  if (file === null || file === "") return null;
  const norm = path.posix.normalize(file.replace(/\\/g, "/"));
  if (
    file.includes("\0") ||
    path.posix.isAbsolute(norm) ||
    norm === ".." ||
    norm.startsWith("../")
  ) {
    throw new DiffRequestError("Bad file");
  }
  return norm;
}

export function parseScope(
  scope: string | null
): { kind: "turn"; turnNo: number } | { kind: "branch" | "uncommitted" } {
  if (scope === "branch" || scope === "uncommitted") return { kind: scope };
  const m = scope?.match(/^turn:(\d+)$/);
  if (m) return { kind: "turn", turnNo: Number(m[1]) };
  throw new DiffRequestError("Bad scope");
}

async function verify(cwd: string, ref: string): Promise<string | null> {
  try {
    return (
      await git(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { cwd })
    ).trim();
  } catch {
    return null;
  }
}

/** The session's base branch, else origin's default, else main/master */
async function baseRef(top: string, session: Session): Promise<string | null> {
  const names: string[] = [];
  if (session.base_branch) {
    names.push(session.base_branch, `origin/${session.base_branch}`);
  }
  try {
    const head = (
      await git(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"], {
        cwd: top,
      })
    ).trim();
    if (head) names.push(head);
  } catch {
    // No origin HEAD
  }
  names.push("main", "master", "origin/main", "origin/master");
  for (const name of names) {
    if (await verify(top, name)) return name;
  }
  return null;
}

async function untrackedDiffs(
  top: string,
  file: string | null
): Promise<ParsedDiff[]> {
  const out = await git(
    [
      "--literal-pathspecs",
      "ls-files",
      "-o",
      "--exclude-standard",
      "-z",
      "--",
      ...(file ? [file] : []),
    ],
    { cwd: top }
  );
  const diffs: ParsedDiff[] = [];
  for (const rel of out.split("\0").filter(Boolean).slice(0, MAX_UNTRACKED)) {
    let size: number;
    try {
      const st = fs.lstatSync(path.join(top, rel));
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    if (size > MAX_UNTRACKED_BYTES) {
      diffs.push({
        oldFile: rel,
        newFile: rel,
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: false,
        isNew: true,
        isDeleted: false,
        isRenamed: false,
      });
      continue;
    }
    const text = await git(
      [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-index",
        "--",
        "/dev/null",
        rel,
      ],
      { cwd: top, okCodes: [0, 1] }
    );
    diffs.push(...parseMultiDiff(text));
  }
  return diffs;
}

export async function sessionDiff(
  session: Session,
  scope: string | null,
  rawFile: string | null
): Promise<SessionDiff | null> {
  const which = parseScope(scope);
  const file = cleanFile(rawFile);
  const only = file ? ["--", file] : ["--"];

  if (which.kind === "turn") {
    const range = await turnRange(session, which.turnNo);
    if (!range) return null;
    if (!range.base) return { files: [], base: null, head: range.head };
    const top = await toplevel(range.cwd);
    if (!top) return { files: [], base: null, head: null };
    // A turn still running compares with the working tree
    const text = await git(
      [...DIFF, "-M", range.base, ...(range.head ? [range.head] : []), ...only],
      { cwd: top }
    );
    return { files: parseMultiDiff(text), base: range.base, head: range.head };
  }

  const top = await toplevel(sessionCwd(session));
  if (!top) return { files: [], base: null, head: null };
  let base: string | null;
  if (which.kind === "branch") {
    const ref = await baseRef(top, session);
    base = null;
    if (ref) {
      try {
        base = (await git(["merge-base", "HEAD", ref], { cwd: top })).trim();
      } catch {
        // Unrelated histories
      }
    }
    if (!base) return { files: [], base: null, head: null };
  } else {
    base = (await verify(top, "HEAD")) ?? EMPTY_TREE;
  }
  const text = await git([...DIFF, "-M", base, ...only], { cwd: top });
  return {
    files: [...parseMultiDiff(text), ...(await untrackedDiffs(top, file))],
    base,
    head: null,
  };
}
