"use client";

import { serverNameOr } from "@/lib/server-name";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Laptop, Loader2, Server, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import { followLink, hubFetch } from "@/lib/client/machine";
import { HUB_TARGET } from "@/lib/machine-marker";
import {
  projectMoveSummary,
  projectStepText,
  type ProjectMoveJob,
} from "@/lib/project-move-types";
import { useMachines, useTabMachineId } from "@/data/machines";
import { mobileNavStore } from "@/stores/mobileNav";
import type { ProjectContinue } from "@/stores/continueSheet";
import { SheetTitle } from "@/components/ui/sheet";
import { useTargets } from "./ContinueOnSheet";
import { copySetupGap, useSetupGap } from "./SetupGap";

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The sheet for a whole project (ContinueOnSheetHost draws it): where it
 * goes, what goes and what stays, the chats to take, then each step as the
 * hub runs it (lib/link/project-move.ts)
 */
export function ProjectContinueBody({
  project,
  from,
  prefer,
  back,
  onClose,
  confirmRef,
  busyRef,
}: {
  project: ProjectContinue;
  from: string;
  /** The machine picked to begin with (bringing chats back: this one) */
  prefer?: string;
  /** Opened from "Bring back" */
  back: boolean;
  onClose: () => void;
  confirmRef: React.MutableRefObject<(() => void) | null>;
  busyRef: React.MutableRefObject<boolean>;
}) {
  const queryClient = useQueryClient();
  const targets = useTargets(from);
  const mine = useTabMachineId() ?? HUB_TARGET;
  const { data: machines } = useMachines();
  const fromName =
    from === HUB_TARGET
      ? serverNameOr(machines?.serverName)
      : (machines?.machines.find((m) => m.id === from)?.name ?? "that machine");
  const fromHere = from === mine;
  const [picked, setPicked] = useState<string | null>(prefer ?? null);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [job, setJob] = useState<ProjectMoveJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const target =
    targets.find((t) => t.id === picked && !t.blocked) ??
    targets.find((t) => !t.blocked) ??
    null;
  const going = project.chats.filter((c) => !c.blocked && !unticked.has(c.id));
  const asking = !job;
  const gap = useSetupGap(from, asking ? target?.id : undefined);
  const [copyFirst, setCopyFirst] = useState(true);
  const running = job?.state === "running";
  const done = job?.state === "done";
  // Bringing chats back takes at least one; a project can go with none
  const nothing = back && going.length === 0;
  busyRef.current = starting;

  const start = useCallback(async () => {
    if (!target || starting || job || nothing) return;
    setStarting(true);
    setError(null);
    try {
      if (gap && copyFirst) {
        const failed = await copySetupGap(target.id, gap, fetchAsUser);
        if (failed) {
          setError(
            `Couldn't copy the skills and plugins: ${failed}. Untick "Copy them first" to go without them.`
          );
          return;
        }
      }
      const res = await fetchAsUser("/api/machines/project-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: back ? undefined : project.id,
          projectName: project.name,
          from,
          to: target.id,
          sessions: going.map((c) => ({ id: c.id, name: c.name })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(refusalText(body));
        return;
      }
      setJob(body as ProjectMoveJob);
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setStarting(false);
    }
  }, [
    target,
    starting,
    job,
    nothing,
    gap,
    copyFirst,
    back,
    project,
    from,
    going,
  ]);
  confirmRef.current = start;

  // The hub runs it; this only watches
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || !running) return;
    let misses = 0;
    const lost = () =>
      setError(
        "Lost track of it (the server may have restarted). Check where each chat is before trying again."
      );
    const timer = setInterval(async () => {
      try {
        const res = await hubFetch(`/api/machines/project-move?id=${jobId}`);
        if (res.ok) {
          misses = 0;
          setJob((await res.json()) as ProjectMoveJob);
        } else if (res.status === 404 || ++misses >= 20) {
          clearInterval(timer);
          lost();
        }
      } catch {
        if (++misses >= 20) {
          clearInterval(timer);
          lost();
        }
      }
    }, 700);
    return () => clearInterval(timer);
  }, [jobId, running]);

  useEffect(() => {
    mobileNavStore.sheetAction =
      job || starting || !target || nothing ? "none" : "move";
  }, [job, starting, target, nothing]);

  useEffect(() => {
    if (!done) return;
    haptic("success");
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  }, [done, queryClient]);

  const toName = job?.toName ?? target?.name ?? "";
  const firstMoved = job?.steps.find(
    (s) => s.kind === "chat" && s.state === "done"
  );
  const where = fromHere ? "here" : `on ${fromName}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 [html[data-fold=horizontal]_&]:gap-2.5">
      <div className="min-w-0">
        <SheetTitle className="t-title text-[20px] leading-tight font-bold tracking-normal">
          {back ? "Bring its chats back" : "Continue on another machine"}
        </SheetTitle>
        <p className="text-muted-foreground mt-1 truncate text-[13px]">
          {project.name}
        </p>
      </div>

      {!job && (
        <>
          <div
            role="radiogroup"
            aria-label="Where to continue it"
            className="bg-card divide-border/60 divide-y overflow-hidden rounded-2xl"
          >
            {targets.length === 0 && (
              <p className="text-muted-foreground px-4 py-3 text-[15px]">
                No other machine is linked yet. Link one in Settings, Machines.
              </p>
            )}
            {targets.map((t) => {
              const Icon = t.kind === "mac" ? Laptop : Server;
              const selected = target?.id === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!!t.blocked}
                  onClick={() => setPicked(t.id)}
                  className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left active:opacity-80 disabled:opacity-50"
                >
                  <Icon
                    aria-hidden
                    className="text-muted-foreground h-5 w-5 flex-none"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px]">
                      {cap(t.name)}
                    </span>
                    <span className="text-muted-foreground block text-[13px]">
                      {t.blocked ?? "Ready"}
                    </span>
                  </span>
                  {selected && (
                    <Check aria-hidden className="text-primary h-5 w-5" />
                  )}
                </button>
              );
            })}
          </div>

          {project.chats.length > 0 && (
            <div
              role="group"
              aria-label="Chats to take"
              className="bg-card divide-border/60 divide-y overflow-hidden rounded-2xl"
            >
              {project.chats.map((chat) => {
                const on = !chat.blocked && !unticked.has(chat.id);
                return (
                  <label
                    key={chat.id}
                    className={cn(
                      "flex min-h-[52px] w-full items-center gap-3 px-4 py-2",
                      chat.blocked && "opacity-60"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px]">
                        {chat.name}
                      </span>
                      <span className="text-muted-foreground block text-[13px]">
                        {chat.blocked ??
                          "Conversation, branch and uncommitted changes"}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      className="accent-primary h-5 w-5 shrink-0"
                      checked={on}
                      disabled={!!chat.blocked}
                      aria-label={`Take ${chat.name}`}
                      onChange={(e) =>
                        setUnticked((was) => {
                          const next = new Set(was);
                          if (e.target.checked) next.delete(chat.id);
                          else next.add(chat.id);
                          return next;
                        })
                      }
                    />
                  </label>
                );
              })}
            </div>
          )}

          <ul className="text-muted-foreground flex flex-col gap-1.5 px-1 text-[13px] leading-snug">
            {back ? (
              <li>
                Each chat comes back with what was done on {fromName}: the
                conversation, its branch and uncommitted changes.
              </li>
            ) : (
              <>
                <li>
                  <span className="text-foreground">Goes:</span> the code, and
                  the project itself (its name, defaults, instructions and dev
                  server setup)
                  {target ? `, set up on ${target.name}` : ""}.
                  {going.length === 0 &&
                    " With no chat to carry it, the code is cloned from its remote, so only what is pushed arrives."}
                </li>
                <li>
                  <span className="text-foreground">Stays {where}:</span> files
                  git ignores (like .env and installed packages), terminals,
                  running dev servers and the project&apos;s hooks.
                </li>
                <li>
                  Nothing is removed {where}. The project stays, and each chat
                  that goes says where it went. You can bring them back the same
                  way.
                </li>
              </>
            )}
            {gap && target && (
              <li>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary mt-0.5 h-4 w-4 shrink-0"
                    checked={copyFirst}
                    onChange={(e) => setCopyFirst(e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="text-foreground">Copy them first:</span>{" "}
                    {target.name} is missing {gap.sentence} that {fromName} has.
                    Choose which in Settings, Machines.
                  </span>
                </label>
              </li>
            )}
          </ul>
        </>
      )}

      {job && (
        <ol
          aria-label="Progress"
          className="bg-card flex flex-col gap-2.5 rounded-2xl px-4 py-3.5"
        >
          {job.steps.map((step, i) => (
            <li
              key={step.sessionId ?? `project-${i}`}
              className={cn(
                "flex items-start gap-3 text-[15px]",
                step.state === "todo" && "text-muted-foreground"
              )}
            >
              <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center">
                {step.state === "done" ? (
                  <Check aria-hidden className="text-primary h-4 w-4" />
                ) : step.state === "now" ? (
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                ) : step.state === "failed" ? (
                  <X aria-hidden className="h-4 w-4 text-[var(--del)]" />
                ) : (
                  <span
                    aria-hidden
                    className="bg-muted-foreground/40 h-1.5 w-1.5 rounded-full"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words">
                  {projectStepText(step, job.toName)}
                </span>
                {step.note && (
                  <span
                    className={cn(
                      "block text-[13px] break-words",
                      step.state === "failed"
                        ? "text-[var(--del)]"
                        : "text-muted-foreground"
                    )}
                  >
                    {cap(step.note)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      {running && (
        <p
          aria-live="polite"
          className="text-muted-foreground px-1 text-[13px]"
        >
          You can close this. It carries on, one chat at a time, and each chat
          shows where it ended up.
        </p>
      )}
      {done && job && (
        <p
          aria-live="polite"
          className="text-muted-foreground px-1 text-[13px]"
        >
          {projectMoveSummary(job)}.
          {job.steps.some((step) => step.state === "failed") &&
            ` A chat that didn't move runs ${where} as it was.`}
        </p>
      )}

      <div className="sticky bottom-0 mt-auto flex flex-col gap-1.5 bg-[var(--sheet)] pt-1">
        {error && (
          <p role="alert" className="text-center text-[13px] text-[var(--del)]">
            {error}
          </p>
        )}
        {done ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              if (firstMoved?.sessionId)
                followLink(job!.to, firstMoved.sessionId);
            }}
            className="pill pill-primary h-[52px] w-full rounded-[26px] text-base active:opacity-80"
          >
            <span className="truncate">
              {firstMoved ? `Open ${firstMoved.name} on ${toName}` : "Done"}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={!target || starting || !!job || nothing}
            className="pill pill-primary h-[52px] w-full rounded-[26px] text-base active:opacity-80 disabled:opacity-50"
          >
            {(starting || running) && (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            )}
            <span className="truncate">
              {running
                ? `Moving to ${toName}`
                : !target
                  ? "Continue"
                  : back && target.id === mine
                    ? going.length === 1
                      ? "Bring 1 chat back here"
                      : `Bring ${going.length} chats back here`
                    : `Continue on ${target.name}`}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
