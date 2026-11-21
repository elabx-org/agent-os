"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import { followLink } from "@/lib/client/machine";
import { HUB_TARGET } from "@/lib/machine-marker";
import { machineKeys, useTakeJob } from "@/data/machines";
import {
  copyAge,
  takeStepText,
  type BackupView,
  type TakeJob,
  type TakeStep,
} from "@/lib/backup/types";
import type { MoveInResult } from "@/lib/session-move-types";

const STEPS: TakeStep[] = ["preparing", "code", "conversation", "starting"];

/**
 * "Continue on {hubName}": starts a copy's session on this server while
 * its machine is offline (lib/backup/takeover.ts). Shown in the copies
 * sheet in place of the viewer
 */
export function TakeOverSheet({
  machineId,
  machineName,
  hubName,
  copy,
  onCancel,
  onDone,
}: {
  machineId: string;
  machineName: string;
  hubName: string;
  copy: BackupView;
  onCancel: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [understood, setUnderstood] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<TakeJob | null>(null);
  const { data: job } = useTakeJob(started);
  const step = job?.step;
  const running = !!job && step !== "done" && step !== "failed";
  const done = step === "done";
  const failed = step === "failed";

  useEffect(() => {
    if (!done) return;
    haptic("success");
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: machineKeys.copies(machineId) });
  }, [done, queryClient, machineId]);

  const start = async () => {
    if (starting || running) return;
    if (copy.hasSettings && !understood) return;
    setStarting(true);
    setError(null);
    setStarted(null);
    try {
      const res = await fetchAsUser(
        `/api/machines/${machineId}/backups/${copy.sessionId}/take`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settingsOk: understood }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(refusalText(body));
        return;
      }
      setStarted(body as TakeJob);
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setStarting(false);
    }
  };

  const at = job ? STEPS.indexOf(step as TakeStep) : -1;
  const age = copyAge(Date.now() - copy.copiedAt);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1">
      <div className="min-w-0">
        <h2 className="t-title text-[20px] leading-tight font-bold">
          Continue on {hubName}
        </h2>
        <p className="text-muted-foreground mt-1 truncate text-[13px]">
          {copy.name}
        </p>
      </div>

      {!job && (
        <ul className="text-muted-foreground flex flex-col gap-1.5 px-1 text-[13px] leading-snug">
          <li>This starts the session here from the copy made {age} ago.</li>
          <li>
            Anything {machineName} did after that isn&apos;t in the copy. It
            stays on {machineName}; nothing there is deleted.
          </li>
          <li>
            If {machineName} is still switched on, its copy keeps working until
            it reconnects. Then it is paused and what it did stays on{" "}
            {machineName}.
          </li>
          {copy.hasSettings && (
            <li className="text-foreground">
              This copy has Claude settings that can run commands by themselves.
              They will run here too.
              <label className="mt-2 flex items-center gap-2 text-[15px]">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                  className="h-5 w-5"
                />
                I understand
              </label>
            </li>
          )}
        </ul>
      )}

      {job && (
        <ol
          aria-label="Progress"
          className="bg-card flex flex-col gap-2.5 rounded-2xl px-4 py-3.5"
        >
          {[...STEPS, "done" as TakeStep].map((s, i) => {
            const state =
              done || (at >= 0 && i < at)
                ? "done"
                : i === at
                  ? "now"
                  : failed && i === 0 && at < 0
                    ? "failed"
                    : "todo";
            return (
              <li
                key={s}
                className={cn(
                  "flex items-center gap-3 text-[15px]",
                  state === "todo" && "text-muted-foreground"
                )}
              >
                <span className="grid h-5 w-5 flex-none place-items-center">
                  {state === "done" ? (
                    <Check aria-hidden className="text-primary h-4 w-4" />
                  ) : state === "now" ? (
                    <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  ) : state === "failed" ? (
                    <X aria-hidden className="h-4 w-4 text-[var(--del)]" />
                  ) : (
                    <span
                      aria-hidden
                      className="bg-muted-foreground/40 h-1.5 w-1.5 rounded-full"
                    />
                  )}
                </span>
                {takeStepText(s, hubName)}
              </li>
            );
          })}
        </ol>
      )}

      {done && job?.result && <ResultLines result={job.result} />}

      <div className="sticky bottom-0 mt-auto flex flex-col gap-1.5 bg-[var(--sheet)] pt-1">
        {(error || failed) && (
          <p role="alert" className="text-center text-[13px] text-[var(--del)]">
            {failed ? `${takeStepText("failed", hubName)} ` : ""}
            {error ?? job?.error}
          </p>
        )}
        {done ? (
          <button
            type="button"
            onClick={() => {
              onDone();
              followLink(HUB_TARGET, job!.result?.sessionId ?? copy.sessionId);
            }}
            className="pill pill-primary h-[52px] w-full rounded-[26px] text-base active:opacity-80"
          >
            Open it
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void start()}
              disabled={
                starting || running || (copy.hasSettings && !understood)
              }
              className="pill pill-primary h-[52px] w-full rounded-[26px] text-base active:opacity-80 disabled:opacity-50"
            >
              {(starting || running) && (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              )}
              <span className="truncate">
                {running ? takeStepText(step!, hubName) : "Continue here"}
              </span>
            </button>
            {!running && (
              <button
                type="button"
                onClick={onCancel}
                className="pill pill-secondary h-[44px] w-full rounded-[22px] text-base active:opacity-80"
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The move sheet's lines about where it landed (ContinueOnSheet) */
function ResultLines({ result }: { result: MoveInResult }) {
  const folder = result.folder.replace(/^\/(Users|home)\/[^/]+/, "~");
  return (
    <div className="text-muted-foreground flex flex-col gap-1 px-1 text-[13px]">
      <p className="break-words">It&apos;s in {folder} here.</p>
      {result.needsTrust && (
        <p>
          Claude is asking whether to trust that folder. Open it here and
          answer.
        </p>
      )}
      {result.noRemoteAccess && (
        <p>
          This server couldn&apos;t reach this repository&apos;s remote, so
          Claude can&apos;t push or pull here yet. Sign in to git or GitHub here
          (for example, gh auth login).
        </p>
      )}
      {result.fullAccessOff && (
        <p>
          Full access didn&apos;t travel with it: here it asks before risky
          actions. You can turn it back on.
        </p>
      )}
      {result.renamedFrom && (
        <p>
          Its branch is called {result.branch} here: {result.renamedFrom} was
          already in use.
        </p>
      )}
      {result.leftBehind.length > 0 && (
        <p>
          {result.leftBehind.length === 1
            ? "One file was too large to bring, or is in a submodule, and stayed"
            : `${result.leftBehind.length} files were too large to bring, or are in a submodule, and stayed`}{" "}
          behind: {result.leftBehind.join(", ")}
        </p>
      )}
    </div>
  );
}
