"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Loader2,
  Square,
  X,
} from "lucide-react";
import { isOver, jobLine, type Job, type JobState } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

/** The clock a list of jobs is drawn against: each second while one is going */
export function useJobClock(jobs: readonly Job[] | undefined): number {
  const going = !!jobs?.some((j) => !isOver(j.state));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!going) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [going]);
  return now;
}

const TONE: Record<JobState, string> = {
  queued: "bg-foreground/10 text-muted-foreground",
  sending: "bg-primary/15 text-primary",
  running: "bg-primary/15 text-primary",
  waiting: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  stopped: "bg-foreground/10 text-muted-foreground",
};

/** The job's state as a small round mark */
export function JobGlyph({
  state,
  className,
}: {
  state: JobState;
  className?: string;
}) {
  const Icon =
    state === "queued"
      ? Clock3
      : state === "sending" || state === "running"
        ? Loader2
        : state === "waiting"
          ? CircleHelp
          : state === "done"
            ? Check
            : state === "failed"
              ? X
              : Square;
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-[26px] w-[26px] flex-none place-items-center rounded-full",
        TONE[state],
        className
      )}
    >
      <Icon
        className={cn(
          state === "stopped" ? "h-3 w-3" : "h-3.5 w-3.5",
          (state === "sending" || state === "running") &&
            "animate-spin motion-reduce:animate-none"
        )}
        strokeWidth={2.5}
      />
    </span>
  );
}

/** One job as a line that opens its details */
export function JobLine({
  job,
  now,
  onOpen,
  from,
  className,
}: {
  job: Job;
  now: number;
  onOpen: (job: Job) => void;
  /** Also say which chat sent it (a list across chats) */
  from?: boolean;
  className?: string;
}) {
  const line = jobLine(job, now);
  return (
    <button
      type="button"
      onClick={() => onOpen(job)}
      className={cn(
        "active:bg-foreground/5 flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left",
        className
      )}
    >
      <JobGlyph state={job.state} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium">{job.title}</span>
        <span
          className={cn(
            "truncate text-[13px]",
            job.state === "waiting"
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          )}
        >
          {job.state === "waiting" && job.question
            ? `Needs you: ${job.question}`
            : line}
          {from && job.sessionName ? ` · from ${job.sessionName}` : ""}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="text-muted-foreground/60 h-4 w-4 flex-none"
      />
    </button>
  );
}
