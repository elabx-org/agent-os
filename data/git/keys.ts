export const gitKeys = {
  all: ["git"] as const,
  status: (workingDir: string) =>
    [...gitKeys.all, "status", workingDir] as const,
  multiStatus: (projectId: string, fallbackPath?: string) =>
    [...gitKeys.all, "multi-status", projectId, fallbackPath || ""] as const,
  pr: (workingDir: string) => [...gitKeys.all, "pr", workingDir] as const,
  history: (workingDir: string) =>
    [...gitKeys.all, "history", workingDir] as const,
  commitDetail: (workingDir: string, hash: string) =>
    [...gitKeys.all, "commit", workingDir, hash] as const,
  commitFileDiff: (workingDir: string, hash: string, file: string) =>
    [...gitKeys.all, "diff", workingDir, hash, file] as const,
  branches: (workingDir: string) =>
    [...gitKeys.all, "branches", workingDir] as const,
  stash: (workingDir: string) =>
    [...gitKeys.all, "stash", workingDir] as const,
  stashDetail: (workingDir: string, index: number) =>
    [...gitKeys.all, "stash", workingDir, index] as const,
  prDetail: (workingDir: string, prNumber: number) =>
    [...gitKeys.all, "pr-detail", workingDir, prNumber] as const,
  prComments: (workingDir: string, prNumber: number) =>
    [...gitKeys.all, "pr-comments", workingDir, prNumber] as const,
  prDiff: (workingDir: string, prNumber: number) =>
    [...gitKeys.all, "pr-diff", workingDir, prNumber] as const,
  prFileDiff: (workingDir: string, prNumber: number, file: string) =>
    [...gitKeys.all, "pr-file-diff", workingDir, prNumber, file] as const,
};
