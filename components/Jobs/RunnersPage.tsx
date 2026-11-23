"use client";

import { useState } from "react";
import { ChevronLeft, Laptop, Loader2, Server } from "lucide-react";
import { toast } from "sonner";
import type { PageProps } from "@/components/WorkspacePage";
import { PAGE_BARS } from "@/components/ControlColumn/columnState";
import { confirmAction } from "@/components/ui/confirm";
import { useJobActions, useJobMode, useJobSpace, useJobs } from "@/data/jobs";
import { useMachines, useTargetAbilities } from "@/data/machines";
import { useIsNative } from "@/hooks/useIsNative";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { shortText, systemText } from "@/lib/abilities-types";
import { sizeText } from "@/lib/backup/types";
import type { JobsMachine } from "@/lib/jobs/hub";
import { isOver, jobModeLine, tookText, type Job } from "@/lib/jobs/types";
import { HUB_TARGET } from "@/lib/machine-marker";
import { nativeCaps } from "@/lib/native-bridge";
import { runNav } from "@/lib/nav-actions";
import { ageText } from "@/lib/session-move-types";
import { cn } from "@/lib/utils";
import { openJob } from "@/stores/jobSheet";
import { openSettings } from "@/stores/settingsPage";
import { workspacePageStore } from "@/stores/workspacePage";
import { JobLine, useJobClock } from "./parts";

const DAY_MS = 24 * 60 * 60 * 1000;

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "5 finished, 1 failed · 14 min of work" for the last day */
function dayLine(jobs: readonly Job[], now: number): string | null {
  const recent = jobs.filter(
    (j) => isOver(j.state) && now - (j.endedAt ?? 0) < DAY_MS
  );
  if (recent.length === 0) return null;
  const done = recent.filter((j) => j.state === "done").length;
  const failed = recent.filter((j) => j.state === "failed").length;
  const stopped = recent.length - done - failed;
  const work = recent.reduce(
    (sum, j) =>
      sum +
      (j.startedAt && j.endedAt ? Math.max(0, j.endedAt - j.startedAt) : 0),
    0
  );
  const parts = [
    done > 0 ? `${done} finished` : null,
    failed > 0 ? `${failed} failed` : null,
    stopped > 0 ? `${stopped} stopped` : null,
  ].filter(Boolean);
  return `Last 24 hours: ${parts.join(", ")}${work > 0 ? ` · ${tookText(work)} of work` : ""}`;
}

/** What jobs keep on a machine's disk, with the way to clear it */
function Space({ machine }: { machine: JobsMachine }) {
  const { data: space, isLoading } = useJobSpace(machine.id, machine.online);
  const { clear } = useJobActions();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!machine.online) return null;
  if (isLoading || !space) {
    return (
      <p className="text-muted-foreground px-3 py-2.5 text-[13px]">
        {isLoading ? "Checking the space its jobs use…" : null}
      </p>
    );
  }
  const kept = space.caches.reduce((sum, c) => sum + c.bytes, 0);
  const total = space.work + space.repos + kept;
  const drop = async (name: string | null) => {
    const ok = await confirmAction({
      title: name
        ? `Clear the build output kept for ${name}?`
        : "Clear all kept build output?",
      message: `Only build output in ${space.folder}/cache on ${machine.name} is removed. The next job builds from scratch, which takes longer once.`,
      confirmLabel: "Clear",
      destructive: true,
    });
    if (!ok) return;
    setBusy(name ?? "*");
    const no = await clear(machine.id, name);
    setBusy(null);
    if (no) toast.error(no);
  };
  return (
    <div className="px-3 py-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-[40px] w-full items-center gap-2 text-left text-[13px]"
      >
        <span className="text-muted-foreground min-w-0 flex-1">
          {total > 0
            ? `Jobs use ${sizeText(total)} here, all in ${space.folder}`
            : `Jobs use no space here yet (${space.folder})`}
        </span>
        <span className="text-primary flex-none font-semibold">
          {open ? "Hide" : "Details"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 pb-2 text-[13px]">
          <p className="text-muted-foreground">
            Working folders of jobs still kept:{" "}
            {space.work > 0 ? sizeText(space.work) : "none"}. Removed an hour
            after a job that finished, a day after one that failed.
          </p>
          {space.repos > 0 && (
            <p className="text-muted-foreground">
              Code of projects this machine has no copy of:{" "}
              {sizeText(space.repos)}.
            </p>
          )}
          {space.caches.length === 0 ? (
            <p className="text-muted-foreground">No build output is kept.</p>
          ) : (
            <ul className="flex flex-col">
              {space.caches.map((c) => (
                <li
                  key={c.name}
                  className="flex min-h-[40px] items-center gap-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      build output, {sizeText(c.bytes)}, last used{" "}
                      {ageText(Date.now() - c.usedAt)} ago
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => drop(c.name)}
                    className="text-primary min-h-[40px] flex-none px-2 font-semibold active:opacity-70 disabled:opacity-50"
                  >
                    {busy === c.name ? "Clearing…" : "Clear"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground">
            Build output goes by itself after 14 days without a job.
            {space.free !== null &&
              ` ${sizeText(space.free)} free on this disk.`}
          </p>
        </div>
      )}
    </div>
  );
}

/** How much a job may do there without asking, and where to change it */
function ModeLine({ machine }: { machine: JobsMachine }) {
  const { data: mode } = useJobMode(
    machine.id,
    machine.online && !machine.blocked
  );
  if (!mode || !machine.online || machine.blocked) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-[13px]">
      <p className="text-muted-foreground min-w-0 flex-1">
        {jobModeLine(mode)}
      </p>
      <button
        type="button"
        onClick={() => openSettings("machines")}
        className="text-primary min-h-[40px] flex-none px-2 font-semibold active:opacity-70"
      >
        Change
      </button>
    </div>
  );
}

function MachineCard({
  machine,
  jobs,
  now,
  can,
  showFrom,
}: {
  machine: JobsMachine;
  jobs: readonly Job[];
  now: number;
  can: string;
  showFrom: boolean;
}) {
  const [all, setAll] = useState(false);
  const going = jobs.filter((j) => !isOver(j.state)).reverse();
  const ended = jobs.filter((j) => isOver(j.state));
  const day = dayLine(jobs, now);
  const state = !machine.online
    ? "Off"
    : going.some((j) => j.state !== "queued")
      ? "Busy"
      : "Free";
  return (
    <section
      aria-label={machine.name}
      className="group-card bg-card divide-border/60 divide-y overflow-hidden rounded-xl"
    >
      <div className="flex items-start gap-3 px-3 py-3">
        <span className="bg-primary/15 text-primary grid h-[30px] w-[30px] flex-none place-items-center rounded-lg">
          <Laptop className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-[16px] font-semibold">{machine.name}</h2>
          <p className="text-muted-foreground text-[13px] break-words">{can}</p>
        </div>
        <span
          className={cn(
            "mt-1 flex-none rounded-full px-2 py-0.5 text-[12px] font-semibold",
            state === "Off"
              ? "bg-foreground/10 text-muted-foreground"
              : state === "Busy"
                ? "bg-primary/15 text-primary"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          )}
        >
          {state}
        </span>
      </div>
      {machine.blocked && (
        <div className="flex items-center gap-2 px-3 py-2.5 text-[13px]">
          <p className="text-muted-foreground min-w-0 flex-1">
            {machine.online
              ? "Chats here may not send it jobs yet. Only you can allow that."
              : "It takes jobs again when it is back on."}
          </p>
          {machine.online && (
            <button
              type="button"
              onClick={() => openSettings("machines")}
              className="text-primary min-h-[40px] flex-none px-2 font-semibold active:opacity-70"
            >
              Open Settings
            </button>
          )}
        </div>
      )}
      {going.map((job) => (
        <JobLine
          key={job.id}
          job={job}
          now={now}
          from={showFrom}
          onOpen={(j) => openJob(j.id)}
        />
      ))}
      {going.length === 0 && !machine.blocked && (
        <p className="text-muted-foreground px-3 py-2.5 text-[13px]">
          No job is running here.
        </p>
      )}
      {day && (
        <div className="flex items-center gap-2 px-3 py-1 text-[13px]">
          <p className="text-muted-foreground min-w-0 flex-1">{day}</p>
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll(!all)}
            className="text-primary min-h-[40px] flex-none px-2 font-semibold active:opacity-70"
          >
            {all ? "Hide" : "See all"}
          </button>
        </div>
      )}
      {all &&
        ended
          .slice(0, 30)
          .map((job) => (
            <JobLine
              key={job.id}
              job={job}
              now={now}
              from={showFrom}
              onOpen={(j) => openJob(j.id)}
            />
          ))}
      <ModeLine machine={machine} />
      <Space machine={machine} />
    </section>
  );
}

/**
 * Runners: the machines linked to this server, what each can do, and the
 * jobs chats handed them. From a chat's own jobs, only that chat's
 */
export function RunnersPage({ page, view }: PageProps<"runners">) {
  const only = page.sessionId ?? null;
  const { data, isLoading } = useJobs(only);
  const { data: machines } = useMachines();
  const abilities = useTargetAbilities();
  const now = useJobClock(data?.jobs);
  const mode = useLayoutMode();
  const native = useIsNative();
  const back = PAGE_BARS.includes(mode) || (native && !nativeCaps().column);
  const jobs = data?.jobs ?? [];
  const list = data?.machines ?? [];
  const sessionName = only
    ? (view.sessions.find((s) => s.id === only)?.name ?? "this chat")
    : null;
  const running = jobs.filter(
    (j) => j.state === "running" || j.state === "sending"
  ).length;
  const waiting = jobs.filter((j) => j.state === "waiting").length;
  const queued = jobs.filter((j) => j.state === "queued").length;
  const hub = abilities(HUB_TARGET);
  const here = data?.here || machines?.serverName || "This server";
  const sending = new Set(
    jobs.filter((j) => !isOver(j.state)).map((j) => j.sessionId)
  ).size;
  const summary = [
    count(list.length, "machine", "machines"),
    running > 0 ? count(running, "job running", "jobs running") : null,
    waiting > 0 ? `${waiting} waiting for you` : null,
    queued > 0 ? `${queued} waiting their turn` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
        mode === "duo-closed" ? "pt-[18px] pr-2 pl-5" : "px-5 pt-5"
      )}
    >
      {back && (
        <button
          type="button"
          onClick={() => runNav("back")}
          aria-label="Back"
          className="text-muted-foreground active:bg-accent -ml-2 flex h-[44px] w-[44px] items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <header className="flex shrink-0 flex-col">
        <h1 className="t-large">Runners</h1>
        {sessionName ? (
          <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-2 text-[14px]">
            <span className="min-w-0 flex-1 truncate">
              Jobs from {sessionName}
            </span>
            <button
              type="button"
              onClick={() => {
                workspacePageStore.page = { kind: "runners" };
              }}
              className="text-primary active:bg-accent min-h-[44px] shrink-0 rounded-full px-3 text-[15px] font-medium"
            >
              Show all
            </button>
          </div>
        ) : (
          <p className="text-muted-foreground mt-1 text-[14px]">
            {list.length > 0
              ? summary
              : "A chat stays where it is and hands a job to the machine that can do it."}
          </p>
        )}
      </header>
      {isLoading ? (
        <div className="text-muted-foreground grid min-h-0 flex-1 place-items-center p-6">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : list.length === 0 ? (
        <div className="bg-card flex flex-col gap-2 rounded-xl p-4 text-[15px]">
          <p>No other machine is linked yet.</p>
          <p className="text-muted-foreground text-[14px]">
            Link your Mac and a chat here can hand it the work only a Mac can
            do, an iOS build or the simulator, while the chat stays on {here}.
          </p>
          <button
            type="button"
            onClick={() => openSettings("machines")}
            className="bg-primary text-primary-foreground mt-1 min-h-[44px] self-start rounded-xl px-4 text-[15px] font-semibold active:opacity-70"
          >
            Link a machine
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((machine) => {
            const a = abilities(machine.id);
            return (
              <MachineCard
                key={machine.id}
                machine={machine}
                jobs={jobs.filter((j) => j.machineId === machine.id)}
                now={now}
                showFrom={!only}
                can={
                  a
                    ? [systemText(a), shortText(a)].filter(Boolean).join(" · ")
                    : "Not checked yet"
                }
              />
            );
          })}
          {!only && (
            <section
              aria-label={here}
              className="group-card bg-card overflow-hidden rounded-xl"
            >
              <div className="flex items-start gap-3 px-3 py-3">
                <span className="bg-foreground/10 text-muted-foreground grid h-[30px] w-[30px] flex-none place-items-center rounded-lg">
                  <Server className="h-4 w-4" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <h2 className="truncate text-[16px] font-semibold">{here}</h2>
                  <p className="text-muted-foreground text-[13px] break-words">
                    {hub
                      ? [systemText(hub), shortText(hub)]
                          .filter(Boolean)
                          .join(" · ")
                      : "This server"}
                  </p>
                  <p className="text-muted-foreground mt-1 text-[13px]">
                    {sending > 0
                      ? `${count(sending, "chat here has", "chats here have")} work on another machine right now.`
                      : "Chats live here and send jobs from here."}
                  </p>
                </div>
              </div>
            </section>
          )}
          <p className="text-muted-foreground px-1 text-[13px]">
            A chat sends a job when its work needs something only another
            machine has, or when you name one with @. One job runs on a machine
            at a time; the rest wait their turn.
          </p>
        </div>
      )}
    </div>
  );
}
