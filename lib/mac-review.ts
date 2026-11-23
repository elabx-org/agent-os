/**
 * The Mac window's review bar: what the working tree's changes add up to.
 * A file changed both staged and unstaged counts once.
 */
export interface ReviewTotals {
  files: number;
  additions: number;
  deletions: number;
}

export function reviewTotals<
  F extends { path: string; additions?: number; deletions?: number },
>(files: readonly F[], repoOf: (file: F) => string = () => ""): ReviewTotals {
  const seen = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    seen.add(`${repoOf(file)}\0${file.path}`);
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }
  return { files: seen.size, additions, deletions };
}
