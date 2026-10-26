import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { expandPath } from "@/lib/git-status";

const execFileAsync = promisify(execFile);

type SuggestionKind = "changed" | "recent" | "match";

interface FileSuggestion {
  /** Relative to cwd; directories end in "/" */
  path: string;
  kind: SuggestionKind;
  /** git's two-letter porcelain code, for changed files */
  status?: string;
}

const MAX_FILES = 20_000;
const RECENT = 15;
const LIST_TTL = 30_000;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build"]);

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 5_000,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Changed files under cwd, as git status lists them (renames by their new
 * path). null outside a git repository.
 */
async function changedFiles(cwd: string): Promise<FileSuggestion[] | null> {
  const [prefixOut, out] = await Promise.all([
    git(cwd, ["rev-parse", "--show-prefix"]),
    git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  if (prefixOut === null || out === null) return null;
  // Porcelain paths are relative to the repo root, not to cwd
  const prefix = prefixOut.trim();
  const parts = out.split("\0");
  const files: FileSuggestion[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    // -z puts a rename's old path in the next field
    if (status[0] === "R" || status[0] === "C") i++;
    const file = entry.slice(3);
    if (!file.startsWith(prefix)) continue;
    files.push({ path: file.slice(prefix.length), kind: "changed", status });
  }
  return files;
}

/** Fallback outside git: a shallow walk that skips the usual heavy folders */
function walk(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 6) visit(full, depth + 1);
      } else if (e.isFile()) {
        files.push(path.relative(root, full));
      }
    }
  };
  visit(root, 0);
  return files;
}

interface FileIndex {
  at: number;
  files: string[];
  dirs: string[];
  /** Most recently modified first */
  recent: string[];
}

const indexCache = new Map<string, FileIndex>();

/** Every file in the project (tracked + untracked, minus ignored), cached */
async function fileIndex(cwd: string, isGit: boolean): Promise<FileIndex> {
  const hit = indexCache.get(cwd);
  if (hit && Date.now() - hit.at < LIST_TTL) return hit;

  const listed = isGit
    ? await git(cwd, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ])
    : null;
  const files = (listed !== null ? [...new Set(listed.split("\0"))] : walk(cwd))
    .filter(Boolean)
    .slice(0, MAX_FILES);

  const dirs = new Set<string>();
  for (const f of files) {
    for (let d = path.dirname(f); d !== "."; d = path.dirname(d)) {
      if (dirs.has(d)) break;
      dirs.add(d);
    }
  }

  const stamped = await Promise.all(
    files.map(async (f) => {
      try {
        return { f, t: (await fs.promises.stat(path.join(cwd, f))).mtimeMs };
      } catch {
        return { f, t: 0 }; // Deleted but still tracked
      }
    })
  );
  const recent = stamped
    .filter((s) => s.t > 0)
    .sort((a, b) => b.t - a.t)
    .slice(0, RECENT)
    .map((s) => s.f);

  const index = {
    at: Date.now(),
    files,
    dirs: [...dirs].map((d) => d + "/"),
    recent,
  };
  if (indexCache.size > 20) indexCache.clear();
  indexCache.set(cwd, index);
  return index;
}

/**
 * Fuzzy score of a path against the query: every query character must
 * appear in order; runs, word starts and the file name score higher.
 * Returns -1 for no match.
 */
function score(candidate: string, q: string): number {
  const s = candidate.toLowerCase();
  const base = s.lastIndexOf("/", s.length - 2) + 1;
  const exact = s.indexOf(q);
  if (exact >= 0) {
    return 1000 + (exact >= base ? 500 : 0) - s.length;
  }
  let total = 0;
  let run = 0;
  let from = 0;
  for (const ch of q) {
    const i = s.indexOf(ch, from);
    if (i < 0) return -1;
    run = i === from ? run + 1 : 0;
    // Scattered letters match almost anything; gaps cost
    total += 1 + run * 2 - Math.min(i - from, 10) * 0.2;
    if (i === 0 || "/._-".includes(s[i - 1])) total += 3;
    if (i >= base) total += 1;
    from = i + 1;
  }
  return total - s.length / 100;
}

/**
 * GET /api/files/suggest?cwd=...&q=...&limit=30
 * "@" suggestions: changed files first, then recently modified, then fuzzy
 * path matches (files and folders)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawCwd = params.get("cwd");
  if (!rawCwd) {
    return NextResponse.json(
      { error: "cwd parameter is required" },
      { status: 400 }
    );
  }
  const cwd = path.resolve(expandPath(rawCwd));
  const q = (params.get("q") ?? "").trim().replace(/^@/, "").toLowerCase();
  const limit = Math.min(
    Math.max(parseInt(params.get("limit") || "30", 10) || 30, 1),
    200
  );

  try {
    if (!fs.statSync(cwd).isDirectory()) throw new Error("not a directory");
  } catch {
    return NextResponse.json({ error: "cwd not found" }, { status: 400 });
  }

  try {
    const changed = await changedFiles(cwd);
    const index = await fileIndex(cwd, changed !== null);
    // Changed and recent files jump the queue only on a close match: the
    // query in the path, or all of it within the file name
    const matches = (p: string) => {
      if (!q) return true;
      const lower = p.toLowerCase();
      const name = lower.slice(lower.lastIndexOf("/", lower.length - 2) + 1);
      return lower.includes(q) || score(name, q) >= 0;
    };

    const out: FileSuggestion[] = [];
    const seen = new Set<string>();
    const add = (s: FileSuggestion) => {
      if (out.length >= limit || seen.has(s.path)) return;
      seen.add(s.path);
      out.push(s);
    };

    for (const c of changed ?? []) if (matches(c.path)) add(c);
    for (const p of index.recent)
      if (matches(p)) add({ path: p, kind: "recent" });
    if (q) {
      [...index.files, ...index.dirs]
        .map((p) => ({ p, s: score(p, q) }))
        .filter((m) => m.s >= 0)
        .sort((a, b) => b.s - a.s)
        .forEach((m) => add({ path: m.p, kind: "match" }));
    }

    return NextResponse.json({ files: out, git: changed !== null });
  } catch (error) {
    console.error("Error suggesting files:", error);
    return NextResponse.json(
      { error: "Failed to suggest files" },
      { status: 500 }
    );
  }
}
