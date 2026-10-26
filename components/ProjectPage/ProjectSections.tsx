"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, FileText, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentRow, SectionHeader } from "@/components/rows/AgentRow";
import { SessionCard } from "@/components/SessionCard";
import { InboxItem } from "@/components/Inbox";
import { BackgroundAgentGroup } from "@/components/BackgroundAgents";
import { DevServerCard } from "@/components/DevServers/DevServerCard";
import { ServerLogsModal } from "@/components/DevServers";
import { Button } from "@/components/ui/button";
import { displayTitle } from "@/hooks/useSessionTitles";
import type { SessionStatus } from "@/components/views/types";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { DevServer, Session } from "@/lib/db";
import type { GitFile, GitStatus } from "@/lib/git-status";
import type { ProjectWithDevServers } from "@/lib/projects";

/** Transcript titles by session id (useListTitles) */
type Titles = Record<string, string>;

/**
 * One part of the project: a plain list under its heading, or a card once
 * the page is wide enough for two columns (@container/page in index.tsx)
 */
export function Section({
  title,
  count,
  action,
  className,
  children,
}: {
  title: ReactNode;
  count?: number;
  action?: { label: ReactNode; onClick: () => void };
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "@3xl/page:border-border min-w-0 @3xl/page:rounded-2xl @3xl/page:border @3xl/page:px-2 @3xl/page:pb-2",
        className
      )}
    >
      <SectionHeader count={count} action={action}>
        {title}
      </SectionHeader>
      {children}
    </section>
  );
}

/** Waiting sessions as answerable cards, then the agents that stopped to ask */
export function NeedsYouSection({
  waiting,
  blocked,
  titles,
  looseWaiting,
  onOpenSession,
}: {
  waiting: Session[];
  blocked: BackgroundAgent[];
  titles: Titles;
  looseWaiting?: number;
  onOpenSession: (session: Session) => void;
}) {
  if (!waiting.length && !blocked.length) return null;
  return (
    <Section title="Needs you" count={waiting.length + blocked.length}>
      <div className="space-y-2">
        {waiting.map((session) => (
          <InboxItem
            key={session.id}
            as="div"
            variant="card"
            session={session}
            title={displayTitle(session, titles).title}
            onOpen={() => onOpenSession(session)}
          />
        ))}
        {blocked.length > 0 && (
          <BackgroundAgentGroup
            agents={blocked}
            looseWaiting={looseWaiting}
            noId
            dense
          />
        )}
      </div>
    </Section>
  );
}

/** The project's sessions, without its name on every row */
export function SessionsSection({
  sessions,
  projects,
  statuses,
  titles,
  activeSessionId,
  summarizingSessionId,
  onOpenSession,
  onOpenInTab,
  actions,
}: {
  sessions: Session[];
  projects: ProjectWithDevServers[];
  statuses: Record<string, SessionStatus>;
  titles: Titles;
  activeSessionId?: string;
  summarizingSessionId?: string | null;
  onOpenSession: (session: Session) => void;
  onOpenInTab: (session: Session) => void;
  actions: {
    handleDeleteSession: (id: string) => void;
    handleRenameSession: (id: string, name: string) => Promise<void>;
    handleForkSession: (id: string) => Promise<void>;
    handleSummarize: (id: string) => Promise<void>;
    handleMoveSessionToProject: (id: string, projectId: string) => void;
    handleTogglePinSession: (id: string, pinned: boolean) => void;
  };
}) {
  if (!sessions.length) return null;
  return (
    <Section title="Sessions" count={sessions.length}>
      <div className="space-y-px">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            {...displayTitle(session, titles)}
            isActive={session.id === activeSessionId}
            isSummarizing={summarizingSessionId === session.id}
            tmuxStatus={statuses[session.id]?.status}
            projects={projects}
            onClick={() => onOpenSession(session)}
            onOpenInTab={() => onOpenInTab(session)}
            onTogglePin={() =>
              actions.handleTogglePinSession(
                session.id,
                session.pinned_order == null
              )
            }
            onMoveToProject={(projectId) =>
              actions.handleMoveSessionToProject(session.id, projectId)
            }
            onFork={() => actions.handleForkSession(session.id)}
            onSummarize={() => actions.handleSummarize(session.id)}
            onDelete={() => actions.handleDeleteSession(session.id)}
            onRename={(name) => actions.handleRenameSession(session.id, name)}
          />
        ))}
      </div>
    </Section>
  );
}

/** Background agents working or done; the waiting ones are in Needs you */
export function AgentsSection({ agents }: { agents: BackgroundAgent[] }) {
  if (!agents.length) return null;
  return (
    <Section title="Background agents" count={agents.length}>
      <BackgroundAgentGroup agents={agents} noId dense />
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

function LineCounts({ add, del }: { add: number; del: number }) {
  return (
    <span className="font-mono tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{add}</span>{" "}
      <span className="text-red-600 dark:text-red-400">−{del}</span>
    </span>
  );
}

/** Files shown on the wide card before "+N more" */
const FILES_SHOWN = 6;

/**
 * Uncommitted work in the project's folder. Narrow: one row into the
 * session's Changes. Wide: the files, with Review and Commit. Both open the
 * latest session's git view, so they need a session.
 */
export function ChangesSection({
  branch,
  files,
  onReview,
  className,
}: {
  branch?: string;
  files: GitFile[];
  /** Opens the latest session on its Changes; absent with no session */
  onReview?: () => void;
  className?: string;
}) {
  if (!files.length) return null;
  const add = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const del = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  const n = files.length;
  return (
    <Section
      title={branch ? `Changes · ${branch}` : "Changes"}
      className={className}
    >
      <AgentRow
        kind="changes"
        state="idle"
        as={onReview ? "button" : "div"}
        className="@3xl/page:hidden"
        dense
        title={`${n} changed file${n === 1 ? "" : "s"}${branch ? ` on ${branch}` : ""}`}
        subtitle={
          <>
            Uncommitted · <LineCounts add={add} del={del} />
          </>
        }
        trailing={
          onReview && (
            <ChevronRight
              aria-hidden="true"
              className="text-muted-foreground h-4 w-4"
            />
          )
        }
        onClick={onReview}
      />
      <div className="hidden @3xl/page:block">
        <ul className="space-y-1 px-2 py-1">
          {files.slice(0, FILES_SHOWN).map((file) => (
            <li
              key={file.path}
              className="flex min-w-0 items-center gap-2 text-xs"
            >
              <FileText className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono">
                {file.path}
              </span>
              {file.additions !== undefined && (
                <LineCounts add={file.additions} del={file.deletions ?? 0} />
              )}
            </li>
          ))}
          {n > FILES_SHOWN && (
            <li className="text-muted-foreground text-xs">
              +{n - FILES_SHOWN} more
            </li>
          )}
        </ul>
        {onReview && (
          <div className="flex gap-2 px-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onReview}
            >
              Review
            </Button>
            <Button size="sm" className="flex-1" onClick={onReview}>
              Commit
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

/**
 * The project's dev servers with their actions, or a Start row that opens
 * the start dialog (it detects what the folder can run)
 */
export function DevServerSection({
  project,
  servers,
  onSetUp,
  onRestart,
  onStop,
  onRemove,
  className,
}: {
  project: ProjectWithDevServers;
  servers: DevServer[];
  /** Opens StartServerDialog */
  onSetUp: () => void;
  onRestart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  className?: string;
}) {
  const [logsId, setLogsId] = useState<string | null>(null);
  const logsServer = servers.find((s) => s.id === logsId);
  const configured = project.devServers ?? [];

  const startRow = (key: string, title: string, detail: string) => (
    <AgentRow
      key={key}
      as="div"
      kind="dev"
      state="idle"
      dense
      title={title}
      detail={detail}
      trailing={
        <Button
          variant="secondary"
          size="sm"
          className="text-primary h-8"
          onClick={onSetUp}
        >
          <Play className="h-3.5 w-3.5" />
          Start
        </Button>
      }
    />
  );

  return (
    <Section title="Dev server" className={className}>
      <div className="space-y-px">
        {servers.length > 0
          ? servers.map((server) => (
              <DevServerCard
                key={server.id}
                server={server}
                onStart={onRestart}
                onStop={onStop}
                onRestart={onRestart}
                onRemove={onRemove}
                onViewLogs={setLogsId}
              />
            ))
          : configured.length > 0
            ? configured.map((config) =>
                startRow(config.id, config.name, `stopped · ${config.command}`)
              )
            : startRow("new", "Dev server", "not set up")}
      </div>
      {logsServer && (
        <ServerLogsModal
          serverId={logsServer.id}
          serverName={logsServer.name}
          onClose={() => setLogsId(null)}
        />
      )}
    </Section>
  );
}

/** The start of the project's instructions; Edit opens its settings */
export function InstructionsSection({
  text,
  onEdit,
  className,
}: {
  text: string;
  onEdit?: () => void;
  className?: string;
}) {
  return (
    <Section
      title="Instructions"
      action={onEdit && { label: "Edit", onClick: onEdit }}
      className={className}
    >
      <p className="text-muted-foreground line-clamp-4 px-2 pb-1 text-[13px] whitespace-pre-line">
        {text}
      </p>
    </Section>
  );
}
