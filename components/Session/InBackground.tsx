"use client";

import { useEffect, useState } from "react";
import { Layers, Loader2 } from "lucide-react";
import { proxy, useSnapshot } from "valtio";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";
import type { BackgroundAgent } from "@/lib/claude-background";
import { poll } from "@/components/BackgroundAgents";

/** "In background" in a crumb or a list row */
export const IN_BACKGROUND_CLASS = "text-sky-600 dark:text-sky-400";

/** The tag a background agent's header and a parked session's row carry */
export function BackgroundBadge({
  label = "Background agent",
}: {
  label?: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/12 px-1.5 py-px text-[11px] font-medium text-sky-700 dark:text-sky-300">
      <Layers aria-hidden className="h-3 w-3" />
      {label}
    </span>
  );
}

// Per session: "Bring back when done" waiting on the turn, and the agent
// "Leave it there" left (the banner stays away for that one)
const store = proxy<{
  waiting: Record<string, true>;
  busy: Record<string, true>;
}>({ waiting: {}, busy: {} });
const LEFT_KEY = "agentos-left-in-background";

function leftThere(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LEFT_KEY) || "{}");
  } catch {
    return {};
  }
}

function leaveThere(sessionId: string, agentId: string) {
  try {
    localStorage.setItem(
      LEFT_KEY,
      JSON.stringify({ ...leftThere(), [sessionId]: agentId })
    );
  } catch {
    // Private mode: it shows again next time
  }
}

/** Stops the background copy and resumes the session in its own terminal */
async function bringBack(session: Session): Promise<void> {
  store.busy[session.id] = true;
  try {
    const res = await fetch(`/api/sessions/${session.id}/bring-back`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't bring it back");
    // The banner and the tag go now, not at the next poll
    void poll();
    window.dispatchEvent(
      new CustomEvent("agentos-session-restarted", {
        detail: { session: data.session },
      })
    );
    toast.success("Brought back from the background");
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Couldn't bring it back"
    );
  } finally {
    delete store.busy[session.id];
  }
}

/**
 * Claude moved this session to its background agents (← on an empty
 * prompt opens its agent view): say so above the terminal, with the way
 * back. Mid-turn, the way back waits for the turn to end.
 */
export function InBackgroundBanner({
  session,
  agent,
}: {
  session: Session;
  agent: BackgroundAgent;
}) {
  const { waiting, busy } = useSnapshot(store);
  const [left, setLeft] = useState(() => leftThere()[session.id] === agent.id);
  const working = agent.state === "working";
  const isWaiting = !!waiting[session.id];
  const isBusy = !!busy[session.id];

  // The turn ended: bring it back as asked
  useEffect(() => {
    if (!isWaiting || working || isBusy) return;
    delete store.waiting[session.id];
    void bringBack(session);
  }, [isWaiting, working, isBusy, session]);

  if (left && !isWaiting) return null;
  const since = agent.startedAt
    ? new Date(agent.startedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const what = working
    ? isWaiting
      ? "It comes back here when this turn ends."
      : "It's working on a turn there; bringing it back now would stop that turn."
    : "It keeps running there, so this terminal shows Claude's agent instead of the session.";

  return (
    <div
      role="status"
      className="border-border/60 mx-[max(0.75rem,env(safe-area-inset-left))] mt-2 mb-1 flex shrink-0 flex-col gap-2.5 rounded-2xl border bg-sky-500/8 px-3.5 py-3 dark:bg-sky-400/10"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300">
          <Layers aria-hidden className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] leading-snug font-semibold">
            Moved to Claude&apos;s background agents
          </div>
          <div className="text-muted-foreground text-[12.5px] leading-snug">
            {since && `Since ${since} · `}
            {what}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isBusy || isWaiting}
          onClick={() => {
            if (working) store.waiting[session.id] = true;
            else void bringBack(session);
          }}
          className="pill pill-primary pill-sm inline-flex items-center gap-1.5 disabled:opacity-70"
        >
          {(isBusy || isWaiting) && (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          )}
          {isWaiting
            ? "Waiting for the turn"
            : working
              ? "Bring back when done"
              : "Bring back here"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (isWaiting) {
              delete store.waiting[session.id];
              return;
            }
            leaveThere(session.id, agent.id);
            setLeft(true);
          }}
          className={cn("pill pill-secondary pill-sm")}
        >
          {isWaiting ? "Cancel" : "Leave it there"}
        </button>
      </div>
    </div>
  );
}
