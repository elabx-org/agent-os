"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSnapshot } from "valtio";
import { ChevronLeft, Folder, Plus, Search, Terminal } from "lucide-react";
import type { Session } from "@/lib/db";
import type { SessionStatus, ViewProps } from "@/components/views/types";
import { StateDot } from "@/components/a/StateDot";
import { useNeedsYou } from "@/hooks/useNeedsYou";
import { limitStateOf } from "@/lib/limits/types";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { isMacLike } from "@/hooks/useViewShortcuts";
import { runNav } from "@/lib/nav-actions";
import { openPage, workspacePageStore } from "@/stores/workspacePage";
import { newSurfaceStore } from "@/stores/newSurface";
import { mobileNavStore } from "@/stores/mobileNav";
import { cn } from "@/lib/utils";
import { SIDEBAR_PROJECTS, shortAge, sidebarProjects } from "./model";
import { UsageCard } from "./UsageCard";

export interface DesktopSidebarProps {
  /** Sessions, projects, statuses and the handlers (New, Find, open) */
  view: ViewProps;
  /** The session in the focused pane: its row is .srow.sel */
  activeSessionId?: string;
  onOpenSession: (session: Session) => void;
  /** The Projects list, shown in place of the lists after "N more" */
  projectsView?: ReactNode;
}

/** The sidebar's width (Desk-Chat, D-New) */
export const DESKTOP_SIDEBAR_WIDTH = 270;

/** Wider while it holds the Projects list */
export const DESKTOP_PROJECTS_WIDTH = 352;

function SectionLabel({
  children,
  first,
  onClick,
}: {
  children: ReactNode;
  first?: boolean;
  /** Opens the section's own page (Needs you: the cards and the history) */
  onClick?: () => void;
}) {
  const className = cn(
    "text-muted-foreground px-2.5 pb-1.5 text-left text-[13px] font-semibold",
    first ? "pt-1.5" : "pt-2.5",
    onClick && "hover:text-foreground"
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  ) : (
    <div className={className}>{children}</div>
  );
}

const STATE_LABEL = {
  needs: "needs you",
  limited: "limited",
  work: "working",
} as const;

function SessionRows({
  sessions,
  state,
  statuses,
  selectedId,
  onOpenSession,
}: {
  sessions: Session[];
  state: "needs" | "limited" | "work";
  statuses: Record<string, SessionStatus>;
  selectedId?: string;
  onOpenSession: (session: Session) => void;
}) {
  const titles = useListTitles(sessions);
  return sessions.map((s) => {
    const { title } = displayTitle(s, titles);
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => onOpenSession(s)}
        aria-current={s.id === selectedId ? "true" : undefined}
        aria-label={`${title}, ${STATE_LABEL[state]}`}
        title={statuses[s.id]?.lastLine || undefined}
        className={cn(
          "srow hover:bg-foreground/5 w-full flex-none text-left",
          s.id === selectedId && "sel hover:bg-primary/20"
        )}
      >
        <StateDot state={state} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="text-muted-foreground text-[13px] tabular-nums">
          {shortAge(s.updated_at)}
        </span>
      </button>
    );
  });
}

/**
 * The desktop's home (Desk-Chat, D-New): the logo and New pill, Find ⌘K,
 * Needs you / Working / Projects (first 5, "N more"), the usage card at
 * the bottom. With New open it keeps only the lists (D-New); after "N
 * more" it holds the Projects list. Only where useLayoutMode() is
 * "desktop".
 */
export function DesktopSidebar({
  view,
  activeSessionId,
  onOpenSession,
  projectsView,
}: DesktopSidebarProps) {
  const { sessions, projects, sessionStatuses } = view;
  const { page } = useSnapshot(workspacePageStore);
  const { open: newOpen } = useSnapshot(newSurfaceStore);
  const { homeTab } = useSnapshot(mobileNavStore);
  // The server renders the Mac's; others see their own once mounted
  const [findKey, setFindKey] = useState("⌘K");
  useEffect(() => {
    if (!isMacLike()) setFindKey("Ctrl K");
  }, []);

  const { waiting } = useNeedsYou(sessions, sessionStatuses);
  // At a usage limit (M6): their own section, oldest limit first
  const limited = useMemo(
    () =>
      sessions
        .filter((s) => !s.conductor_session_id && limitStateOf(s).limited)
        .sort((a, b) => (a.limited_at ?? 0) - (b.limited_at ?? 0)),
    [sessions]
  );
  // Workers show inside their conductor's session, as on Now
  const working = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            !s.conductor_session_id &&
            sessionStatuses[s.id]?.status === "running" &&
            !limitStateOf(s).limited
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [sessions, sessionStatuses]
  );
  const listed = useMemo(
    () => sidebarProjects(projects, sessions, sessionStatuses),
    [projects, sessions, sessionStatuses]
  );
  const shown = listed.slice(0, SIDEBAR_PROJECTS);
  const more = listed.length - shown.length;

  // Only what the main area shows is marked
  const selectedId = !page && !newOpen ? activeSessionId : undefined;
  const openProjectId =
    page?.kind === "project" || page?.kind === "projectSettings"
      ? page.projectId
      : undefined;

  if (homeTab === "projects" && projectsView)
    return (
      <aside
        aria-label="Projects"
        className="bg-page flex h-full flex-col border-r border-[var(--hair)]"
      >
        <div className="flex items-center gap-1 px-2 pt-3 pb-2">
          <button
            type="button"
            onClick={() => runNav("back")}
            aria-label="Back"
            className="text-muted-foreground hover:bg-accent flex h-9 w-9 items-center justify-center rounded-full"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {/* The list's own large title, sort and + follow (E-Projects) */}
          <h2 className="sr-only">Projects</h2>
        </div>
        <div className="min-h-0 flex-1">{projectsView}</div>
      </aside>
    );

  return (
    <aside
      aria-label="Sessions and projects"
      className="bg-page flex h-full flex-col gap-3.5 border-r border-[var(--hair)] px-3 py-[18px]"
    >
      <div className="flex items-center gap-2.5 px-1.5">
        <span className="bg-primary flex h-7 w-7 flex-none items-center justify-center rounded-lg text-white">
          <Terminal className="h-4 w-4" />
        </span>
        <span className="t-head min-w-0 flex-1 truncate">Agent-OS</span>
        {!newOpen && (
          <button
            type="button"
            onClick={() => runNav("new")}
            className="pill pill-primary pill-sm px-3"
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            New
          </button>
        )}
      </div>

      {newOpen ? (
        <div className="srow sel flex-none">
          <Plus className="h-4 w-4" />
          New session
        </div>
      ) : (
        <button
          type="button"
          onClick={() => runNav("search")}
          className="bg-card text-muted-foreground hover:text-foreground flex h-9 flex-none items-center gap-2 rounded-[10px] px-2.5 text-left text-sm"
        >
          <Search className="h-4 w-4 flex-none" />
          <span className="min-w-0 flex-1 truncate">
            Find sessions, files, projects
          </span>
          <span className="font-mono text-[11px]">{findKey}</span>
        </button>
      )}

      <nav
        aria-label="Sessions"
        className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1"
      >
        {waiting.length > 0 && (
          <>
            <SectionLabel first onClick={() => runNav("inbox")}>
              Needs you
            </SectionLabel>
            <SessionRows
              sessions={waiting}
              state="needs"
              statuses={sessionStatuses}
              selectedId={selectedId}
              onOpenSession={onOpenSession}
            />
          </>
        )}
        {limited.length > 0 && (
          <>
            <SectionLabel first={waiting.length === 0}>Limited</SectionLabel>
            <SessionRows
              sessions={limited}
              state="limited"
              statuses={sessionStatuses}
              selectedId={selectedId}
              onOpenSession={onOpenSession}
            />
          </>
        )}
        {working.length > 0 && (
          <>
            <SectionLabel first={waiting.length + limited.length === 0}>
              Working
            </SectionLabel>
            <SessionRows
              sessions={working}
              state="work"
              statuses={sessionStatuses}
              selectedId={selectedId}
              onOpenSession={onOpenSession}
            />
          </>
        )}
        {!newOpen && shown.length > 0 && (
          <>
            <SectionLabel
              first={waiting.length + limited.length + working.length === 0}
            >
              Projects
            </SectionLabel>
            {shown.map(({ project, live }) => (
              <button
                key={project.id}
                type="button"
                onClick={() =>
                  openPage({ kind: "project", projectId: project.id })
                }
                aria-current={project.id === openProjectId ? "page" : undefined}
                className={cn(
                  "srow hover:bg-foreground/5 w-full flex-none text-left",
                  project.id === openProjectId && "sel hover:bg-primary/20"
                )}
              >
                <Folder className="text-muted-foreground h-4 w-4 flex-none" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {live > 0 && (
                  <span className="text-muted-foreground text-[13px] tabular-nums">
                    {live}
                  </span>
                )}
              </button>
            ))}
            {more > 0 && (
              <button
                type="button"
                onClick={() => runNav("projects")}
                className="srow text-muted-foreground hover:bg-foreground/5 w-full flex-none text-left text-[13px]"
              >
                {more} more
              </button>
            )}
          </>
        )}
      </nav>

      {!newOpen && <UsageCard className="flex-none" />}
    </aside>
  );
}
