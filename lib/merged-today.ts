/**
 * A project's pull requests merged today (Closed-Project's "Merged today"),
 * from `gh pr list --state merged` run with execFile in the project's
 * folder, cached five minutes per folder. M1b U1b.1 implements it.
 */

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

/** Newest first; [] when it isn't a GitHub repo or gh can't answer */
export async function mergedToday(dir: string): Promise<MergedPr[]> {
  void dir;
  return [];
}
