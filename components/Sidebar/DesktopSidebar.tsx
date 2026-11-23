"use client";

import { MachineChip } from "@/components/Machines/MachineChip";
import { MachineTag } from "@/components/Machines/MachineTag";
import {
  openOnMachine,
  useOtherMachinesNow,
} from "@/components/Machines/useOtherMachinesNow";
import type { TaggedAgent, TaggedSession } from "@/lib/machine-now";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSnapshot } from "valtio";
import {
  Folder,
  GalleryVerticalEnd,
  Laptop,
  LayoutGrid,
  MonitorPlay,
  Plus,
  Search,
} from "lucide-react";
import { AppLogo } from "@/components/SessionList/SessionListHeader";
import type { Session } from "@/lib/db";
import type { SessionStatus, ViewProps } from "@/components/views/types";
import { StateDot } from "@/components/a/StateDot";
import { useNeedsYou } from "@/hooks/useNeedsYou";
import { isLimitShown } from "@/lib/limits/types";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { isMacLike } from "@/hooks/useViewShortcuts";
import { runNav } from "@/lib/nav-actions";
import { withoutPaused } from "@/lib/paused";
import { openPage, workspacePageStore } from "@/stores/workspacePage";
import { newSurfaceStore } from "@/stores/newSurface";
import { mobileNavStore } from "@/stores/mobileNav";
import { runningStore } from "@/stores/running";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_LOOSE,
  SIDEBAR_PROJECTS,
  looseSessions,
  shortAge,
  sidebarProjects,
} from "./model";
import { UsageCard } from "./UsageCard";
import { NeedsYouCard } from "@/components/Chat/NeedsYouCard";
import { useMacApp } from "@/hooks/useMacHost";

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
  idle: "idle",
} as const;

function SessionRows({
  sessions,
  state,
  statuses,
  selectedId,
  onOpenSession,
  detail,
}: {
  sessions: Session[];
  state: "needs" | "limited" | "work" | "idle";
  statuses: Record<string, SessionStatus>;
  selectedId?: string;
  onOpenSession: (session: Session) => void;
  /** A second line with what the session is doing */
  detail?: boolean;
}) {
  const titles = useListTitles(sessions);
  return sessions.map((s) => {
    const { title } = displayTitle(s, titles);
    // What it is doing, under its name (the Mac window's sidebar)
    const line =
      detail && (state === "work" || state === "needs")
        ? statuses[s.id]?.lastLine?.trim()
        : undefined;
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
          line && "h-12",
          s.id === selectedId && "sel hover:bg-primary/20"
        )}
      >
        <StateDot state={state} />
        {line ? (
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate">{title}</span>
            <span className="text-muted-foreground truncate text-[12px]">
              {line}
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{title}</span>
        )}
        <span className="text-muted-foreground text-[13px] tabular-nums">
          {shortAge(s.updated_at)}
        </span>
      </button>
    );
  });
}

/**
 * The Mac window's sidebar pins what waits on you, with its answer in
 * place: the first waiting session's question or permission request
 */
function PinnedNeedsYou({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: () => void;
}) {
  const { title } = displayTitle(session, useListTitles([session]));
  return (
    <section
      aria-label={`${title} needs you`}
      className="flex flex-none flex-col gap-1.5"
    >
      <button
        type="button"
        onClick={onOpen}
        className="truncate px-2.5 text-left text-[13px] font-semibold hover:underline"
      >
        {title} needs you
      </button>
      <NeedsYouCard
        session={session}
        variant="sheet"
        noHead
        onOpenTerminal={onOpen}
      />
    </section>
  );
}

/** Rows from the other linked machines: tagged, a click moves the tab there */
function OtherRows({
  sessions,
  agents,
  state,
}: {
  sessions: TaggedSession[];
  agents: TaggedAgent[];
  state: "needs" | "work";
}) {
  const row = (
    key: string,
    title: string,
    tag: TaggedSession["tag"],
    hint: string | undefined,
    onClick: () => void
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-label={`${title}, ${STATE_LABEL[state]}, on ${tag.name}`}
      title={hint}
      className="srow hover:bg-foreground/5 w-full flex-none text-left"
    >
      <StateDot state={state} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <MachineTag tag={tag} className="h-5 max-w-[6.5rem] px-1.5 text-[11px]" />
    </button>
  );
  return (
    <>
      {sessions.map((item) =>
        row(
          `${item.tag.target}:${item.session.id}`,
          displayTitle(item.session, {}).title,
          item.tag,
          item.line,
          () => openOnMachine(item.tag, { session: item.session.id })
        )
      )}
      {agents.map((item) =>
        row(
          `${item.tag.target}:${item.agent.id}`,
          item.agent.name,
          item.tag,
          "Background agent",
          () => openOnMachine(item.tag, {})
        )
      )}
    </>
  );
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
  const { enabled: running, runners } = useSnapshot(runningStore);
  const mac = useMacApp();
  // The server renders the Mac's; others see their own once mounted
  const [findKey, setFindKey] = useState("⌘K");
  useEffect(() => {
    if (!isMacLike()) setFindKey("Ctrl K");
  }, []);

  // A paused (handed-off) or settled session neither needs you nor works
  const active = useMemo(() => withoutPaused(sessions), [sessions]);
  const { waiting } = useNeedsYou(active, sessionStatuses);
  // The other linked machines' sessions and agents, tagged
  const others = useOtherMachinesNow();
  const otherNeeds = others.needs.length + others.blocked.length;
  const otherWorking = others.working.length + others.agents.length;
  const needsCount = waiting.length + otherNeeds;
  // At a usage limit (M6): their own section, oldest limit first
  const limited = useMemo(
    () =>
      active
        .filter((s) => !s.conductor_session_id && isLimitShown(s))
        .sort((a, b) => (a.limited_at ?? 0) - (b.limited_at ?? 0)),
    [active]
  );
  // Workers show inside their conductor's session, as on Now
  const working = useMemo(
    () =>
      active
        .filter(
          (s) =>
            !s.conductor_session_id &&
            sessionStatuses[s.id]?.status === "running" &&
            !isLimitShown(s)
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [active, sessionStatuses]
  );
  const listed = useMemo(
    () => sidebarProjects(projects, active, sessionStatuses),
    [projects, active, sessionStatuses]
  );
  const shown = listed.slice(0, SIDEBAR_PROJECTS);
  const more = listed.length - shown.length;
  // Quiet sessions outside any project: otherwise nothing here shows them
  const loose = useMemo(
    () =>
      looseSessions(
        active,
        projects,
        sessionStatuses,
        new Set([...waiting, ...limited, ...working].map((s) => s.id))
      ),
    [active, projects, sessionStatuses, waiting, limited, working]
  );
  const looseShown = loose.slice(0, SIDEBAR_LOOSE);
  const noProjectId = projects.find((p) => p.is_uncategorized)?.id;

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
        {/* The list brings its own row: Back, title, sort and + */}
        <div className="min-h-0 flex-1">{projectsView}</div>
      </aside>
    );

  return (
    <aside
      aria-label="Sessions and projects"
      className="bg-page flex h-full flex-col gap-3.5 border-r border-[var(--hair)] px-3 py-[18px]"
    >
      {/* Inside the Mac app the window names the app and has New */}
      <div className="mac-hide flex items-center gap-2.5 px-1.5">
        <span className="bg-primary flex h-7 w-7 flex-none items-center justify-center rounded-lg text-white">
          <AppLogo className="h-4 w-4" />
        </span>
        <span className="t-head min-w-0 flex-1 truncate">AgentOS</span>
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
      {/* On a linked machine: which, and the way back */}
      <MachineChip className="mx-1.5 self-start" home />

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
          <span
            className="font-mono text-[11px]"
            title={
              findKey === "Ctrl K"
                ? "Ctrl K finds, except in the terminal: there it's the shell's"
                : undefined
            }
          >
            {findKey}
          </span>
        </button>
      )}

      {mac && !newOpen && waiting[0] && (
        <PinnedNeedsYou
          session={waiting[0]}
          onOpen={() => onOpenSession(waiting[0])}
        />
      )}

      <nav
        aria-label="Sessions"
        className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1"
      >
        {needsCount > 0 && (
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
              detail={mac}
            />
            <OtherRows
              sessions={others.needs}
              agents={others.blocked}
              state="needs"
            />
          </>
        )}
        {limited.length > 0 && (
          <>
            <SectionLabel first={needsCount === 0}>Limited</SectionLabel>
            <SessionRows
              sessions={limited}
              state="limited"
              statuses={sessionStatuses}
              selectedId={selectedId}
              onOpenSession={onOpenSession}
              detail={mac}
            />
          </>
        )}
        {working.length + otherWorking > 0 && (
          <>
            <SectionLabel first={needsCount + limited.length === 0}>
              Working
            </SectionLabel>
            <SessionRows
              sessions={working}
              state="work"
              statuses={sessionStatuses}
              selectedId={selectedId}
              onOpenSession={onOpenSession}
              detail={mac}
            />
            <OtherRows
              sessions={others.working}
              agents={others.agents}
              state="work"
            />
          </>
        )}
        {!newOpen && shown.length > 0 && (
          <>
            <SectionLabel
              first={
                needsCount + limited.length + working.length + otherWorking ===
                0
              }
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
        {!newOpen && looseShown.length > 0 && (
          <>
            <SectionLabel
              first={
                needsCount +
                  limited.length +
                  working.length +
                  otherWorking +
                  shown.length ===
                0
              }
            >
              No project
            </SectionLabel>
            <SessionRows
              sessions={looseShown}
              state="idle"
              statuses={sessionStatuses}
              selectedId={selectedId}
              onOpenSession={onOpenSession}
              detail={mac}
            />
            {loose.length > looseShown.length && noProjectId && (
              <button
                type="button"
                onClick={() =>
                  openPage({ kind: "project", projectId: noProjectId })
                }
                className="srow text-muted-foreground hover:bg-foreground/5 w-full flex-none text-left text-[13px]"
              >
                {loose.length - looseShown.length} more
              </button>
            )}
          </>
        )}
        {/* Every session on every machine as tiles (the Mac window) */}
        {!newOpen && mac && (
          <button
            type="button"
            onClick={() => openPage({ kind: "all" })}
            aria-current={page?.kind === "all" ? "page" : undefined}
            className={cn(
              "srow hover:bg-foreground/5 mt-2.5 w-full flex-none text-left",
              page?.kind === "all" && "sel hover:bg-primary/20"
            )}
          >
            <LayoutGrid className="text-muted-foreground h-4 w-4 flex-none" />
            <span className="min-w-0 flex-1 truncate">All sessions</span>
          </button>
        )}
        {/* Labs' Running: the Duo's More has it; here, every session's */}
        {!newOpen && running && (
          <button
            type="button"
            onClick={() => openPage({ kind: "running" })}
            aria-current={page?.kind === "running" ? "page" : undefined}
            className={cn(
              "srow hover:bg-foreground/5 w-full flex-none text-left",
              !mac && "mt-2.5",
              page?.kind === "running" && "sel hover:bg-primary/20"
            )}
          >
            <MonitorPlay className="text-muted-foreground h-4 w-4 flex-none" />
            <span className="min-w-0 flex-1 truncate">Running</span>
          </button>
        )}
        {!newOpen && (
          <button
            type="button"
            onClick={() => openPage({ kind: "mocks" })}
            aria-current={page?.kind === "mocks" ? "page" : undefined}
            className={cn(
              "srow hover:bg-foreground/5 w-full flex-none text-left",
              !running && !mac && "mt-2.5",
              page?.kind === "mocks" && "sel hover:bg-primary/20"
            )}
          >
            <GalleryVerticalEnd className="text-muted-foreground h-4 w-4 flex-none" />
            <span className="min-w-0 flex-1 truncate">Mocks</span>
          </button>
        )}
        {/* The linked machines and the jobs chats hand them */}
        {!newOpen && runners && (
          <button
            type="button"
            onClick={() => openPage({ kind: "runners" })}
            aria-current={page?.kind === "runners" ? "page" : undefined}
            className={cn(
              "srow hover:bg-foreground/5 w-full flex-none text-left",
              page?.kind === "runners" && "sel hover:bg-primary/20"
            )}
          >
            <Laptop className="text-muted-foreground h-4 w-4 flex-none" />
            <span className="min-w-0 flex-1 truncate">Runners</span>
          </button>
        )}
      </nav>

      {!newOpen && <UsageCard className="flex-none" />}
    </aside>
  );
}
