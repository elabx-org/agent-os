"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Laptop, Loader2, Server } from "lucide-react";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { registerNavHandlers } from "@/lib/nav-actions";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import { followLink, hubFetch } from "@/lib/client/machine";
import { HUB_TARGET } from "@/lib/machine-marker";
import { isPaused } from "@/lib/handoff-types";
import {
  moveStepText,
  type MoveJob,
  type MoveStep,
} from "@/lib/session-move-types";
import { isOnline, useMachines, useTabMachineId } from "@/data/machines";
import { mobileNavStore } from "@/stores/mobileNav";
import { closeContinueSheet, continueSheetStore } from "@/stores/continueSheet";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

/** The column's sheet id while this is up: × and its confirm */
const SHEET_ID = "move";
const STEPS: MoveStep[] = [
  "pausing",
  "preparing",
  "code",
  "conversation",
  "starting",
];

interface Target {
  id: string;
  name: string;
  kind: "mac" | "server";
  /** Why it can't take a session now, null when it can */
  blocked: string | null;
}

/**
 * Whether "Continue on…" is offered for a session: linked machines are on,
 * there is somewhere else to go, and it is a Claude session that wasn't
 * handed off
 */
export function useCanContinueElsewhere(
  session: Pick<Session, "agent_type" | "paused_at"> | null | undefined
): boolean {
  const { data } = useMachines();
  const mine = useTabMachineId();
  if (!session || !data?.enabled) return false;
  if ((session.agent_type || "claude") !== "claude" || isPaused(session)) {
    return false;
  }
  return mine !== null || data.machines.some((m) => m.status === "approved");
}

function useTargets(from: string): Target[] {
  const { data } = useMachines(5000);
  return useMemo(() => {
    if (!data?.enabled) return [];
    const out: Target[] = data.machines
      .filter((m) => m.status === "approved" && m.id !== from)
      .map((m) => ({
        id: m.id,
        name: m.name,
        kind: "mac" as const,
        blocked: !isOnline(m)
          ? "Offline"
          : m.sameVersion === false
            ? "Updating to this server's version"
            : null,
      }));
    if (from !== HUB_TARGET) {
      out.unshift({
        id: HUB_TARGET,
        name: "the server",
        kind: "server",
        blocked: null,
      });
    }
    return out;
  }, [data, from]);
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Body({
  sessionId,
  name,
  from,
  prefer,
  onClose,
  confirmRef,
  busyRef,
}: {
  sessionId: string;
  name: string;
  from: string;
  /** The machine picked to begin with (bringing one back: this one) */
  prefer?: string;
  onClose: () => void;
  confirmRef: React.MutableRefObject<(() => void) | null>;
  busyRef: React.MutableRefObject<boolean>;
}) {
  const queryClient = useQueryClient();
  const targets = useTargets(from);
  const [picked, setPicked] = useState<string | null>(prefer ?? null);
  const [job, setJob] = useState<MoveJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const target =
    targets.find((t) => t.id === picked && !t.blocked) ??
    targets.find((t) => !t.blocked) ??
    null;
  const running = !!job && job.step !== "done" && job.step !== "failed";
  busyRef.current = starting || running;

  const start = useCallback(async () => {
    if (!target || starting || running) return;
    setStarting(true);
    setError(null);
    setJob(null);
    try {
      const res = await fetchAsUser("/api/machines/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, from, to: target.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(refusalText(body));
        return;
      }
      setJob(body as MoveJob);
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setStarting(false);
    }
  }, [target, starting, running, sessionId, from]);
  confirmRef.current = start;

  // The hub runs it; this only watches
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || !running) return;
    const timer = setInterval(async () => {
      try {
        const res = await hubFetch(`/api/machines/move?id=${jobId}`);
        if (res.ok) setJob((await res.json()) as MoveJob);
      } catch {
        // The next tick asks again
      }
    }, 700);
    return () => clearInterval(timer);
  }, [jobId, running]);

  useEffect(() => {
    mobileNavStore.sheetAction =
      running || starting || job?.step === "done" || !target ? "none" : "move";
  }, [running, starting, job?.step, target]);

  const done = job?.step === "done";
  useEffect(() => {
    if (!done) return;
    haptic("success");
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  }, [done, queryClient]);

  const toName = job?.toName ?? target?.name ?? "";
  const at = job ? STEPS.indexOf(job.step) : -1;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 [html[data-fold=horizontal]_&]:gap-2.5">
      <div className="min-w-0">
        <SheetTitle className="t-title text-[20px] leading-tight font-bold tracking-normal">
          Continue on another machine
        </SheetTitle>
        <p className="text-muted-foreground mt-1 truncate text-[13px]">
          {name}
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

          <ul className="text-muted-foreground flex flex-col gap-1.5 px-1 text-[13px] leading-snug">
            <li>
              The same conversation, branch and uncommitted changes go
              {target ? ` to ${target.name}` : " along"}.
            </li>
            <li>It pauses here, so only one copy ever runs.</li>
            <li>
              Servers and terminals it started here stay here. You can bring it
              back the same way.
            </li>
          </ul>
        </>
      )}

      {job && (
        <ol
          aria-label="Progress"
          className="bg-card flex flex-col gap-2.5 rounded-2xl px-4 py-3.5"
        >
          {STEPS.map((step, i) => {
            const state =
              done || (at >= 0 && i < at) ? "done" : i === at ? "now" : "todo";
            return (
              <li
                key={step}
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
                  ) : (
                    <span
                      aria-hidden
                      className="bg-muted-foreground/40 h-1.5 w-1.5 rounded-full"
                    />
                  )}
                </span>
                {moveStepText(step, toName)}
              </li>
            );
          })}
        </ol>
      )}

      {done && job?.result && (
        <div className="text-muted-foreground flex flex-col gap-1 px-1 text-[13px]">
          {job.result.renamedFrom && (
            <p>
              Its branch is called {job.result.branch} there:{" "}
              {job.result.renamedFrom} was already in use.
            </p>
          )}
          {job.result.leftBehind.length > 0 && (
            <p>
              {job.result.leftBehind.length === 1
                ? "One large untracked file stayed"
                : `${job.result.leftBehind.length} large untracked files stayed`}{" "}
              behind: {job.result.leftBehind.join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="sticky bottom-0 mt-auto flex flex-col gap-1.5 bg-[var(--sheet)] pt-1">
        {(error || job?.step === "failed") && (
          <p role="alert" className="text-center text-[13px] text-[var(--del)]">
            {error ?? job?.error}
            {job?.step === "failed" && " Nothing was lost; it's as it was."}
          </p>
        )}
        {done ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              followLink(job!.to, sessionId);
            }}
            className="pill pill-primary h-[52px] w-full rounded-[26px] text-base active:opacity-80"
          >
            <span className="truncate">Open it on {toName}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={!target || starting || running}
            className="pill pill-primary h-[52px] w-full rounded-[26px] text-base active:opacity-80 disabled:opacity-50"
          >
            {(starting || running) && (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            )}
            <span className="truncate">
              {running
                ? moveStepText(job!.step, toName)
                : job?.step === "failed"
                  ? "Try again"
                  : target
                    ? `Continue on ${target.name}`
                    : "Continue"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Draws the sheet for continueSheetStore.open, once for the app
 * (components/Providers.tsx): the menus that open it are on several pages
 */
export function ContinueOnSheetHost() {
  const { open: current } = useSnapshot(continueSheetStore);
  const mine = useTabMachineId();
  const { railWidth } = useSnapshot(mobileNavStore);
  const mode = useLayoutMode();
  const open = !!current;
  const [columnRight, setColumnRight] = useState(0);
  useEffect(() => {
    if (!open || (mode !== "duo-open" && mode !== "book")) {
      setColumnRight(0);
      return;
    }
    const measure = () => {
      const column = document.querySelector("[data-control-column]");
      setColumnRight(
        column
          ? Math.max(0, window.innerWidth - column.getBoundingClientRect().left)
          : 0
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, mode]);
  const besideRight = railWidth > 0 ? railWidth : columnRight;
  const beside = besideRight > 0;

  const confirmRef = useRef<(() => void) | null>(null);
  // A move in flight keeps running on the hub; the sheet stays to show it
  const busyRef = useRef(false);
  const close = useCallback(() => {
    if (!busyRef.current) closeContinueSheet();
  }, []);

  useEffect(() => {
    if (!open) return;
    mobileNavStore.sheet = SHEET_ID;
    const unregister = registerNavHandlers({
      closeSheet: close,
      confirmSheet: () => confirmRef.current?.(),
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      unregister();
      window.removeEventListener("keydown", onKey, true);
      if (mobileNavStore.sheet === SHEET_ID) mobileNavStore.sheet = null;
      mobileNavStore.sheetAction = "move";
    };
  }, [open, close]);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        className={cn(
          "sheet-surface bg-[var(--sheet)] pb-[max(16px,env(safe-area-inset-bottom))]",
          "[html[data-fold=horizontal]_&]:top-[calc(var(--fold-end)+0.5rem)] [html[data-fold=horizontal]_&]:mx-0 [html[data-fold=horizontal]_&]:max-h-none [html[data-fold=horizontal]_&]:w-auto [html[data-fold=horizontal]_&]:max-w-none",
          "[html[data-fold=vertical]_&]:right-0 [html[data-fold=vertical]_&]:mx-0 [html[data-fold=vertical]_&]:w-auto [html[data-fold=vertical]_&]:max-w-none",
          "[html[data-hinge]_&]:right-0 [html[data-hinge]_&]:left-[calc(var(--hinge-x)+var(--fold-clear))] [html[data-hinge]_&]:mx-0 [html[data-hinge]_&]:w-auto [html[data-hinge]_&]:max-w-none"
        )}
        data-beside-column={beside ? "" : undefined}
        style={
          beside
            ? { right: besideRight, width: "auto", maxWidth: "none" }
            : undefined
        }
        onPointerDownOutside={(e) => {
          const target = e.target as Element | null;
          if (target?.closest?.("[data-control-column]")) e.preventDefault();
        }}
      >
        <SheetDescription className="sr-only">
          Continue this session on another linked machine, with the same
          conversation, branch and uncommitted changes
        </SheetDescription>
        {current ? (
          <Body
            key={current.sessionId}
            sessionId={current.sessionId}
            name={current.name}
            from={current.from ?? mine ?? HUB_TARGET}
            prefer={current.from ? (mine ?? HUB_TARGET) : undefined}
            onClose={closeContinueSheet}
            confirmRef={confirmRef}
            busyRef={busyRef}
          />
        ) : (
          <SheetTitle className="sr-only">
            Continue on another machine
          </SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}
