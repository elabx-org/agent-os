"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import {
  Globe,
  MoreHorizontal,
  Play,
  RotateCw,
  ScrollText,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import { GroupCard, GroupRow } from "@/components/a/GroupCard";
import { SectionTitle } from "@/components/a/SectionTitle";
import { StateDot } from "@/components/a/StateDot";
import { openBackgroundAgent } from "@/components/BackgroundAgents";
import { ServerLogsModal } from "@/components/DevServers";
import { shortAge } from "@/components/MissionControl/now-summary";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { displayTitle } from "@/hooks/useSessionTitles";
import {
  STATE_WORD,
  fromBackgroundState,
  fromDevServerStatus,
  fromSessionStatus,
  type AgentState,
} from "@/lib/agent-state";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { DevServer, Session } from "@/lib/db";
import type { GitFile, GitStatus } from "@/lib/git-status";
import type { MergedPr } from "@/lib/merged-today";
import type { ProjectWithDevServers } from "@/lib/projects";
import type { SessionStatus } from "@/components/views/types";
import { cn } from "@/lib/utils";
import { SessionRowActions } from "./SessionRowActions";
import { HoldMenu } from "@/components/a/HoldMenu";

/** Transcript titles by session id (useListTitles) */
type Titles = Record<string, string>;

/** A section: its 15/600 title over a group card (Closed-Project) */
export function Section({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: { label: ReactNode; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <SectionTitle action={action}>{title}</SectionTitle>
      <GroupCard aria-label={typeof title === "string" ? title : undefined}>
        {children}
      </GroupCard>
    </section>
  );
}

/** Asking in amber, Working after a green dot, the rest quiet; then the age */
function StateLine({ state, age }: { state: AgentState; age?: string | null }) {
  const word = state === "needs" ? "Asking" : STATE_WORD[state];
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {(state === "needs" || state === "work") && (
        <StateDot state={state} size={6} />
      )}
      <span className="truncate">
        <span
          className={cn(state === "needs" && "dark:text-needs text-amber-600")}
        >
          {word}
        </span>
        {age && ` · ${age}`}
      </span>
    </span>
  );
}

/** Asking first, then working, then the rest */
const RANK: Partial<Record<AgentState, number>> = { needs: 0, work: 1 };
const rank = (state: AgentState) => RANK[state] ?? 2;

/** The project's sessions: agent tile, title, state and how long ago */
export function SessionsSection({
  sessions,
  statuses,
  titles,
  activeSessionId,
  projects,
  actions,
  onOpenSession,
}: {
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  titles: Titles;
  /** The session beside the page (open Duo, desktop) */
  activeSessionId?: string;
  /** Move to project's choices */
  projects: ProjectWithDevServers[];
  /** Rename, pin, fork, delete…: held or right-clicked */
  actions: ComponentProps<typeof SessionRowActions>["actions"];
  onOpenSession: (session: Session) => void;
}) {
  if (!sessions.length) return null;
  const stateOf = (s: Session) =>
    fromSessionStatus(statuses[s.id]?.status ?? "idle");
  // Pinned first within a state, as in the project list, then the latest
  const sorted = [...sessions].sort(
    (a, b) =>
      rank(stateOf(a)) - rank(stateOf(b)) ||
      (a.pinned_order ?? Number.MAX_SAFE_INTEGER) -
        (b.pinned_order ?? Number.MAX_SAFE_INTEGER) ||
      b.updated_at.localeCompare(a.updated_at)
  );
  return (
    <Section title="Sessions">
      {sorted.map((session) => {
        const { title } = displayTitle(session, titles);
        return (
          <SessionRowActions
            key={session.id}
            session={session}
            title={title}
            projects={projects}
            actions={actions}
          >
            <GroupRow
              leading={<Avatar {...agentAvatar(session.agent_type)} />}
              title={title}
              subtitle={
                <StateLine
                  state={stateOf(session)}
                  age={shortAge(session.updated_at)}
                />
              }
              chevron
              selected={session.id === activeSessionId}
              onClick={() => onOpenSession(session)}
            />
          </SessionRowActions>
        );
      })}
    </Section>
  );
}

/** Background agents started in the project; a tap opens one */
export function AgentsSection({ agents }: { agents: BackgroundAgent[] }) {
  if (!agents.length) return null;
  const sorted = [...agents].sort(
    (a, b) =>
      rank(fromBackgroundState(a.state)) - rank(fromBackgroundState(b.state)) ||
      b.startedAt - a.startedAt
  );
  return (
    <Section title="Background agents">
      {sorted.map((agent) => (
        <GroupRow
          key={agent.id}
          leading={<Avatar {...agentAvatar("claude")} />}
          title={agent.name}
          subtitle={
            <StateLine
              state={fromBackgroundState(agent.state)}
              age={agent.startedAt ? shortAge(agent.startedAt) : null}
            />
          }
          chevron
          onClick={() => openBackgroundAgent(agent)}
        />
      ))}
    </Section>
  );
}

/** Each file once, staged or not, with its line counts */
export function changedFiles(status: GitStatus | undefined): GitFile[] {
  if (!status) return [];
  const byPath = new Map<string, GitFile>();
  for (const file of [
    ...status.staged,
    ...status.unstaged,
    ...status.untracked,
  ]) {
    const seen = byPath.get(file.path);
    byPath.set(
      file.path,
      seen
        ? {
            ...seen,
            additions: (seen.additions ?? 0) + (file.additions ?? 0),
            deletions: (seen.deletions ?? 0) + (file.deletions ?? 0),
          }
        : file
    );
  }
  return [...byPath.values()];
}

function primaryPort(server: DevServer): number | undefined {
  try {
    return (JSON.parse(server.ports || "[]") as number[])[0];
  } catch {
    return undefined;
  }
}

/** ":3000 · up 2h", ":3000 · starting", "failed" */
function serverDetail(server: DevServer, port: number | undefined): string {
  const state =
    server.status === "running"
      ? // updated_at is when it last changed status, i.e. when it came up
        `up ${shortAge(server.updated_at)}`
      : server.status;
  return [port && `:${port}`, state].filter(Boolean).join(" · ");
}

/**
 * Dev servers that are up (or failed to come up): a green play tile, the
 * port and uptime, Open; its ⋯ has the rest (Restart, Stop, Logs, Remove).
 * Stopped ones start from the project's ⋯
 */
export function RunningSection({
  servers,
  onRestart,
  onStop,
  onRemove,
}: {
  servers: DevServer[];
  onRestart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  // Kept while the sheet closes: it runs the chosen action after its exit
  const [sheet, setSheet] = useState<{ id: string; open: boolean } | null>(
    null
  );
  const [logsId, setLogsId] = useState<string | null>(null);
  const shown = servers.filter((s) => s.status !== "stopped");
  const sheetServer = servers.find((s) => s.id === sheet?.id);
  const logsServer = servers.find((s) => s.id === logsId);
  if (!shown.length && !logsServer) return null;

  const actions = (server: DevServer): SheetAction[][] => {
    const port = primaryPort(server);
    return [
      [
        ...(port && server.status === "running"
          ? [
              {
                label: "Open",
                icon: Globe,
                onSelect: () =>
                  window.open(
                    `http://localhost:${port}`,
                    "_blank",
                    "noopener,noreferrer"
                  ),
              },
            ]
          : []),
        {
          label: "Restart",
          icon: RotateCw,
          onSelect: () => onRestart(server.id),
        },
        { label: "Stop", icon: Square, onSelect: () => onStop(server.id) },
        {
          label: "Logs",
          icon: ScrollText,
          onSelect: () => setLogsId(server.id),
        },
      ],
      [
        {
          label: "Remove",
          icon: Trash2,
          destructive: true,
          onSelect: () => onRemove(server.id),
        },
      ],
    ];
  };

  return (
    <>
      {shown.length > 0 && (
        <Section title="Running">
          {shown.map((server) => {
            const port = primaryPort(server);
            const state = fromDevServerStatus(server.status);
            const openable = !!port && server.status === "running";
            const openSheet = () => setSheet({ id: server.id, open: true });
            return (
              // Running, the row is Closed-Project's: Open alone, the rest
              // on a hold or right-click; else ⋯ shows what it can do
              <HoldMenu key={server.id} onOpen={openSheet}>
                <GroupRow
                  leading={
                    <span
                      className={cn(
                        "flex h-10 w-10 flex-none items-center justify-center rounded-xl text-white",
                        state === "error"
                          ? "bg-red-600 dark:bg-red-900"
                          : "bg-emerald-600 dark:bg-[#065F46]"
                      )}
                    >
                      <Play className="h-4 w-4" />
                    </span>
                  }
                  title={server.name}
                  subtitle={
                    <span className="font-mono text-[13px]">
                      {serverDetail(server, port)}
                    </span>
                  }
                  trailing={
                    <span className="flex items-center gap-1">
                      {openable && (
                        <a
                          href={`http://localhost:${port}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pill pill-secondary pill-sm text-foreground active:opacity-80"
                        >
                          Open
                        </a>
                      )}
                      {!openable && (
                        <button
                          type="button"
                          aria-label={`${server.name} actions`}
                          onClick={openSheet}
                          className="text-muted-foreground active:bg-accent relative grid h-9 w-9 place-items-center rounded-full after:absolute after:-inset-1 after:content-['']"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      )}
                    </span>
                  }
                />
              </HoldMenu>
            );
          })}
        </Section>
      )}
      {sheetServer && (
        <ActionSheet
          open={!!sheet?.open}
          onOpenChange={(o) => {
            if (!o) setSheet((s) => s && { ...s, open: false });
          }}
          title={sheetServer.name}
          description={serverDetail(sheetServer, primaryPort(sheetServer))}
          groups={actions(sheetServer)}
        />
      )}
      {logsServer && (
        <ServerLogsModal
          serverId={logsServer.id}
          serverName={logsServer.name}
          onClose={() => setLogsId(null)}
        />
      )}
    </>
  );
}

/** M3's project scripts, between Running and Merged today */
export { ProjectScripts } from "@/components/Projects/ProjectScripts";

/** Pull requests merged today: violet number and title, each to GitHub */
export function MergedTodaySection({ prs }: { prs: MergedPr[] }) {
  if (!prs.length) return null;
  return (
    <Section title="Merged today">
      {prs.map((pr) => (
        <a
          key={pr.number}
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="row active:bg-accent [@media(pointer:fine)]:hover:bg-accent/50 min-h-12"
        >
          <span className="flex-none font-mono text-[13px] text-violet-700 dark:text-violet-300">
            #{pr.number}
          </span>
          <span className="min-w-0 flex-1 truncate text-[16px]">
            {pr.title}
          </span>
        </a>
      ))}
    </Section>
  );
}

/** The start of the project's instructions, and any suggested ones */
export function InstructionsSection({
  text,
  suggestions,
  onEdit,
}: {
  text?: string;
  /** Instructions sessions suggested, waiting in the settings */
  suggestions: number;
  onEdit?: () => void;
}) {
  if (!text && !suggestions) return null;
  return (
    <Section
      title="Instructions"
      action={onEdit && { label: "Edit", onClick: onEdit }}
    >
      {text && (
        <p className="text-muted-foreground line-clamp-4 px-3.5 py-3 text-[14px] whitespace-pre-line">
          {text}
        </p>
      )}
      {suggestions > 0 && (
        <GroupRow
          leading={
            <span className="bg-primary/15 text-primary flex h-7 w-7 flex-none items-center justify-center rounded-[9px]">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
          }
          title={`${suggestions} suggested instruction${suggestions === 1 ? "" : "s"}`}
          chevron={!!onEdit}
          onClick={onEdit}
          className={cn(
            "min-h-12 py-2.5",
            text && "border-t border-[var(--hair)] dark:border-white/[.06]"
          )}
        />
      )}
    </Section>
  );
}
