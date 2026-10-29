"use client";

import { useState, type CSSProperties } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { File, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { parseDiff, type ParsedDiff } from "@/lib/diff-parser";
import {
  gitKeys,
  useCommitAndPush,
  useGenerateCommitMessage,
  useGitStatus,
  useStageFiles,
} from "@/data/git/queries";
import { Counts } from "@/components/Chat/ToolCard";
import { confirmAction } from "@/components/ui/confirm";
import { ChangesDiff } from "./ChangesDiff";
import {
  changedFiles,
  commitLabel,
  commitPlan,
  selectedPath,
  totals,
  type ChangedFile,
} from "./changes-list";
import { PanelClose } from "@/components/ui/page-panel";

export interface ChangesPageProps {
  /** The session beside it: Commit and Discard act on its folder */
  sessionId: string;
  workingDirectory: string;
  className?: string;
  style?: CSSProperties;
  /** The right page's × */
  onClose?: () => void;
}

async function fetchDiffText(
  workingDir: string,
  file: string,
  which: "staged" | "unstaged" | "untracked"
): Promise<string> {
  const params = new URLSearchParams({ path: workingDir, file });
  if (which === "staged") params.set("staged", "true");
  if (which === "untracked") params.set("untracked", "true");
  const res = await fetch(`/api/git/status?${params}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "No diff");
  return data.diff ?? "";
}

/** The file's whole change: what's staged, then what isn't yet */
async function fetchFileDiff(
  workingDir: string,
  file: ChangedFile
): Promise<ParsedDiff> {
  const parts = file.untracked
    ? (["untracked"] as const)
    : ([
        ...(file.staged ? ["staged"] : []),
        ...(file.unstaged ? ["unstaged"] : []),
      ] as ("staged" | "unstaged")[]);
  const diffs = await Promise.all(
    parts.map(async (which) =>
      // Without the last newline, which would read as one more empty line
      parseDiff(
        (await fetchDiffText(workingDir, file.path, which)).replace(/\n$/, "")
      )
    )
  );
  const [first, ...rest] = diffs;
  if (!first) return parseDiff("");
  return rest.reduce<ParsedDiff>(
    (all, d) => ({
      ...all,
      hunks: [...all.hunks, ...d.hunks],
      additions: all.additions + d.additions,
      deletions: all.deletions + d.deletions,
      isBinary: all.isBinary || d.isBinary,
    }),
    first
  );
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || "Failed");
  return data;
}

/**
 * The open Duo's right page beside the conversation (Open-Changes): the
 * changed files with their counts, the selected file's diff, Discard and
 * Commit N files. The column's Changes opens it there (changesOpen) in
 * place of the git view taking both pages.
 */
export function ChangesPage({
  workingDirectory,
  className,
  style,
  onClose,
}: ChangesPageProps) {
  const queryClient = useQueryClient();
  const status = useGitStatus(workingDirectory);
  const files = status.data ? changedFiles(status.data) : [];
  const total = totals(files);
  const [picked, setPicked] = useState<string | null>(null);
  // The pick survives refreshes; once its file is gone the first one shows
  const selected = files.find((f) => f.path === selectedPath(files, picked));
  const plan = commitPlan(files);

  const diffKey = (file: ChangedFile | undefined): QueryKey => [
    ...gitKeys.all,
    "changes-diff",
    workingDirectory,
    file?.path ?? "",
    file?.staged,
    file?.unstaged,
    file?.untracked,
    // Again with every status read: the agent may still be writing it
    status.dataUpdatedAt,
  ];
  const diff = useQuery({
    queryKey: diffKey(selected),
    queryFn: () => fetchFileDiff(workingDirectory, selected!),
    enabled: !!selected,
    // The same file's last diff while its next one loads, never another's
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] === selected?.path ? previous : undefined,
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: gitKeys.status(workingDirectory),
    });

  const discard = useMutation({
    mutationFn: async (file: ChangedFile) => {
      // Unstaged first, so the discard reverts it to the last commit (a
      // newly added file becomes untracked and goes)
      if (file.staged)
        await postJson("/api/git/unstage", {
          path: workingDirectory,
          files: [file.path],
        });
      await postJson("/api/git/discard", {
        path: workingDirectory,
        file: file.path,
      });
    },
    onSettled: refresh,
    onError: (e) => toast.error(`Couldn't discard: ${e.message}`),
  });

  const onDiscard = async () => {
    if (!selected) return;
    const ok = await confirmAction({
      title: `Discard changes to ${selected.name}?`,
      message: selected.untracked
        ? "The new file is deleted. This can't be undone."
        : "This can't be undone.",
      confirmLabel: "Discard",
      destructive: true,
    });
    if (ok) discard.mutate(selected);
  };

  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState("");
  const stage = useStageFiles(workingDirectory);
  const commit = useCommitAndPush(workingDirectory);
  const generate = useGenerateCommitMessage(workingDirectory);
  const committing = stage.isPending || commit.isPending;

  const onCommit = async () => {
    const text = message.trim();
    if (!text || committing) return;
    try {
      if (plan.stage.length) await stage.mutateAsync(plan.stage);
      await commit.mutateAsync({ message: text, push: false });
      setMessage("");
      setComposing(false);
    } catch (e) {
      toast.error(
        `Couldn't commit: ${e instanceof Error ? e.message : "unknown error"}`
      );
      refresh();
    }
  };

  const onWrite = async () => {
    try {
      const text = await generate.mutateAsync();
      // Never over what was typed while Claude wrote
      setMessage((cur) => (cur.trim() ? cur : text));
    } catch {
      toast.error("Couldn't write a message");
    }
  };

  return (
    <section
      aria-label="Changes"
      className={cn(
        "flex min-h-0 flex-col gap-3 overflow-hidden pt-5 pr-2 pb-[max(16px,env(safe-area-inset-bottom))] pl-4",
        className
      )}
      style={style}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="t-title mr-auto">Changes</h2>
        {files.length > 0 && (
          <span className="chip">
            <span className="n-add">+{total.additions}</span>
            {total.deletions > 0 && (
              <span className="n-del">−{total.deletions}</span>
            )}
          </span>
        )}
        {onClose && <PanelClose label="Changes" onClose={onClose} />}
      </div>

      {status.isError ? (
        <p className="text-muted-foreground px-1 text-[13px]">
          {status.error.message}
        </p>
      ) : status.data && files.length === 0 ? (
        <p className="text-muted-foreground flex flex-1 items-center justify-center text-[13px]">
          No changes
        </p>
      ) : files.length > 0 ? (
        <>
          {/* A long list scrolls on its own and leaves the diff room */}
          <div className="max-h-[40%] min-h-0 shrink-0 overflow-y-auto rounded-[20px]">
            <div className="group-card">
              {files.map((f) => {
                const on = f.path === selected?.path;
                return (
                  <button
                    key={f.path}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(f.path)}
                    className={cn(
                      "row min-h-[48px] w-full text-left",
                      on && "sel"
                    )}
                  >
                    <File
                      aria-hidden="true"
                      className={cn(
                        "h-4 w-4 shrink-0",
                        on
                          ? "text-primary dark:text-meter"
                          : "text-muted-foreground"
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-mono text-[13px]">
                        {f.name}
                      </span>
                      {f.folder && (
                        <span className="text-muted-foreground truncate text-[13px]">
                          {f.folder}
                        </span>
                      )}
                    </span>
                    {f.additions !== undefined && (
                      <Counts added={f.additions} removed={f.deletions ?? 0} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="tools min-h-0 flex-1 overflow-y-auto">
            {diff.data ? (
              <ChangesDiff diff={diff.data} />
            ) : diff.isError ? (
              <p className="text-muted-foreground px-4 py-8 text-center text-[13px]">
                Couldn&apos;t load the diff
              </p>
            ) : (
              <Loader2 className="text-muted-foreground mx-auto my-8 h-5 w-5 animate-spin" />
            )}
          </div>

          {composing ? (
            <div className="flex flex-col gap-2.5">
              <form
                className="flex gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  onCommit();
                }}
              >
                <input
                  autoFocus
                  aria-label="Commit message"
                  placeholder="Commit message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setComposing(false);
                  }}
                  className="pill-field"
                />
                <button
                  type="submit"
                  disabled={!message.trim() || committing}
                  className="pill pill-primary disabled:opacity-50"
                >
                  {committing && <Loader2 className="h-4 w-4 animate-spin" />}
                  Commit
                </button>
              </form>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={onWrite}
                  disabled={generate.isPending}
                  className="pill pill-secondary pill-sm disabled:opacity-50"
                >
                  {generate.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Write with Claude
                </button>
                <span className="text-muted-foreground flex flex-1 items-center justify-end text-[13px]">
                  {plan.count} {plan.count === 1 ? "file" : "files"}
                </span>
                <button
                  type="button"
                  onClick={() => setComposing(false)}
                  className="pill pill-secondary pill-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onDiscard}
                disabled={!selected || discard.isPending}
                className="pill pill-secondary min-w-0 flex-1 disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="pill pill-primary min-w-0 flex-1"
              >
                {commitLabel(plan.count)}
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
