"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { Check, Circle, CircleHelp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { confirmAction } from "@/components/ui/confirm";
import { useJob, useJobActions } from "@/data/jobs";
import { useMachines, useTabMachineId } from "@/data/machines";
import { switchMachine } from "@/lib/client/machine";
import {
  KEEP_DONE_MS,
  KEEP_FAILED_MS,
  changedText,
  codeText,
  isOver,
  jobLine,
  sentText,
  tookText,
  type Job,
} from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { closeJob, jobSheetStore } from "@/stores/jobSheet";
import { runningStore } from "@/stores/running";
import { useJobClock } from "./parts";

type StepState = "done" | "now" | "ask" | "todo" | "failed";

function Step({
  state,
  title,
  detail,
}: {
  state: StepState;
  title: string;
  detail?: string | null;
}) {
  const Icon =
    state === "done"
      ? Check
      : state === "now"
        ? Loader2
        : state === "ask"
          ? CircleHelp
          : state === "failed"
            ? X
            : Circle;
  return (
    <li className="flex items-start gap-3 px-[14px] py-2.5">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full",
          state === "done" &&
            "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
          state === "now" && "bg-primary/15 text-primary",
          state === "ask" &&
            "bg-amber-500/20 text-amber-600 dark:text-amber-400",
          state === "failed" && "bg-red-500/15 text-red-600 dark:text-red-400",
          state === "todo" && "text-muted-foreground/50"
        )}
      >
        <Icon
          className={cn(
            "h-3 w-3",
            state === "now" && "animate-spin motion-reduce:animate-none"
          )}
          strokeWidth={2.5}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "text-[15px]",
            state === "todo" && "text-muted-foreground"
          )}
        >
          {title}
        </span>
        {detail && (
          <span className="text-muted-foreground text-[13px] break-words">
            {detail}
          </span>
        )}
      </span>
    </li>
  );
}

/** The three things a job does, and how far it is */
function steps(job: Job, now: number) {
  const on = job.machineName;
  const s = job.state;
  const sent = s !== "queued" && s !== "sending";
  const ended = isOver(s);
  const ran = (job.endedAt ?? now) - (job.startedAt ?? job.createdAt);
  const copy: StepState =
    s === "queued"
      ? "todo"
      : s === "sending"
        ? "now"
        : (s === "failed" || s === "stopped") && !job.jobSession
          ? "failed"
          : "done";
  const run: StepState = !sent
    ? "todo"
    : s === "waiting"
      ? "ask"
      : s === "running"
        ? "now"
        : s === "done"
          ? "done"
          : copy === "failed"
            ? "todo"
            : "failed";
  return [
    {
      state: copy,
      title: job.code ? `Send the chat's code to ${on}` : `Set up on ${on}`,
      detail:
        s === "queued"
          ? null
          : s === "sending"
            ? (job.step ?? codeText(job.code))
            : job.code
              ? `${codeText(job.code)}${job.code.skipped > 0 ? `. ${job.code.skipped} left behind (too large)` : ""}`
              : "It needed no code",
    },
    {
      state: run,
      title: `Run on ${on}`,
      detail:
        run === "todo"
          ? null
          : s === "waiting"
            ? "Waiting for your answer"
            : s === "running"
              ? `For ${tookText(ran)}`
              : s === "done"
                ? `Took ${tookText(ran)}`
                : s === "stopped"
                  ? "Stopped"
                  : null,
    },
    {
      state: (s === "done" ? "done" : "todo") as StepState,
      title: "Bring the result back",
      detail: s === "done" ? changedText(job.changed) : ended ? null : null,
    },
  ];
}

/** Its session on the machine is still there to open */
function canOpen(job: Job, now: number): boolean {
  if (!job.jobSession) return false;
  if (!isOver(job.state)) return true;
  if (job.state === "stopped" || !job.endedAt) return false;
  const keep = job.state === "done" ? KEEP_DONE_MS : KEEP_FAILED_MS;
  return now - job.endedAt < keep - 60_000;
}

const BUTTON =
  "min-h-[44px] grow basis-44 rounded-xl px-4 text-[15px] font-semibold active:opacity-70 disabled:opacity-50";

function JobDetails({ job, now }: { job: Job; now: number }) {
  const { stop, again } = useJobActions();
  const [busy, setBusy] = useState<"stop" | "again" | null>(null);
  const open = canOpen(job, now);
  const over = isOver(job.state);
  const act = async (what: "stop" | "again") => {
    if (
      what === "stop" &&
      !(await confirmAction({
        title: `Stop "${job.title}"?`,
        message: `Its session and its folder on ${job.machineName} are removed. Nothing comes back.`,
        confirmLabel: "Stop the job",
        destructive: true,
      }))
    ) {
      return;
    }
    setBusy(what);
    const no = await (what === "stop" ? stop(job) : again(job));
    setBusy(null);
    if (no) toast.error(no);
    else if (what === "again")
      toast.success(`Sent to ${job.machineName} again`);
  };
  const files = job.changed?.files ?? [];
  return (
    <SheetBody className="flex flex-col gap-3 pb-4">
      {job.state === "waiting" && (
        <div className="rounded-xl bg-amber-500/15 px-[14px] py-3">
          <p className="text-[13px] font-semibold text-amber-700 dark:text-amber-300">
            It needs you
          </p>
          <p className="mt-0.5 text-[15px] break-words">
            {job.question ?? "It asks something before it goes on."}
          </p>
          <p className="text-muted-foreground mt-1 text-[13px]">
            You answer in the job&apos;s own chat on {job.machineName}. This
            chat stays here.
          </p>
        </div>
      )}
      {job.state === "failed" && (
        <div className="rounded-xl bg-red-500/10 px-[14px] py-3">
          <p className="text-[13px] font-semibold text-red-700 dark:text-red-300">
            It failed
          </p>
          <p className="mt-0.5 text-[15px] break-words">
            {job.error ?? "No reason was given."}
          </p>
        </div>
      )}
      <ol
        aria-label="Steps"
        className="group-card bg-card divide-border/60 divide-y overflow-hidden rounded-xl"
      >
        {steps(job, now).map((step) => (
          <Step key={step.title} {...step} />
        ))}
      </ol>
      {job.state === "done" && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground px-1 text-[13px] font-semibold">
            What it said
          </h3>
          <div className="bg-card max-h-[40vh] overflow-y-auto rounded-xl px-[14px] py-3 text-[15px] break-words whitespace-pre-wrap">
            {job.result ?? "It finished without a message."}
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground px-1 text-[13px] font-semibold">
            {changedText(job.changed)} on {job.machineName}
          </h3>
          <ul className="bg-card divide-border/60 divide-y overflow-hidden rounded-xl">
            {files.slice(0, 12).map((f) => (
              <li
                key={f.path}
                className="flex items-baseline gap-3 px-[14px] py-2 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate font-mono" dir="rtl">
                  <bdi>{f.path}</bdi>
                </span>
                <span className="flex-none text-emerald-600 dark:text-emerald-400">
                  +{f.added}
                </span>
                <span className="flex-none text-red-600 dark:text-red-400">
                  −{f.removed}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground px-1 text-[13px]">
            {job.changed?.tooBig
              ? "The changes were too large to bring back."
              : job.patch
                ? "These are not in the chat's folder. The chat was handed them as a patch and applies it if it wants them."
                : `The changes themselves didn't come back: ${job.machineName} couldn't be reached before its copy was removed.`}
            {files.length + (job.changed?.more ?? 0) > 12 &&
              ` ${files.length + (job.changed?.more ?? 0) - 12} more not shown.`}
          </p>
        </section>
      )}
      <details className="bg-card rounded-xl px-[14px] py-2.5">
        <summary className="cursor-pointer text-[15px] select-none">
          What it was asked
        </summary>
        <p className="text-muted-foreground mt-2 text-[13px] break-words whitespace-pre-wrap">
          {job.task}
        </p>
      </details>
      <p className="text-muted-foreground px-1 text-[13px]">
        {sentText(job)}{" "}
        {job.state === "done" || job.state === "failed"
          ? open
            ? `Its folder on ${job.machineName} is kept ${job.state === "done" ? "for an hour" : "for a day"}, then removed.`
            : `Its folder on ${job.machineName} has been removed.`
          : !over
            ? `It works in a folder of its own on ${job.machineName}, removed afterwards.`
            : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {open && (
          <button
            type="button"
            onClick={() =>
              switchMachine(job.machineId, { session: job.jobSession! })
            }
            className={cn(
              BUTTON,
              job.state === "waiting"
                ? "bg-primary text-primary-foreground"
                : "bg-foreground/10"
            )}
          >
            {job.state === "waiting"
              ? `Answer on ${job.machineName}`
              : `Open on ${job.machineName}`}
          </button>
        )}
        {!over && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => act("stop")}
            className={cn(
              BUTTON,
              "bg-red-500/10 text-red-600 dark:text-red-400"
            )}
          >
            {busy === "stop" ? "Stopping…" : "Stop"}
          </button>
        )}
        {over && job.sessionId && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => act("again")}
            className={cn(BUTTON, "bg-foreground/10")}
          >
            {busy === "again" ? "Sending…" : "Run again"}
          </button>
        )}
      </div>
    </SheetBody>
  );
}

/** Draws the details of jobSheetStore.id, once for the app */
export function JobSheetHost() {
  const { id } = useSnapshot(jobSheetStore);
  const { data, isFetched } = useJob(id);
  const job = id ? (data ?? null) : null;
  const now = useJobClock(job ? [job] : undefined);
  // Runners is offered where there is something to show: a machine is
  // linked, and the tab is on the server its jobs are sent from
  const elsewhere = useTabMachineId();
  const { data: machines } = useMachines();
  const linked =
    !elsewhere &&
    !!machines?.enabled &&
    machines.machines.some((m) => m.status === "approved");
  useEffect(() => {
    runningStore.runners = linked;
  }, [linked]);
  return (
    <Sheet open={!!id} onOpenChange={(next) => !next && closeJob()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{job?.title ?? "Job"}</SheetTitle>
          <SheetDescription>
            {job
              ? jobLine(job, now)
              : isFetched
                ? "This job is no longer listed."
                : "Loading…"}
          </SheetDescription>
        </SheetHeader>
        {job ? (
          <JobDetails job={job} now={now} />
        ) : (
          <SheetBody className="pb-4" />
        )}
      </SheetContent>
    </Sheet>
  );
}
