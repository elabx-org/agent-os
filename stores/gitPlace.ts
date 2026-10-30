import type { AnyGitFile } from "@/components/GitPanel/useGitModel";

/**
 * What a session's git view has open: its tab, a diff or a commit and the
 * commit's opened files. The view remounts when the Duo folds or the phone
 * turns, so it is kept here (and in sessionStorage, this tab only, for a
 * reload) rather than in the view
 */
export interface GitPlace {
  tab: "changes" | "history" | "stashes";
  file: AnyGitFile | null;
  commitHash: string | null;
}

const KEY = "agentos:gitPlace";

interface Saved {
  /** By session (or folder, without one) */
  places: Record<string, GitPlace>;
  /** `${hash}:${path}` of the commit files opened to their diff */
  commitFiles: string[];
}

let saved: Saved | null = null;

function load(): Saved {
  if (saved) return saved;
  saved = { places: {}, commitFiles: [] };
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    if (parsed?.places && typeof parsed.places === "object")
      saved.places = parsed.places;
    if (Array.isArray(parsed?.commitFiles))
      saved.commitFiles = parsed.commitFiles;
  } catch {
    // None kept
  }
  return saved;
}

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(load()));
  } catch {
    // Kept until a reload only
  }
}

export function gitPlace(key: string): GitPlace | null {
  return load().places[key] ?? null;
}

export function setGitPlace(key: string, place: GitPlace) {
  const places = load().places;
  const was = places[key];
  if (
    was &&
    was.tab === place.tab &&
    was.commitHash === place.commitHash &&
    was.file?.path === place.file?.path &&
    was.file?.staged === place.file?.staged
  )
    return;
  places[key] = place;
  save();
}

export function commitFileOpen(hash: string, path: string): boolean {
  return load().commitFiles.includes(`${hash}:${path}`);
}

export function setCommitFileOpen(hash: string, path: string, open: boolean) {
  const id = `${hash}:${path}`;
  const files = load().commitFiles.filter((f) => f !== id);
  // The latest few: a reload needs the commit you were in, not every one
  load().commitFiles = open ? [...files, id].slice(-20) : files;
  save();
}
