"use client";

import { serverNameOr } from "@/lib/server-name";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Laptop, Loader2, Server, X } from "lucide-react";
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
  parseMovedTo,
  type MoveJob,
  type MoveStep,
} from "@/lib/session-move-types";
import type { MovePlan } from "@/lib/repos-dir";
import { isOnline, useMachines, useTabMachineId } from "@/data/machines";
import { mobileNavStore } from "@/stores/mobileNav";
import { closeContinueSheet, continueSheetStore } from "@/stores/continueSheet";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { copySetupGap, useSetupGap } from "./SetupGap";
import { ProjectContinueBody } from "./ProjectContinueBody";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

/** The column's sheet id while this is up: × and its confirm */
const SHEET_ID = "continue";
const STEPS: MoveStep[] = [
  "pausing",
  "preparing",
  "code",
  "conversation",
  "starting",
];

export interface Target {
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
  session:
    | (Pick<Session, "agent_type" | "paused_at"> &
        Partial<Pick<Session, "moved_to">>)
    | null
    | undefined
): boolean {
  const { data } = useMachines();
  const mine = useTabMachineId();
  if (!session || !data?.enabled) return false;
  if ((session.agent_type || "claude") !== "claude" || isPaused(session)) {
    return false;
  }
  // The copy left behind: its bar brings the live one back
  if (parseMovedTo(session.moved_to)) return false;
  return mine !== null || data.machines.some((m) => m.status === "approved");
}

export function useTargets(from: string): Target[] {
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
        name: serverNameOr(data.serverName),
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
  back,
  onClose,
  confirmRef,
  busyRef,
}: {
  sessionId: string;
  name: string;
  from: string;
  /** The machine picked to begin with (bringing one back: this one) */
  prefer?: string;
  /** Opened from "Bring it back" */
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
  /** "here" only when this tab looks at the machine it leaves */
  const fromHere = from === mine;
  const [picked, setPicked] = useState<string | null>(prefer ?? null);
  const [job, setJob] = useState<MoveJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const target =
    targets.find((t) => t.id === picked && !t.blocked) ??
    targets.find((t) => !t.blocked) ??
    null;
  // Where it would land there, asked before it moves (changes nothing)
  const targetId = target?.id;
  const [plan, setPlan] = useState<{ to: string; plan: MovePlan } | null>(null);
  const asking = !job;
  useEffect(() => {
    if (!targetId || !asking) return;
    let gone = false;
    fetchAsUser("/api/machines/move/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, from, to: targetId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: MovePlan | null) => {
        if (!gone && body) setPlan({ to: targetId, plan: body });
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [targetId, sessionId, from, asking]);
  const landing = plan && plan.to === targetId ? plan.plan : null;
  // Skills and plugins the server has that the machine it goes to doesn't
  const gap = useSetupGap(from, asking ? targetId : undefined);
  const [copyFirst, setCopyFirst] = useState(true);
  const running = !!job && job.step !== "done" && job.step !== "failed";
  // A move in flight runs on the server: closing the sheet doesn't stop it
  busyRef.current = starting;

  const start = useCallback(async () => {
    if (!target || starting || running) return;
    setStarting(true);
    setError(null);
    setJob(null);
    try {
      if (gap && copyFirst) {
        const failed = await copySetupGap(target.id, gap, fetchAsUser);
        if (failed) {
          setError(
            `Couldn't copy the skills and plugins: ${failed}. Untick "Copy them first" to move without them.`
          );
          return;
        }
      }
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
  }, [target, starting, running, sessionId, from, gap, copyFirst]);
  confirmRef.current = start;

  // The hub runs it; this only watches
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || !running) return;
    let misses = 0;
    const lost = () =>
      setJob((was) =>
        was && was.step !== "done" && was.step !== "failed"
          ? {
              ...was,
              failedAt: was.step,
              step: "failed",
              error: "Lost track of the move (the server may have restarted).",
            }
          : was
      );
    const timer = setInterval(async () => {
      try {
        const res = await hubFetch(`/api/machines/move?id=${jobId}`);
        if (res.ok) {
          misses = 0;
          setJob((await res.json()) as MoveJob);
        } else if (res.status === 404 || ++misses >= 20) {
          lost();
        }
      } catch {
        // The next tick asks again, for a while
        if (++misses >= 20) lost();
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
  const failed = job?.step === "failed";
  const at = job ? STEPS.indexOf(failed ? job.failedAt! : job.step) : -1;
  const stepText = (step: MoveStep) =>
    moveStepText(step, toName, fromHere ? undefined : fromName);
  const afterFailure =
    job?.restored === true
      ? fromHere
        ? "Nothing was lost; it runs here again, as it was."
        : `Nothing was lost; it runs on ${fromName} again, as it was.`
      : job?.restored === false
        ? `Nothing was lost, but it stays paused on ${fromName}.`
        : `It may be paused on ${fromName}: check where it runs before resuming it.`;
  const folder = job?.result?.folder.replace(/^\/(Users|home)\/[^/]+/, "~");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 [html[data-fold=horizontal]_&]:gap-2.5">
      <div className="min-w-0">
        <SheetTitle className="t-title text-[20px] leading-tight font-bold tracking-normal">
          {target ? `Work on ${target.name}` : "Work on another machine"}
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
            {landing && target && (
              <li className="break-words">
                {landing.mode === "clone" ? (
                  <>
                    {cap(target.name)} doesn&apos;t have this repository yet: it
                    will be put in{" "}
                    <span className="text-foreground font-mono text-[12px]">
                      {landing.folder}
                    </span>
                    . Change the folder in Settings, Machines.
                  </>
                ) : landing.mode === "return" ? (
                  <>
                    It goes back to its folder,{" "}
                    <span className="text-foreground font-mono text-[12px]">
                      {landing.folder}
                    </span>
                    .
                  </>
                ) : (
                  <>
                    It will use the repository already on {target.name}, in{" "}
                    <span className="text-foreground font-mono text-[12px]">
                      {landing.folder}
                    </span>
                    , working in its own folder so your files there aren&apos;t
                    touched.
                  </>
                )}
              </li>
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
            <li>
              It pauses {fromHere ? "here" : `on ${fromName}`}, so only one copy
              ever runs.
            </li>
            <li>
              Servers and terminals it started{" "}
              {fromHere ? "here stay here" : `on ${fromName} stay there`}, and
              so do files git ignores, like .env.
              {back ? "" : " You can bring it back the same way."}
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
              done || (at >= 0 && i < at)
                ? "done"
                : i === at
                  ? failed
                    ? "failed"
                    : "now"
                  : "todo";
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
                  ) : state === "failed" ? (
                    <X aria-hidden className="h-4 w-4 text-[var(--del)]" />
                  ) : (
                    <span
                      aria-hidden
                      className="bg-muted-foreground/40 h-1.5 w-1.5 rounded-full"
                    />
                  )}
                </span>
                {stepText(step)}
                <span className="sr-only">
                  {state === "done"
                    ? ", done"
                    : state === "now"
                      ? ", in progress"
                      : state === "failed"
                        ? ", failed"
                        : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {running && (
        <p
          aria-live="polite"
          className="text-muted-foreground px-1 text-[13px]"
        >
          <span className="sr-only">{stepText(job!.step)}. </span>
          You can close this. The move carries on, and the session shows where
          it ended up.
        </p>
      )}

      {done && job?.result && (
        <div className="text-muted-foreground flex flex-col gap-1 px-1 text-[13px]">
          <p className="break-words">
            It&apos;s in {folder} on {toName}.
          </p>
          {job.warning && <p className="text-[var(--del)]">{job.warning}.</p>}
          {job.result.needsTrust && (
            <p>
              Claude is asking whether to trust that folder. Open it on {toName}{" "}
              and answer.
            </p>
          )}
          {job.result.noRemoteAccess && (
            <p>
              {toName} couldn&apos;t reach this repository&apos;s remote, so
              Claude can&apos;t push or pull there yet. Sign in to git or GitHub
              on {toName} (for example, gh auth login).
            </p>
          )}
          {job.result.fullAccessOff && (
            <p>
              Full access didn&apos;t travel with it: on {toName} it asks before
              risky actions. You can turn it back on there.
            </p>
          )}
          {job.result.renamedFrom && (
            <p>
              Its branch is called {job.result.branch} there:{" "}
              {job.result.renamedFrom} was already in use.
            </p>
          )}
          {job.result.leftBehind.length > 0 && (
            <p>
              {job.result.leftBehind.length === 1
                ? "One file was too large to bring, or is in a submodule, and stayed"
                : `${job.result.leftBehind.length} files were too large to bring, or are in a submodule, and stayed`}{" "}
              behind: {job.result.leftBehind.join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="sticky bottom-0 mt-auto flex flex-col gap-1.5 bg-[var(--sheet)] pt-1">
        {(error || job?.step === "failed") && (
          <p role="alert" className="text-center text-[13px] text-[var(--del)]">
            {error ?? job?.error}
            {error ? "" : job?.error?.endsWith(".") ? " " : ". "}
            {failed && !error && afterFailure}
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
                ? stepText(job!.step)
                : failed
                  ? "Try again"
                  : target
                    ? `Work on ${target.name}`
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
  // Only the moment it is being asked for holds the sheet open
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
        {current?.project ? (
          <ProjectContinueBody
            key={`project:${current.project.id ?? current.from}`}
            project={current.project}
            from={current.from ?? mine ?? HUB_TARGET}
            prefer={current.from ? (mine ?? HUB_TARGET) : undefined}
            back={!!current.from}
            onClose={closeContinueSheet}
            confirmRef={confirmRef}
            busyRef={busyRef}
          />
        ) : current ? (
          <Body
            key={current.sessionId}
            sessionId={current.sessionId}
            name={current.name}
            from={current.from ?? mine ?? HUB_TARGET}
            prefer={current.from ? (mine ?? HUB_TARGET) : undefined}
            back={!!current.from}
            onClose={closeContinueSheet}
            confirmRef={confirmRef}
            busyRef={busyRef}
          />
        ) : (
          <SheetTitle className="sr-only">Work on another machine</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}
