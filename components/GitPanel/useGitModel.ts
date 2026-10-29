"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  gitKeys,
  useAutoFetch,
  useGenerateCommitMessage,
  useGitStatus,
  useMergePR,
  useMultiRepoGitStatus,
  usePRStatus,
  usePull,
  usePush,
  useStashList,
  useStashSave,
} from "@/data/git/queries";
import { confirmAction } from "@/components/ui/confirm";
import { addQuote } from "@/stores/replyQuotes";
import { mobileNavActions } from "@/stores/mobileNav";
import type { GitFile, GitStatus } from "@/lib/git-status";
import type { MultiRepoGitFile } from "@/lib/multi-repo-git";
import type { BranchInfo } from "@/lib/git-types";
import type { ProjectRepository } from "@/lib/db";
import {
  branchCaption,
  changedFiles,
  commitTarget,
  onBaseBranch,
} from "./git-format";

export type AnyGitFile = GitFile | MultiRepoGitFile;

/** Where the branch stands until the server says (multi-repo, loading) */
const NO_INFO: BranchInfo = {
  baseBranch: null,
  aheadOfBase: 0,
  behindBase: 0,
  pushed: false,
};

const SYNC_KEY = (dir: string) => `agentOS:gitSync:${dir}`;

/** The repo a file belongs to: its own in a multi-repo project */
export function repoOf(file: AnyGitFile, fallback: string): string {
  return "repoPath" in file && file.repoPath ? file.repoPath : fallback;
}

async function postJson(url: string, body: object) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || res.statusText);
  return data;
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

interface Options {
  sessionId?: string;
  workingDirectory: string;
  projectId?: string;
  repositories: ProjectRepository[];
}

/**
 * Everything the git page shows and does (E-Git, D-Git), for either
 * layout: status (one repo or a project's several), the branch against its
 * base, the PR, stashes, and the commit, pull, push, stash and PR actions
 */
export function useGitModel({
  sessionId,
  workingDirectory,
  projectId,
  repositories,
}: Options) {
  const queryClient = useQueryClient();
  const isMultiRepo = repositories.length > 0;

  const single = useGitStatus(workingDirectory, { enabled: !isMultiRepo });
  const multi = useMultiRepoGitStatus(projectId, workingDirectory, {
    enabled: isMultiRepo,
  });
  const query = isMultiRepo ? multi : single;

  // A project's repos read as one: their files, summed ahead/behind
  const status: GitStatus | null = useMemo(() => {
    if (!isMultiRepo) return single.data ?? null;
    const data = multi.data;
    if (!data) return null;
    return {
      branch:
        data.repositories.length === 1
          ? data.repositories[0]?.branch || ""
          : `${data.repositories.length} repos`,
      ahead: data.repositories.reduce((n, r) => n + r.ahead, 0),
      behind: data.repositories.reduce((n, r) => n + r.behind, 0),
      staged: data.staged,
      unstaged: data.unstaged,
      untracked: data.untracked,
    };
  }, [isMultiRepo, single.data, multi.data]);

  const info: BranchInfo =
    !isMultiRepo && single.data
      ? {
          baseBranch: single.data.baseBranch ?? null,
          aheadOfBase: single.data.aheadOfBase ?? 0,
          behindBase: single.data.behindBase ?? 0,
          pushed: !!single.data.pushed,
        }
      : NO_INFO;

  // The PR and the actions on the branch go to the primary repo
  const repoPath = isMultiRepo
    ? repositories.find((r) => r.is_primary)?.path ||
      repositories[0]?.path ||
      workingDirectory
    : workingDirectory;

  const { data: prData } = usePRStatus(repoPath);
  const pr = prData?.existingPR ?? null;
  const { data: stashes = [] } = useStashList(workingDirectory);

  const [syncInterval, setSyncIntervalState] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      return (
        parseInt(localStorage.getItem(SYNC_KEY(workingDirectory)) || "0", 10) ||
        0
      );
    } catch {
      return 0;
    }
  });
  useAutoFetch(workingDirectory, syncInterval);
  const setSyncInterval = (seconds: number) => {
    setSyncIntervalState(seconds);
    try {
      localStorage.setItem(SYNC_KEY(workingDirectory), String(seconds));
    } catch {
      // Private mode: for this visit only
    }
  };

  const files = status ? changedFiles(status) : [];
  const branch = status?.branch ?? "";
  const target = useMemo(
    () =>
      status
        ? commitTarget(status, repoPath)
        : { staged: false, count: 0, groups: [] },
    [status, repoPath]
  );

  const refreshAll = useCallback(
    () => queryClient.invalidateQueries({ queryKey: gitKeys.all }),
    [queryClient]
  );

  // ---- Commit
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const canCommit = !!message.trim() && target.count > 0 && !committing;
  const commit = async () => {
    const text = message.trim();
    if (!text || !target.count || committing) return;
    setCommitting(true);
    try {
      for (const group of target.groups) {
        if (!target.staged)
          await postJson("/api/git/stage", {
            path: group.repoPath,
            files: group.files,
          });
        await postJson("/api/git/commit", {
          path: group.repoPath,
          message: text,
        });
      }
      setMessage("");
      toast.success(
        target.count === 1
          ? "Committed 1 file"
          : `Committed ${target.count} files`
      );
    } catch (err) {
      toast.error(errorText(err, "Commit failed"));
    } finally {
      setCommitting(false);
      refreshAll();
    }
  };

  const generateMutation = useGenerateCommitMessage(repoPath);
  const generate = () =>
    generateMutation.mutate(undefined, {
      onSuccess: (text) => setMessage(text),
      onError: (err) =>
        toast.error(errorText(err, "Couldn't write a commit message")),
    });

  // ---- Pull, push, stash
  const pullMutation = usePull(repoPath);
  const pull = () => {
    if (pullMutation.isPending) return;
    pullMutation.mutate(undefined, {
      onSuccess: (r) => toast.success(r.output?.trim() || "Pulled"),
      onError: (err) => toast.error(errorText(err, "Pull failed")),
    });
  };
  const pushMutation = usePush(repoPath);
  const push = () => {
    if (pushMutation.isPending) return;
    pushMutation.mutate(undefined, {
      onSuccess: (r) => {
        const res = (r ?? {}) as { pushed?: boolean; message?: string };
        toast.success(
          res.pushed === false ? res.message || "Already up to date" : "Pushed"
        );
      },
      onError: (err) => toast.error(errorText(err, "Push failed")),
    });
  };
  const stashMutation = useStashSave(workingDirectory);
  const stash = () =>
    stashMutation.mutate(
      { includeUntracked: true },
      {
        onSuccess: () => toast.success("Stashed your changes"),
        onError: (err) => toast.error(errorText(err, "Stash failed")),
      }
    );

  // ---- One file
  const stage = async (file: AnyGitFile) => {
    try {
      await postJson("/api/git/stage", {
        path: repoOf(file, repoPath),
        files: [file.path],
      });
    } catch (err) {
      toast.error(errorText(err, "Couldn't stage it"));
    }
    refreshAll();
  };
  const unstage = async (file: AnyGitFile) => {
    try {
      await postJson("/api/git/unstage", {
        path: repoOf(file, repoPath),
        files: [file.path],
      });
    } catch (err) {
      toast.error(errorText(err, "Couldn't unstage it"));
    }
    refreshAll();
  };
  /** Resolves true once the change is gone */
  const discard = async (file: AnyGitFile) => {
    const untracked = file.status === "untracked";
    const ok = await confirmAction({
      title: untracked ? "Delete this file?" : "Discard changes?",
      message: `${file.path} — this can't be undone.`,
      confirmLabel: untracked ? "Delete" : "Discard",
      destructive: true,
    });
    if (!ok) return false;
    try {
      await postJson("/api/git/discard", {
        path: repoOf(file, repoPath),
        file: file.path,
      });
      return true;
    } catch (err) {
      toast.error(errorText(err, "Couldn't discard the changes"));
      return false;
    } finally {
      refreshAll();
    }
  };

  // ---- The PR
  const mergeMutation = useMergePR(repoPath, pr?.number ?? 0);
  const merge = async () => {
    if (!pr || mergeMutation.isPending) return;
    const ok = await confirmAction({
      title: "Merge this pull request?",
      message: `#${pr.number} ${pr.title}, squashed into ${pr.baseRefName || "its base"}.`,
      confirmLabel: "Merge",
    });
    if (!ok) return;
    mergeMutation.mutate("squash", {
      onSuccess: () => toast.success(`Merged #${pr.number}`),
      onError: (err) => toast.error(errorText(err, "Merge failed")),
    });
  };
  /** Quote the PR to the session and go to its chat; false without a session */
  const reviewInChat = () => {
    if (!pr || !sessionId) return false;
    addQuote(sessionId, `PR #${pr.number}: ${pr.title}`);
    mobileNavActions.requestViewMode("chat", sessionId);
    return true;
  };

  return {
    isMultiRepo,
    repoPath,
    workingDirectory,
    loading: query.isPending,
    error: query.isError
      ? errorText(query.error, "Failed to load git status")
      : null,
    refresh: () => query.refetch(),
    refreshing: query.isRefetching,
    refreshAll,
    status,
    branch,
    files,
    hasChanges: files.length > 0,
    info,
    caption: status ? branchCaption(branch, status, info) : "",
    onBase: onBaseBranch(branch, info),
    pr,
    stashes,
    syncInterval,
    setSyncInterval,
    message,
    setMessage,
    target,
    canCommit,
    committing,
    commit,
    generate,
    generating: generateMutation.isPending,
    pull,
    pulling: pullMutation.isPending,
    push,
    pushing: pushMutation.isPending,
    stash,
    stashing: stashMutation.isPending,
    stage,
    unstage,
    discard,
    merge,
    merging: mergeMutation.isPending,
    reviewInChat,
    canReviewInChat: !!sessionId,
  };
}

export type GitModel = ReturnType<typeof useGitModel>;
