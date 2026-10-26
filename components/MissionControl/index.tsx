"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Plus, Settings } from "lucide-react";
import { FoldSplit } from "@/components/FoldSplit";
import { AppLogo } from "@/components/SessionList/SessionListHeader";
import { InboxItem } from "@/components/Inbox";
import { UsagePill } from "@/components/UsagePill";
import {
  BackgroundAgentGroup,
  BackgroundAgentRow,
  BackgroundAgents,
} from "@/components/BackgroundAgents";
import { DevServerRow } from "@/components/DevServers/DevServerCard";
import {
  AgentRow,
  ProjectRow,
  SectionHeader,
} from "@/components/rows/AgentRow";
import { useIsNative } from "@/hooks/useIsNative";
import { displayTitle } from "@/hooks/useSessionTitles";
import { timeAgo } from "@/lib/agent-state";
import { openSettings } from "@/stores/settingsPage";
import { openNew } from "@/stores/newSurface";
import { openSubagent } from "@/stores/agentOpen";
import { mobileNavActions } from "@/stores/mobileNav";
import type { SessionStatus } from "@/components/views/types";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useNowItems } from "./useNowItems";

type Tab = "now" | "projects";

const TAB_KEY = "agentos:mission-tab";
/** Drawn at 36px; the hit area reaches 44 */
const iconButton =
  "text-muted-foreground active:bg-accent hover:bg-accent relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg after:absolute after:-inset-1 after:content-['']";
/** Quiet projects listed on Now; the rest are under All projects */
const QUIET_SHOWN = 3;

interface MissionControlProps {
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  projectNames: Record<string, string>;
  activeSessionId?: string;
  /** The open session, highlighted where it's listed */
  selectedId?: string;
  onOpenSession: (session: Session) => void;
  /** Left out where the screen has its own New (the desktop header) */
  onNewSession?: () => void;
  /** Back to the session underneath, where nothing else leads there */
  onClose?: () => void;
  /** The full session list, for managing projects and sessions */
  projectsView: React.ReactNode;
}

/**
 * The app's home: how many things need you, the first one answerable in
 * place, what's working, then the quiet projects. Projects is one tab away.
 */
export function MissionControl({
  sessions,
  sessionStatuses,
  projectNames,
  activeSessionId,
  selectedId = activeSessionId,
  onOpenSession,
  onNewSession,
  onClose,
  projectsView,
}: MissionControlProps) {
  const native = useIsNative();
  const [tab, setTab] = useState<Tab>("now");

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

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="@container/top flex items-center gap-2 px-4 pt-3 pb-1">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to the session"
            className={cn(iconButton, "-ml-2")}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <AppLogo className="h-5 w-5 shrink-0" />
        <h1 className="min-w-0 flex-1 truncate font-semibold">AgentOS</h1>
        <UsagePill />
        {onNewSession && !native && (
          <button
            type="button"
            onClick={onNewSession}
            aria-label="New session"
            className={iconButton}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => openSettings()}
          aria-label="Settings"
          className={cn(iconButton, "-mr-2")}
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 pt-1 pb-2">
        <div
          role="tablist"
          className="bg-secondary flex rounded-lg p-0.5 text-sm font-medium"
        >
          {(["now", "projects"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => chooseTab(id)}
              className={cn(
                "relative h-8 flex-1 rounded-md transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
                tab === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {id === "now" ? "Now" : "Projects"}
            </button>
          ))}
        </div>
      </div>

      {tab === "projects" ? (
        <div className="min-h-0 flex-1 overflow-hidden">{projectsView}</div>
      ) : (
        <Now
          sessions={sessions}
          sessionStatuses={sessionStatuses}
          projectNames={projectNames}
          selectedId={selectedId}
          onOpenSession={onOpenSession}
          onShowProjects={() => chooseTab("projects")}
        />
      )}
    </div>
  );
}

function Now({
  sessions,
  sessionStatuses,
  projectNames,
  selectedId,
  onOpenSession,
  onShowProjects,
}: {
  sessions: Session[];
  sessionStatuses: Record<string, SessionStatus>;
  projectNames: Record<string, string>;
  selectedId?: string;
  onOpenSession: (session: Session) => void;
  onShowProjects: () => void;
}) {
  const now = useNowItems(sessions, sessionStatuses);
  const { working } = now;
  const [first, ...moreWaiting] = now.waiting;
  const project = (session: Session) =>
    session.project_id ? projectNames[session.project_id] : undefined;

  // On a table the list stays above the fold and the base answers the
  // first prompt, or starts something when nothing waits
  const ref = useRef<HTMLDivElement>(null);
  const firstCard = first && (
    <InboxItem
      as="div"
      variant="card"
      session={first}
      projectName={project(first)}
      title={displayTitle(first, now.titles).title}
      onOpen={() => onOpenSession(first)}
    />
  );
  const list = (cardOnBase: boolean) => (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
      {/* The hero: what the home is for */}
      <p className="flex items-baseline gap-2.5 px-2 pt-2 pb-4">
        {now.needsCount > 0 ? (
          <>
            <span className="text-[56px] leading-none font-bold text-amber-600 tabular-nums dark:text-amber-400">
              {now.needsCount}
            </span>
            <span className="text-[22px] font-semibold">
              {now.needsCount === 1 ? "needs you" : "need you"}
            </span>
          </>
        ) : (
          <span className="text-[22px] font-semibold">Nothing needs you</span>
        )}
      </p>

      <div className="space-y-px">
        {firstCard && !cardOnBase && (
          <>
            {firstCard}
            <div className="h-2" />
          </>
        )}
        {moreWaiting.map((session) => {
          const { title, idLabel } = displayTitle(session, now.titles);
          return (
            <AgentRow
              key={session.id}
              kind="session"
              state="needs"
              title={title}
              idLabel={idLabel}
              project={project(session)}
              detail={timeAgo(session.updated_at)}
              selected={session.id === selectedId}
              dense
              onClick={() => onOpenSession(session)}
            />
          );
        })}
        {/* One blocked agent is a row, two or more fold */}
        {now.blocked.map((group) => (
          <BackgroundAgentGroup
            key={group.key}
            agents={group.agents}
            projectName={group.projectName}
            looseWaiting={0}
            dense
          />
        ))}
      </div>

      {now.workingCount > 0 ? (
        <section>
          <SectionHeader count={now.workingCount}>Working</SectionHeader>
          <div className="space-y-px">
            {working.subagents.map((agent) => (
              <AgentRow
                key={`${agent.sessionId}:${agent.agentId}`}
                kind="subagent"
                state="work"
                title={agent.description || agent.agentType}
                project={project(agent.parent)}
                detail={agent.steps != null ? `${agent.steps} steps` : null}
                dense
                onClick={() => {
                  // The parent's chat opens the subagent's panel
                  onOpenSession(agent.parent);
                  mobileNavActions.requestViewMode("chat", agent.sessionId);
                  openSubagent(agent.sessionId, agent.agentId);
                }}
              />
            ))}
            {working.sessions.map((session) => {
              const { title, idLabel } = displayTitle(session, now.titles);
              return (
                <AgentRow
                  key={session.id}
                  kind="session"
                  state="work"
                  title={title}
                  idLabel={idLabel}
                  project={project(session)}
                  detail={
                    sessionStatuses[session.id]?.lastLine?.trim() ||
                    timeAgo(session.updated_at)
                  }
                  selected={session.id === selectedId}
                  dense
                  onClick={() => onOpenSession(session)}
                />
              );
            })}
            {working.agents.map(({ agent, projectName }) => (
              <BackgroundAgentRow
                key={agent.id}
                agent={agent}
                projectName={projectName}
                dense
              />
            ))}
            {working.devServers.map((server) => (
              <DevServerRow
                key={server.id}
                server={server}
                projectName={projectNames[server.project_id]}
                dense
              />
            ))}
          </div>
        </section>
      ) : (
        now.needsCount === 0 && (
          <div className="px-2 py-4">
            <p className="font-medium">Nothing running</p>
            <p className="text-muted-foreground text-sm">
              Start a session, or pick up a project below.
            </p>
          </div>
        )
      )}

      {now.quiet.length > 0 && (
        <section>
          <SectionHeader
            action={{ label: "All projects", onClick: onShowProjects }}
          >
            Quiet · {now.quiet.length}{" "}
            {now.quiet.length === 1 ? "project" : "projects"}
          </SectionHeader>
          <div className="space-y-px">
            {now.quiet.slice(0, QUIET_SHOWN).map((p) => (
              <ProjectRow
                key={p.id}
                name={p.name}
                nosub
                onClick={onShowProjects}
              />
            ))}
          </div>
        </section>
      )}

      {/* Agents outside every project, once they've stopped working: listed
          nowhere else, so open and remove them from here */}
      {now.elsewhere.length > 0 && (
        <div className="px-2 pt-3">
          <BackgroundAgents agents={now.elsewhere} title="Other agents" />
        </div>
      )}
    </div>
  );

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <FoldSplit
        el={ref}
        className="flex-1"
        top={list(true)}
        base={
          // Pushed down to the thumbs, but scrolls from its top if it's taller
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="mt-auto flex flex-col gap-3">
              {firstCard || (
                <>
                  <div className="@container/top flex justify-center">
                    <UsagePill />
                  </div>
                  <button
                    type="button"
                    onClick={() => openNew()}
                    className="bg-primary text-primary-foreground flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-semibold active:opacity-80"
                  >
                    <Plus className="h-4 w-4" />
                    New session
                  </button>
                </>
              )}
            </div>
          </div>
        }
      >
        {list(false)}
      </FoldSplit>
    </div>
  );
}
