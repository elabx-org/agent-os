"use client";

import { useEffect, useMemo, useState } from "react";
import { GitBranch, Plus } from "lucide-react";
import { InboxItem } from "@/components/Inbox";
import { UsageMonitor } from "@/components/UsageMonitor";
import { getTimeAgo, statusConfig } from "@/components/SessionCard";
import type { SessionStatus } from "@/components/views/types";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";

type Status = SessionStatus["status"];
type Filter = "all" | "running" | "waiting" | "idle";
type Tab = "now" | "projects";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Needs you" },
  { id: "running", label: "Working" },
  { id: "idle", label: "Idle" },
];

// Needs you first, then working, then the rest
const ORDER: Record<Status, number> = {
  waiting: 0,
  running: 1,
  error: 2,
  idle: 3,
  dead: 4,
};

const DOT: Record<Status, string> = {
  waiting: "bg-amber-400 ring-4 ring-amber-400/20",
  running: "bg-blue-400 ring-4 ring-blue-400/20",
  error: "bg-red-400",
  idle: "bg-muted-foreground/60",
  dead: "border-muted-foreground/50 border",
};

const TAB_KEY = "agentos:mission-tab";

interface MissionControlProps {
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  projectNames: Record<string, string>;
  activeSessionId?: string;
  onOpenSession: (session: Session) => void;
  onNewSession: () => void;
  /** The full session list, for managing projects and sessions */
  projectsView: React.ReactNode;
}

/**
 * The app's home: what is waiting on you, answerable in place, then every
 * session by what it is doing. The full list is one tab away.
 */
export function MissionControl({
  sessions,
  sessionStatuses,
  projectNames,
  activeSessionId,
  onOpenSession,
  onNewSession,
  projectsView,
}: MissionControlProps) {
  const [tab, setTab] = useState<Tab>("now");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    try {
      if (localStorage.getItem(TAB_KEY) === "projects") setTab("projects");
    } catch {}
  }, []);
  const chooseTab = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {}
  };

  const rows = useMemo(
    () =>
      sessions
        .filter((s) => !s.conductor_session_id)
        .map((session) => ({
          session,
          status: (sessionStatuses[session.id]?.status ?? "dead") as Status,
        }))
        .sort(
          (a, b) =>
            ORDER[a.status] - ORDER[b.status] ||
            b.session.updated_at.localeCompare(a.session.updated_at)
        ),
    [sessions, sessionStatuses]
  );
  const waiting = rows.filter((r) => r.status === "waiting");
  const counts: Record<Filter, number> = {
    all: rows.length,
    waiting: waiting.length,
    running: rows.filter((r) => r.status === "running").length,
    idle: rows.filter((r) => r.status === "idle").length,
  };
  const shown =
    filter === "all" ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <div
          role="tablist"
          className="bg-secondary flex flex-1 rounded-lg p-0.5 text-sm font-medium"
        >
          {(["now", "projects"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => chooseTab(id)}
              className={cn(
                "h-8 flex-1 rounded-md transition-colors",
                tab === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {id === "now" ? "Now" : "Projects"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onNewSession}
          aria-label="New session"
          className="bg-primary text-primary-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg active:opacity-80"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {tab === "projects" ? (
        <div className="min-h-0 flex-1 overflow-hidden">{projectsView}</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-1 pb-6">
          <UsageMonitor />

          {waiting.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Waiting on you · {waiting.length}
              </h2>
              <ul className="space-y-3">
                {waiting.map(({ session }) => (
                  <InboxItem
                    key={session.id}
                    session={session}
                    projectName={
                      session.project_id
                        ? projectNames[session.project_id]
                        : undefined
                    }
                    onOpen={() => onOpenSession(session)}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Sessions
            </h2>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {FILTERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                  className={cn(
                    "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                    filter === id
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {label} {counts[id]}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {rows.length ? "None right now" : "No sessions yet"}
              </p>
            ) : (
              <ul className="divide-border bg-card border-border divide-y overflow-hidden rounded-2xl border">
                {shown.map(({ session, status }) => {
                  const project = session.project_id
                    ? projectNames[session.project_id]
                    : undefined;
                  const config = statusConfig[status];
                  return (
                    <li key={session.id}>
                      <button
                        type="button"
                        onClick={() => onOpenSession(session)}
                        className={cn(
                          "active:bg-accent flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2.5 text-left",
                          session.id === activeSessionId && "bg-primary/10"
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            DOT[status]
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {project && (
                              <span className="font-semibold">
                                {project} ·{" "}
                              </span>
                            )}
                            {session.name}
                          </span>
                          <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                            <span
                              className={cn(
                                (status === "running" ||
                                  status === "waiting") &&
                                  config.color
                              )}
                            >
                              {config.word}
                            </span>
                            {session.branch_name && (
                              <>
                                <span>·</span>
                                <GitBranch className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {session.branch_name}
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {getTimeAgo(session.updated_at)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
