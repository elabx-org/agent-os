import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gitKeys } from "./keys";

// Re-export for convenience
export { gitKeys };
import type { CommitSummary, CommitDetail } from "@/lib/git-history";
import type { GitStatus, StashEntry } from "@/lib/git-status";
import type { MultiRepoGitStatus } from "@/lib/multi-repo-git";
import type { ProjectRepository } from "@/lib/db";

export interface PRInfo {
  number: number;
  url: string;
  state: string;
  title: string;
}

export interface PRData {
  branch: string;
  baseBranch: string;
  existingPR: PRInfo | null;
  commits: { hash: string; subject: string }[];
  suggestedTitle: string;
  suggestedBody: string;
}

// --- Git Status ---

async function fetchGitStatus(workingDir: string): Promise<GitStatus> {
  const res = await fetch(
    `/api/git/status?path=${encodeURIComponent(workingDir)}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function useGitStatus(
  workingDir: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: gitKeys.status(workingDir),
    queryFn: () => fetchGitStatus(workingDir),
    staleTime: 10000, // Consider fresh for 10s
    refetchInterval: 15000, // Poll every 15s (was 3s)
    enabled: !!workingDir && (options?.enabled ?? true),
  });
}

// --- PR Status ---

async function fetchPRData(workingDir: string): Promise<PRData | null> {
  const res = await fetch(`/api/git/pr?path=${encodeURIComponent(workingDir)}`);
  const data = await res.json();
  if (data.error) return null;
  return data;
}

export function usePRStatus(workingDir: string) {
  return useQuery({
    queryKey: gitKeys.pr(workingDir),
    queryFn: () => fetchPRData(workingDir),
    staleTime: 60000, // 1 minute - PR status doesn't change often
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    enabled: !!workingDir,
  });
}

// --- Mutations ---

export function useCreatePR(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // First get suggested content (with generate=true for AI generation)
      const infoRes = await fetch(
        `/api/git/pr?path=${encodeURIComponent(workingDir)}&generate=true`
      );
      const info = await infoRes.json();

      if (info.error) throw new Error(info.error);

      if (info.existingPR) {
        // PR already exists, just return it
        return { pr: info.existingPR, created: false };
      }

      // Create the PR with auto-generated content
      const createRes = await fetch("/api/git/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workingDir,
          title: info.suggestedTitle,
          description: info.suggestedBody,
          baseBranch: info.baseBranch,
        }),
      });

      const result = await createRes.json();
      if (result.error) throw new Error(result.error);

      return { pr: result.pr, created: true };
    },
    onSuccess: (data) => {
      // Open PR in browser
      if (data.pr?.url) {
        window.open(data.pr.url, "_blank");
      }
      // Invalidate PR status
      queryClient.invalidateQueries({ queryKey: gitKeys.pr(workingDir) });
    },
  });
}

export function useStageFiles(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files?: string[]) => {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, files }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.status(workingDir) });
    },
  });
}

export function useUnstageFiles(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files?: string[]) => {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, files }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.status(workingDir) });
    },
  });
}

export function useCommitAndPush(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      message,
      branchName,
      push = true,
    }: {
      message: string;
      branchName?: string;
      push?: boolean;
    }) => {
      // Commit
      const commitRes = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workingDir,
          message,
          branchName,
        }),
      });
      const commitData = await commitRes.json();
      if (!commitRes.ok || commitData.error) {
        throw new Error(commitData.error || "Commit failed");
      }

      // Push if requested
      if (push) {
        const pushRes = await fetch("/api/git/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: workingDir }),
        });
        const pushData = await pushRes.json();
        if (!pushRes.ok || pushData.error) {
          throw new Error(pushData.error || "Push failed");
        }
        return { commit: commitData, push: pushData };
      }

      return { commit: commitData };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.status(workingDir) });
      queryClient.invalidateQueries({ queryKey: gitKeys.pr(workingDir) });
      queryClient.invalidateQueries({ queryKey: gitKeys.history(workingDir) });
    },
  });
}

async function fetchCommitHistory(
  workingDir: string,
  limit: number = 30
): Promise<CommitSummary[]> {
  const res = await fetch(
    `/api/git/history?path=${encodeURIComponent(workingDir)}&limit=${limit}`
  );
  if (!res.ok) throw new Error("Failed to fetch commit history");
  const data = await res.json();
  return data.commits || [];
}

async function fetchCommitDetail(
  workingDir: string,
  hash: string
): Promise<CommitDetail> {
  const res = await fetch(
    `/api/git/history/${hash}?path=${encodeURIComponent(workingDir)}`
  );
  if (!res.ok) throw new Error("Failed to fetch commit detail");
  const data = await res.json();
  return data.commit;
}

async function fetchCommitFileDiff(
  workingDir: string,
  hash: string,
  file: string
): Promise<string> {
  const res = await fetch(
    `/api/git/history/${hash}/diff?path=${encodeURIComponent(workingDir)}&file=${encodeURIComponent(file)}`
  );
  if (!res.ok) throw new Error("Failed to fetch commit file diff");
  const data = await res.json();
  return data.diff || "";
}

export function useCommitHistory(workingDir: string, limit: number = 30) {
  return useQuery({
    queryKey: gitKeys.history(workingDir),
    queryFn: () => fetchCommitHistory(workingDir, limit),
    staleTime: 30000,
    enabled: !!workingDir,
  });
}

export function useCommitDetail(workingDir: string, hash: string | null) {
  return useQuery({
    queryKey: gitKeys.commitDetail(workingDir, hash || ""),
    queryFn: () => fetchCommitDetail(workingDir, hash!),
    staleTime: 60000, // Commit details don't change
    enabled: !!workingDir && !!hash,
  });
}

export function useCommitFileDiff(
  workingDir: string,
  hash: string | null,
  file: string | null
) {
  return useQuery({
    queryKey: gitKeys.commitFileDiff(workingDir, hash || "", file || ""),
    queryFn: () => fetchCommitFileDiff(workingDir, hash!, file!),
    staleTime: 60000, // Diffs don't change
    enabled: !!workingDir && !!hash && !!file,
  });
}

// --- Branches ---

async function fetchBranches(
  workingDir: string
): Promise<{ branches: string[]; currentBranch: string }> {
  const res = await fetch("/api/git/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: workingDir }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { branches: data.branches || [], currentBranch: data.currentBranch || "" };
}

export function useBranches(
  workingDir: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: gitKeys.branches(workingDir),
    queryFn: () => fetchBranches(workingDir),
    staleTime: 30000,
    enabled: !!workingDir && (options?.enabled ?? true),
  });
}

export function useCheckoutBranch(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      branch,
      force,
    }: {
      branch: string;
      force?: boolean;
    }) => {
      const res = await fetch("/api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, branch, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to switch branch");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.all });
    },
  });
}

export function useSyncBranch(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/git/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sync");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.all });
    },
  });
}

// --- Multi-repo Git Status ---

async function fetchMultiRepoGitStatus(
  projectId?: string,
  fallbackPath?: string
): Promise<MultiRepoGitStatus> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (fallbackPath) params.set("fallbackPath", fallbackPath);

  const res = await fetch(`/api/git/multi-status?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function useMultiRepoGitStatus(
  projectId?: string,
  fallbackPath?: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: gitKeys.multiStatus(projectId || "", fallbackPath),
    queryFn: () => fetchMultiRepoGitStatus(projectId, fallbackPath),
    staleTime: 10000, // Consider fresh for 10s
    refetchInterval: 15000, // Poll every 15s
    enabled: (!!projectId || !!fallbackPath) && (options?.enabled ?? true),
  });
}

// Multi-repo stage/unstage mutations
export function useMultiRepoStageFiles(repoPath: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files?: string[]) => {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: repoPath, files }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      // Invalidate all multi-status queries since we don't know which project
      queryClient.invalidateQueries({
        queryKey: gitKeys.all,
      });
    },
  });
}

export function useMultiRepoUnstageFiles(repoPath: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files?: string[]) => {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: repoPath, files }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      // Invalidate all multi-status queries since we don't know which project
      queryClient.invalidateQueries({
        queryKey: gitKeys.all,
      });
    },
  });
}

// --- Stash ---

async function fetchStashList(workingDir: string): Promise<StashEntry[]> {
  const res = await fetch(
    `/api/git/stash?path=${encodeURIComponent(workingDir)}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.stashes || [];
}

async function fetchStashDetail(
  workingDir: string,
  index: number
): Promise<string> {
  const res = await fetch(
    `/api/git/stash/${index}?path=${encodeURIComponent(workingDir)}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.diff || "";
}

export function useStashList(workingDir: string) {
  return useQuery({
    queryKey: gitKeys.stash(workingDir),
    queryFn: () => fetchStashList(workingDir),
    staleTime: 15000,
    refetchInterval: 30000,
    enabled: !!workingDir,
  });
}

export function useStashDetail(workingDir: string, index: number | null) {
  return useQuery({
    queryKey: gitKeys.stashDetail(workingDir, index ?? -1),
    queryFn: () => fetchStashDetail(workingDir, index!),
    staleTime: 60000,
    enabled: !!workingDir && index !== null,
  });
}

export function useStashSave(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      message,
      includeUntracked,
    }: {
      message?: string;
      includeUntracked?: boolean;
    }) => {
      const res = await fetch("/api/git/stash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, message, includeUntracked }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.stash(workingDir) });
      queryClient.invalidateQueries({ queryKey: gitKeys.status(workingDir) });
    },
  });
}

export function useStashAction(workingDir: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      index,
      action,
    }: {
      index: number;
      action: "apply" | "pop" | "drop";
    }) => {
      const res = await fetch(`/api/git/stash/${index}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, action }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.stash(workingDir) });
      queryClient.invalidateQueries({ queryKey: gitKeys.status(workingDir) });
    },
  });
}

// --- PR Review ---

import type { PRDetail, PRComment } from "@/lib/pr";

async function fetchPRDetail(
  workingDir: string,
  prNumber: number
): Promise<PRDetail> {
  const res = await fetch(
    `/api/git/pr/${prNumber}?path=${encodeURIComponent(workingDir)}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.pr;
}

async function fetchPRComments(
  workingDir: string,
  prNumber: number
): Promise<PRComment[]> {
  const res = await fetch(
    `/api/git/pr/${prNumber}/comments?path=${encodeURIComponent(workingDir)}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.comments || [];
}

async function fetchPRDiff(
  workingDir: string,
  prNumber: number,
  file?: string
): Promise<string> {
  const params = new URLSearchParams({ path: workingDir });
  if (file) params.set("file", file);
  const res = await fetch(`/api/git/pr/${prNumber}/diff?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.diff || "";
}

export function usePRDetail(workingDir: string, prNumber: number | null) {
  return useQuery({
    queryKey: gitKeys.prDetail(workingDir, prNumber ?? 0),
    queryFn: () => fetchPRDetail(workingDir, prNumber!),
    staleTime: 30000,
    enabled: !!workingDir && prNumber !== null,
  });
}

export function usePRComments(workingDir: string, prNumber: number | null) {
  return useQuery({
    queryKey: gitKeys.prComments(workingDir, prNumber ?? 0),
    queryFn: () => fetchPRComments(workingDir, prNumber!),
    staleTime: 30000,
    enabled: !!workingDir && prNumber !== null,
  });
}

export function usePRDiff(workingDir: string, prNumber: number | null) {
  return useQuery({
    queryKey: gitKeys.prDiff(workingDir, prNumber ?? 0),
    queryFn: () => fetchPRDiff(workingDir, prNumber!),
    staleTime: 60000,
    enabled: !!workingDir && prNumber !== null,
  });
}

export function usePRFileDiff(
  workingDir: string,
  prNumber: number | null,
  file: string | null
) {
  return useQuery({
    queryKey: gitKeys.prFileDiff(workingDir, prNumber ?? 0, file ?? ""),
    queryFn: () => fetchPRDiff(workingDir, prNumber!, file!),
    staleTime: 60000,
    enabled: !!workingDir && prNumber !== null && !!file,
  });
}

export function useSubmitPRReview(workingDir: string, prNumber: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      event,
      body,
    }: {
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    }) => {
      const res = await fetch(`/api/git/pr/${prNumber}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, event, body }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: gitKeys.prDetail(workingDir, prNumber),
      });
      queryClient.invalidateQueries({
        queryKey: gitKeys.prComments(workingDir, prNumber),
      });
    },
  });
}

export function useMergePR(workingDir: string, prNumber: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (method: "merge" | "squash" | "rebase" = "squash") => {
      const res = await fetch(`/api/git/pr/${prNumber}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, method }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.pr(workingDir) });
      queryClient.invalidateQueries({
        queryKey: gitKeys.prDetail(workingDir, prNumber),
      });
      queryClient.invalidateQueries({ queryKey: gitKeys.status(workingDir) });
    },
  });
}

export function useAddPRComment(workingDir: string, prNumber: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch(`/api/git/pr/${prNumber}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir, body }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: gitKeys.prComments(workingDir, prNumber),
      });
    },
  });
}

// --- Auto Fetch ---

export function useAutoFetch(workingDir: string, intervalSeconds: number) {
  return useQuery({
    queryKey: [...gitKeys.all, "auto-fetch", workingDir],
    queryFn: async () => {
      await fetch("/api/git/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workingDir }),
      });
      return { lastFetch: Date.now() };
    },
    refetchInterval: intervalSeconds > 0 ? intervalSeconds * 1000 : false,
    enabled: !!workingDir && intervalSeconds > 0,
    staleTime: 0,
  });
}
