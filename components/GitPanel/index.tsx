"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import { PRCreationModal } from "@/components/PRCreationModal";
import { PRReview } from "./PRReview";
import { BranchCard } from "./BranchCard";
import { ChangesList } from "./ChangesList";
import { CommitBar, CommitBox } from "./CommitBar";
import { CommitDetail } from "./CommitDetail";
import { FileDiffPage } from "./FileDiffPage";
import { GitMenu } from "./GitMenu";
import { HistoryList } from "./HistoryList";
import { NoPRCard, PRCard } from "./PRCard";
import { StashRows } from "./StashRows";
import { Subpage } from "./Subpage";
import {
  repoOf,
  useGitModel,
  type AnyGitFile,
  type GitModel,
} from "./useGitModel";
import { useViewport } from "@/hooks/useViewport";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { registerNavHandlers, registerViewBack } from "@/lib/nav-actions";
import { setGitMenu } from "@/stores/gitMenu";
import { moveSheetStore, openMoveSheet } from "@/stores/moveSheet";
import { cn } from "@/lib/utils";
import type { GitFile } from "@/lib/git-status";
import type { ProjectRepository } from "@/lib/db";

interface GitPanelProps {
  /** The session it shows: "Review in chat" quotes the PR to it (M2b) */
  sessionId?: string;
  /**
   * The focused pane's git view is showing: this mount takes the column's
   * Pull, Push and New pull request (E-Git). Unset on the drawer and pages
   */
  active?: boolean;
  workingDirectory: string;
  projectId?: string;
  repositories?: ProjectRepository[];
  onFileSelect?: (file: GitFile, diff: string) => void;
  onClose?: () => void;
}

/** The one-column touch layout below this width, as on the right page of an open iPhone Duo */
const NARROW_WIDTH = 640;

export function GitPanel(props: GitPanelProps) {
  const { isMobile } = useViewport();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!root) return;
    const observer = new ResizeObserver(() => setWidth(root.offsetWidth));
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);

  return (
    <div
      ref={setRoot}
      className="bg-background relative h-full w-full min-w-0 overflow-hidden"
    >
      <GitPanelContent
        {...props}
        narrow={isMobile || (width > 0 && width < NARROW_WIDTH)}
      />
    </div>
  );
}

interface OpenFile {
  file: AnyGitFile;
  diff: string;
  loading: boolean;
}

type Tab = "changes" | "history" | "stashes";

function GitPanelContent({
  sessionId,
  active,
  workingDirectory,
  projectId,
  repositories = [],
  onClose,
  narrow,
}: GitPanelProps & { narrow: boolean }) {
  const m = useGitModel({
    sessionId,
    workingDirectory,
    projectId,
    repositories,
  });
  // N-Worktree (M5): the session can move (moveSheetStore.offer, the
  // focused pane's): its branch card offers it, in the app's page too
  const { offer } = useSnapshot(moveSheetStore);
  const movable = sessionId && offer === sessionId ? sessionId : null;
  // The closed Duo: E-Git's insets, and its column holds Pull, Push and New pull request
  const closed = useLayoutMode() === "duo-closed";
  const columnActions = !!active && closed && narrow;

  const [tab, setTab] = useState<Tab>("changes");
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [commitHash, setCommitHash] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [creatingPR, setCreatingPR] = useState(false);

  // The latest request wins when files are opened quickly in turn
  const diffRequest = useRef(0);
  const showFile = useCallback(
    async (file: AnyGitFile) => {
      const id = ++diffRequest.current;
      setCommitHash(null);
      setReviewing(false);
      setOpenFile((cur) => ({
        file,
        diff: cur && cur.file.path === file.path ? cur.diff : "",
        loading: true,
      }));
      let diff = "";
      try {
        const params = new URLSearchParams({
          path: repoOf(file, workingDirectory),
          file: file.path,
          staged: String(file.staged),
          ...(file.status === "untracked" && { untracked: "true" }),
        });
        const data = await (await fetch(`/api/git/status?${params}`)).json();
        diff = typeof data.diff === "string" ? data.diff : "";
      } catch {
        toast.error("Couldn't load the diff");
      }
      if (id === diffRequest.current)
        setOpenFile((cur) => (cur ? { ...cur, diff, loading: false } : cur));
    },
    [workingDirectory]
  );

  const openCommit = (hash: string) => {
    setOpenFile(null);
    setReviewing(false);
    setCommitHash(hash);
  };
  const openReview = () => {
    setOpenFile(null);
    setCommitHash(null);
    setReviewing(true);
  };
  const review = () => {
    if (!m.reviewInChat()) openReview();
  };
  const newPullRequest = () => {
    if (m.prOpen) return openReview();
    if (m.onBase) {
      toast(`You're on ${m.branch}: switch to a branch to open a pull request`);
      return;
    }
    setCreatingPR(true);
  };

  // The column's Pull, Push and New pull request, while this view shows
  const latest = useRef({ pull: m.pull, push: m.push, newPullRequest });
  latest.current = { pull: m.pull, push: m.push, newPullRequest };
  useEffect(() => {
    if (!active) return;
    return registerNavHandlers({
      gitPull: () => latest.current.pull(),
      gitPush: () => latest.current.push(),
      newPullRequest: () => latest.current.newPullRequest(),
    });
  }, [active]);

  // Back off a diff, a commit or the PR's review to the list before
  // leaving the view, where it is pushed over the list
  const subpageBack = openFile
    ? "Back to changes"
    : commitHash
      ? "Back to history"
      : reviewing && m.pr
        ? "Back to git"
        : null;
  useEffect(() => {
    if (!active || !narrow || !subpageBack) return;
    return registerViewBack(subpageBack, () => {
      setOpenFile(null);
      setCommitHash(null);
      setReviewing(false);
    });
  }, [active, narrow, subpageBack]);

  // The title row has no ⋯ here: the column's More takes its items
  const model = useRef(m);
  model.current = m;
  const prUrl = m.pr?.url ?? null;
  const prNumber = m.pr?.number ?? null;
  useEffect(() => {
    if (!columnActions) return;
    setGitMenu({
      refresh: () => model.current.refreshAll(),
      prUrl,
      prNumber,
      syncInterval: m.syncInterval,
      setSyncInterval: (s) => model.current.setSyncInterval(s),
    });
    return () => setGitMenu(null);
  }, [columnActions, prUrl, prNumber, m.syncInterval]);

  const fileActions = {
    onStage: (f: AnyGitFile) => m.stage(f),
    onUnstage: async (f: AnyGitFile) => {
      await m.unstage(f);
      if (openFile && openFile.file.path === f.path)
        showFile({ ...f, staged: false });
    },
    onDiscard: async (f: AnyGitFile) => {
      if ((await m.discard(f)) && openFile?.file.path === f.path)
        setOpenFile(null);
    },
  };

  const pills = <ActionPills m={m} />;
  const title = (size: "large" | "title") => (
    <div className="flex min-w-0 items-center gap-1">
      <h1
        className={cn(
          "min-w-0 flex-1",
          size === "large" ? "t-large" : "t-title"
        )}
      >
        Git
      </h1>
      {!columnActions && (
        <GitMenu
          pr={m.pr}
          syncInterval={m.syncInterval}
          onSyncInterval={m.setSyncInterval}
          onRefresh={() => m.refreshAll()}
        />
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close git"
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex size-9 flex-none items-center justify-center rounded-full"
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );

  const branchCard = (
    <BranchCard
      workingDirectory={m.repoPath}
      branch={m.branch}
      caption={m.caption}
      hasChanges={m.hasChanges}
      fixed={m.isMultiRepo && repositories.length > 1}
      onBranchChanged={m.refreshAll}
      onMove={movable ? () => openMoveSheet(movable) : undefined}
    />
  );

  // A diff, a commit or the PR's review: over the panel when narrow, in
  // D-Git's main column when wide
  const subpage = openFile ? (
    <FileDiffPage
      file={openFile.file}
      diff={openFile.diff}
      loading={openFile.loading}
      files={m.files}
      layer={narrow}
      closed={closed}
      onBack={() => setOpenFile(null)}
      onOpen={showFile}
      onStage={fileActions.onStage}
      onUnstage={fileActions.onUnstage}
    />
  ) : commitHash ? (
    <CommitDetail
      repoPath={m.repoPath}
      hash={commitHash}
      layer={narrow}
      closed={closed}
      wrap={narrow}
      onBack={() => setCommitHash(null)}
    />
  ) : reviewing && m.pr ? (
    <Subpage
      backLabel="Back to git"
      onBack={() => setReviewing(false)}
      layer={narrow}
      closed={closed}
      title={`#${m.pr.number} ${m.pr.title}`}
      subtitle={`${m.pr.headRefName} → ${m.pr.baseRefName}`}
    >
      <PRReview workingDirectory={m.repoPath} prNumber={m.pr.number} />
    </Subpage>
  ) : null;

  const prModal = creatingPR && (
    <PRCreationModal
      workingDirectory={m.repoPath}
      onClose={() => setCreatingPR(false)}
      onSuccess={() => m.refreshAll()}
    />
  );

  const body = (() => {
    if (m.loading)
      return (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      );
    if (m.error || !m.status)
      return (
        <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-[14px]">
          <AlertCircle className="h-7 w-7" />
          {m.error ?? "No git status"}
        </div>
      );
    return null;
  })();

  if (narrow) {
    const changes = m.hasChanges ? (
      <ChangesList files={m.files} onOpen={showFile} {...fileActions} />
    ) : (
      <div className="group-card text-muted-foreground px-4 py-3.5 text-[15px]">
        No changes
      </div>
    );
    return (
      <>
        <div
          className={cn(
            "flex h-full min-w-0 flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-contain pt-[18px] pb-[var(--git-pb)] [--git-pb:max(1rem,var(--pane-inset-bottom,env(safe-area-inset-bottom)))]",
            closed ? "pr-[8px] pl-[20px]" : "px-4"
          )}
        >
          {title("large")}
          {body ?? (
            <>
              {branchCard}
              {!columnActions && pills}
              {m.pr && (
                <PRCard
                  pr={m.pr}
                  merging={m.merging}
                  onMerge={m.merge}
                  onReview={review}
                  onOpen={openReview}
                />
              )}
              {!m.prOpen && !m.onBase && !columnActions && (
                <button
                  type="button"
                  onClick={newPullRequest}
                  className="pill pill-secondary pill-sm self-start active:opacity-80"
                >
                  New pull request
                </button>
              )}
              <div
                className="seg bg-card flex-none self-start"
                role="tablist"
                aria-label="Git"
              >
                {(
                  [
                    ["changes", "Changes"],
                    ["history", "History"],
                    ["stashes", "Stashes"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "changes" && changes}
              {tab === "changes" && m.hasChanges && (
                // On the true bottom edge, its padding taking the panel's,
                // so no row shows below it
                <div className="bg-background sticky bottom-[calc(-1*var(--git-pb))] mb-[calc(-1*var(--git-pb))] flex-none pt-1 pb-[calc(var(--git-pb)+0.25rem)]">
                  <CommitBar {...m} />
                </div>
              )}
              {tab === "history" && (
                <HistoryList
                  repoPath={m.repoPath}
                  branch={m.branch}
                  info={m.info}
                  onOpen={openCommit}
                />
              )}
              {tab === "stashes" && (
                <>
                  {m.hasChanges && (
                    <button
                      type="button"
                      onClick={m.stash}
                      disabled={m.stashing}
                      className="pill pill-secondary pill-sm self-start active:opacity-80 disabled:opacity-50"
                    >
                      Stash changes
                    </button>
                  )}
                  <StashRows
                    workingDirectory={workingDirectory}
                    stashes={m.stashes}
                  />
                </>
              )}
            </>
          )}
        </div>
        {subpage}
        {prModal}
      </>
    );
  }

  return (
    <div className="flex h-full min-w-0">
      <aside
        aria-label="Working tree"
        // On the open Duo the column takes the left page and the rest the
        // right one, clear of the fold (as D-Files)
        className="bg-page border-hair flex w-[380px] flex-none flex-col gap-3.5 overflow-x-hidden overflow-y-auto overscroll-contain border-r px-4 py-[18px] [html[data-hinge]_&]:w-[calc(var(--hinge-x)-var(--fold-clear))] [html[data-hinge]_&]:border-r-0"
      >
        {title("title")}
        {body ?? (
          <>
            {branchCard}
            {pills}
            <h2 className="t-sec">Changes · {m.files.length}</h2>
            {m.hasChanges ? (
              <>
                <ChangesList
                  files={m.files}
                  wide
                  selected={openFile?.file}
                  onOpen={showFile}
                  {...fileActions}
                />
                <CommitBox {...m} />
              </>
            ) : (
              <p className="text-muted-foreground px-1 text-[14px]">
                No changes
              </p>
            )}
            {m.stashes.length > 0 && (
              <>
                <h2 className="t-sec mt-1.5">Stashes · {m.stashes.length}</h2>
                <StashRows
                  workingDirectory={workingDirectory}
                  stashes={m.stashes}
                />
              </>
            )}
          </>
        )}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col [html[data-hinge]_&]:ml-[calc(2*var(--fold-clear))]">
        {subpage ?? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-6 py-[18px]">
            {!body && m.pr && (
              <PRCard
                pr={m.pr}
                wide
                merging={m.merging}
                onMerge={m.merge}
                onReview={review}
                onOpen={openReview}
              />
            )}
            {!body && !m.prOpen && (
              <NoPRCard onCreate={m.onBase ? undefined : newPullRequest} />
            )}
            {!body && (
              <HistoryList
                repoPath={m.repoPath}
                branch={m.branch}
                info={m.info}
                wide
                onOpen={openCommit}
              />
            )}
          </div>
        )}
      </main>
      {prModal}
    </div>
  );
}

/** Pull, Push and Stash as quiet pills (D-Git; E-Git's column has its own) */
function ActionPills({ m }: { m: GitModel }) {
  const pill =
    "pill pill-secondary pill-sm min-w-0 flex-1 active:opacity-80 disabled:opacity-50";
  return (
    <div className="flex min-w-0 gap-2">
      <button
        type="button"
        onClick={m.pull}
        disabled={m.pulling}
        className={pill}
      >
        {m.pulling && <Loader2 className="h-4 w-4 animate-spin" />}
        Pull
      </button>
      <button
        type="button"
        onClick={m.push}
        disabled={m.pushing}
        className={pill}
      >
        {m.pushing && <Loader2 className="h-4 w-4 animate-spin" />}
        Push
      </button>
      <button
        type="button"
        onClick={m.stash}
        disabled={m.stashing || !m.hasChanges}
        className={pill}
      >
        Stash
      </button>
    </div>
  );
}
