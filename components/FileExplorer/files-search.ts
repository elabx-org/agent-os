/**
 * Files' search and the small path rules around it (E-Files, D-Files). Pure:
 * no fetches, no DOM.
 */

/** /api/files/suggest's entries: paths relative to the root, folders end "/" */
export interface SuggestEntry {
  path: string;
  kind: "changed" | "recent" | "match";
  status?: string;
}

/** /api/code-search's entries (paths as ripgrep prints them, "./a/b.ts") */
export interface CodeHit {
  file: string;
  line: number;
  lineText: string;
}

export interface FileResult {
  /** Relative to the root */
  path: string;
  changed: boolean;
}

export interface TextGroup {
  path: string;
  changed: boolean;
  hits: { line: number; text: string }[];
}

export interface SearchResults {
  files: FileResult[];
  text: TextGroup[];
}

export const MAX_FILE_RESULTS = 8;
export const MAX_TEXT_FILES = 8;
export const MAX_HITS_PER_FILE = 3;
const MAX_LINE = 160;

/** "./a/b.ts" or "/root/a/b.ts" -> "a/b.ts" */
export function relativeTo(root: string, file: string): string {
  const base = root.replace(/\/+$/, "");
  if (base && file.startsWith(base + "/")) return file.slice(base.length + 1);
  return file.replace(/^(\.\/)+/, "");
}

/**
 * One list from both searches: file names first (changed ones on top, the
 * suggest order otherwise), then text hits grouped by file in the order found,
 * changed files' groups first. Folders and repeated lines are dropped.
 */
export function mergeSearch(
  root: string,
  suggest: SuggestEntry[],
  hits: CodeHit[]
): SearchResults {
  const changed = new Set(
    suggest.filter((s) => s.kind === "changed").map((s) => s.path)
  );

  const seenFiles = new Set<string>();
  const files: FileResult[] = [];
  for (const s of suggest) {
    if (s.path.endsWith("/") || seenFiles.has(s.path)) continue;
    seenFiles.add(s.path);
    files.push({ path: s.path, changed: s.kind === "changed" });
  }
  // Stable: changed first, the rest keep suggest's ranking
  files.sort((a, b) => Number(b.changed) - Number(a.changed));

  const groups = new Map<string, TextGroup>();
  const seenLines = new Set<string>();
  for (const hit of hits) {
    const path = relativeTo(root, hit.file);
    const key = `${path}:${hit.line}`;
    if (!path || seenLines.has(key)) continue;
    seenLines.add(key);
    let group = groups.get(path);
    if (!group) {
      group = { path, changed: changed.has(path), hits: [] };
      groups.set(path, group);
    }
    if (group.hits.length >= MAX_HITS_PER_FILE) continue;
    group.hits.push({ line: hit.line, text: trimLine(hit.lineText) });
  }
  const text = [...groups.values()].sort(
    (a, b) => Number(b.changed) - Number(a.changed)
  );

  return {
    files: files.slice(0, MAX_FILE_RESULTS),
    text: text.slice(0, MAX_TEXT_FILES),
  };
}

function trimLine(text: string): string {
  const line = text.replace(/\r?\n$/, "").trim();
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 1) + "…" : line;
}

/** Ripgrep takes a regex: search for what was typed, literally */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first result Enter opens */
export function firstResult(
  results: SearchResults
): { path: string; line?: number } | null {
  if (results.files[0]) return { path: results.files[0].path };
  const group = results.text[0];
  if (group?.hits[0]) return { path: group.path, line: group.hits[0].line };
  return null;
}

/** Recently opened files, newest first, at most `max` */
export function pushRecent(list: string[], file: string, max = 8): string[] {
  return [file, ...list.filter((f) => f !== file)].slice(0, max);
}

/**
 * The breadcrumb under "Files": the project folder's name, then the current
 * folder's segments below it; outside the project, the absolute path
 */
export function breadcrumb(
  projectRoot: string,
  current: string
): { label: string; path: string }[] {
  const root = projectRoot.replace(/\/+$/, "") || "/";
  const here = current.replace(/\/+$/, "") || "/";
  if (here === root || here.startsWith(root === "/" ? "/" : root + "/")) {
    const crumbs = [{ label: baseName(root) || "/", path: root }];
    let at = root;
    for (const seg of here.slice(root.length).split("/").filter(Boolean)) {
      at = at === "/" ? `/${seg}` : `${at}/${seg}`;
      crumbs.push({ label: seg, path: at });
    }
    return crumbs;
  }
  const crumbs = [{ label: "/", path: "/" }];
  let at = "";
  for (const seg of here.split("/").filter(Boolean)) {
    at += `/${seg}`;
    crumbs.push({ label: seg, path: at });
  }
  return crumbs;
}

export function baseName(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/**
 * A new file's name as typed (it may name subfolders): why it can't be used,
 * or null. Existence is checked by the caller.
 */
export function newFileNameError(name: string): string | null {
  const n = name.trim();
  if (!n) return "Type a name";
  if (n.startsWith("/") || n.startsWith("~") || /^[a-zA-Z]:[\\/]/.test(n))
    return "Use a name inside this folder, not an absolute path";
  if (n.endsWith("/")) return "That's a folder: add a file name";
  if (n.split(/[\\/]/).some((seg) => seg === ".." || seg === "."))
    return "Use a name inside this folder";
  if (n.includes("\0")) return "That name has a character files can't use";
  return null;
}
