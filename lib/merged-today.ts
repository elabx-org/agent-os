/**
 * A project's pull requests merged today (Closed-Project's "Merged today"),
 * from `gh pr list --state merged` run with execFile in the project's
 * folder, cached five minutes per folder.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** One merged pull request */
export interface MergedPr {
  number: number;
  title: string;
  url: string;
  /** ISO time */
  mergedAt: string;
}

/** GET /api/projects/[id]/merged-today */
export interface MergedTodayResponse {
  prs: MergedPr[];
}

const CACHE_MS = 5 * 60 * 1000;
const GH_TIMEOUT_MS = 8000;
const LIMIT = 20;

// One cache for the server.ts and Next copies of this module
type Cache = Map<string, { at: number; prs: Promise<MergedPr[]> }>;
const store = globalThis as typeof globalThis & {
  __agentosMergedToday?: Cache;
};
const cache: Cache = (store.__agentosMergedToday ??= new Map());

/** A date as gh's search and the local calendar write it: YYYY-MM-DD */
function localDate(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * gh's JSON as the PRs merged on `today`'s local date, newest first; [] for
 * anything that isn't a list, and entries missing a field are skipped
 */
export function parseMergedPrs(json: string, today: Date): MergedPr[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const day = localDate(today);
  const prs: MergedPr[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const { number, title, url, mergedAt } = item as Record<string, unknown>;
    if (
      typeof number !== "number" ||
      typeof title !== "string" ||
      typeof url !== "string" ||
      typeof mergedAt !== "string"
    )
      continue;
    const at = new Date(mergedAt);
    if (isNaN(at.getTime()) || localDate(at) !== day) continue;
    prs.push({ number, title, url, mergedAt });
  }
  return prs.sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
}

async function fetchMerged(dir: string): Promise<MergedPr[]> {
  const today = new Date();
  // gh's merged: date is UTC; a day early still finds this morning's ones
  // ahead of UTC, and parseMergedPrs keeps only the local today
  const since = new Date(today);
  since.setDate(since.getDate() - 1);
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "merged",
        "--search",
        `merged:>=${localDate(since)}`,
        "--json",
        "number,title,url,mergedAt",
        "--limit",
        String(LIMIT),
      ],
      { cwd: dir, timeout: GH_TIMEOUT_MS, maxBuffer: 1024 * 1024 }
    );
    return parseMergedPrs(stdout, today);
  } catch {
    return [];
  }
}

/** Newest first; [] when it isn't a GitHub repo or gh can't answer */
export async function mergedToday(dir: string): Promise<MergedPr[]> {
  const now = Date.now();
  const hit = cache.get(dir);
  if (hit && now - hit.at < CACHE_MS) return hit.prs;
  // The promise is cached, so pages opening together share one gh run
  const prs = fetchMerged(dir);
  cache.set(dir, { at: now, prs });
  return prs;
}
