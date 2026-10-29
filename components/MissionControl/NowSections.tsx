"use client";

import { Check } from "lucide-react";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import { GroupCard, GroupRow } from "@/components/a/GroupCard";
import { SectionTitle } from "@/components/a/SectionTitle";
import { StateDot } from "@/components/a/StateDot";
import { openBackgroundAgent } from "@/components/BackgroundAgents";
import { DevServerRow } from "@/components/DevServers/DevServerCard";
import { askLabel, InboxItem } from "@/components/Inbox";
import { useSessionPrompt } from "@/data/prompts/queries";
import { displayTitle } from "@/hooks/useSessionTitles";
import { STATE_TEXT_CLASS } from "@/lib/agent-state";
import { runNav } from "@/lib/nav-actions";
import { openSubagent } from "@/stores/agentOpen";
import { mobileNavActions } from "@/stores/mobileNav";
import { openPage } from "@/stores/workspacePage";
import type { SessionStatus } from "@/components/views/types";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { shortAge } from "./now-summary";
import type { NowItems } from "./useNowItems";

/** Quiet projects listed on Now; the rest are under Projects */
const QUIET_SHOWN = 3;
/** Done today rows on the wide page; the rest are a tap away (M8) */
const DONE_SHOWN = 3;

export interface SectionProps {
  now: NowItems;
  /** Open Duo and desktop: rows with the time on the right (Open-Now) */
  wide: boolean;
  projectNames: Record<string, string>;
  sessionStatuses: Record<string, SessionStatus>;
  selectedId?: string;
  onOpenSession: (session: Session) => void;
}

const projectOf = (
  projectNames: Record<string, string>,
  session: Pick<Session, "project_id">
) => (session.project_id ? projectNames[session.project_id] : undefined);

/** "project · what it's doing", leaving out what's missing */
const joined = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" · ");

/** The narrow layout's working subtitle: a green dot before it */
function Live({ children }: { children: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <StateDot state="work" size={6} />
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * Everything that needs you: on the closed Duo and phones a card per item,
 * answerable in place; on the wide page rows, the open one selected, since
 * the session beside it answers
 */
export function NeedsSection({
  now,
  wide,
  projectNames,
  selectedId,
  onOpenSession,
  /** On a table the first card is on the base instead */
  skipFirst,
}: SectionProps & { skipFirst?: boolean }) {
  const agents = now.blocked.flatMap((group) =>
    group.agents.map((agent) => ({ agent, projectName: group.projectName }))
  );
  if (now.waiting.length + agents.length === 0) return null;

  if (wide)
    return (
      <>
        <SectionTitle state="needs">Needs you</SectionTitle>
        <GroupCard aria-label="Needs you">
          {now.waiting.map((session) => (
            <NeedsRow
              key={session.id}
              session={session}
              title={displayTitle(session, now.titles).title}
              selected={session.id === selectedId}
              onOpen={() => onOpenSession(session)}
            />
          ))}
          {agents.map(({ agent, projectName }) => (
            <GroupRow
              key={agent.id}
              leading={<Avatar {...agentAvatar("claude")} />}
              title={agent.name}
              subtitle={joined(projectName, "Background agent waiting")}
              trailing={agent.startedAt ? shortAge(agent.startedAt) : null}
              onClick={() => openBackgroundAgent(agent)}
            />
          ))}
        </GroupCard>
      </>
    );

  return (
    <>
      {now.waiting.slice(skipFirst ? 1 : 0).map((session) => (
        <InboxItem
          key={session.id}
          as="div"
          variant="card"
          session={session}
          projectName={projectOf(projectNames, session)}
          title={displayTitle(session, now.titles).title}
          onOpen={() => onOpenSession(session)}
        />
      ))}
      {agents.map(({ agent, projectName }) => (
        <BlockedCard key={agent.id} agent={agent} projectName={projectName} />
      ))}
    </>
  );
}

/** A waiting session on the wide page: what it's asking, under its title */
function NeedsRow({
  session,
  title,
  selected,
  onOpen,
}: {
  session: Session;
  title: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const { data: prompt } = useSessionPrompt(session.id);
  const ask = !prompt ? (
    "Your turn"
  ) : prompt.question ? (
    prompt.question
  ) : prompt.detail ? (
    <>
      Allow{" "}
      <span className="font-mono text-xs">{prompt.detail.split("\n")[0]}</span>?
    </>
  ) : (
    askLabel(prompt.title)
  );
  return (
    <GroupRow
      leading={<Avatar {...agentAvatar(session.agent_type)} />}
      title={title}
      subtitle={ask}
      trailing={shortAge(session.updated_at)}
      selected={selected}
      onClick={onOpen}
    />
  );
}

/** A background agent stopped to ask: it answers on its own page */
function BlockedCard({
  agent,
  projectName,
}: {
  agent: BackgroundAgent;
  projectName?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openBackgroundAgent(agent)}
      className="bg-card border-needs/40 flex flex-col gap-1.5 rounded-[22px] border p-3.5 text-left active:opacity-80"
    >
      <span className="text-muted-foreground flex w-full min-w-0 items-center gap-2 text-[13px]">
        <StateDot state="needs" />
        <span className={cn("font-semibold", STATE_TEXT_CLASS.needs)}>
          Waiting
        </span>
        <span className="min-w-0 flex-1 truncate">
          · {joined(projectName, "Background agent")}
        </span>
        {agent.startedAt > 0 && (
          <span className="shrink-0">{shortAge(agent.startedAt)}</span>
        )}
      </span>
      <span className="t-head w-full truncate">{agent.name}</span>
      <span className="text-foreground/75">Open it to answer.</span>
    </button>
  );
}

/** What's working, one grouped card: sessions, subagents, agents, servers */
export function WorkingSection({
  now,
  wide,
  projectNames,
  sessionStatuses,
  selectedId,
  onOpenSession,
}: SectionProps) {
  const { working } = now;
  if (now.workingCount === 0) return null;

  // Narrow: "Editing X · 6m" after a green dot; wide: "project · Editing X"
  // with the time on the right
  const row = (
    project: string | undefined,
    activity: string,
    age: string | null
  ) =>
    wide
      ? { subtitle: joined(project, activity), trailing: age }
      : {
          subtitle: <Live>{joined(activity, age)}</Live>,
          chevron: true,
        };

  return (
    <section className={cn("flex flex-col", wide ? "gap-3.5" : "gap-2")}>
      <SectionTitle state={wide ? "work" : undefined}>Working</SectionTitle>
      <GroupCard aria-label="Working">
        {working.sessions.map((session) => (
          <GroupRow
            key={session.id}
            leading={<Avatar {...agentAvatar(session.agent_type)} />}
            title={displayTitle(session, now.titles).title}
            {...row(
              projectOf(projectNames, session),
              sessionStatuses[session.id]?.lastLine?.trim() || "Working",
              shortAge(session.updated_at)
            )}
            selected={session.id === selectedId}
            onClick={() => onOpenSession(session)}
          />
        ))}
        {working.subagents.map((agent) => (
          <GroupRow
            key={`${agent.sessionId}:${agent.agentId}`}
            leading={<Avatar {...agentAvatar(agent.parent.agent_type)} />}
            title={agent.description || agent.agentType}
            {...row(
              projectOf(projectNames, agent.parent),
              agent.steps != null
                ? `Subagent · ${agent.steps} steps`
                : "Subagent",
              null
            )}
            onClick={() => {
              // The parent's chat opens the subagent's panel
              onOpenSession(agent.parent);
              mobileNavActions.requestViewMode("chat", agent.sessionId);
              openSubagent(agent.sessionId, agent.agentId);
            }}
          />
        ))}
        {working.agents.map(({ agent, projectName }) => (
          <GroupRow
            key={agent.id}
            leading={<Avatar {...agentAvatar("claude")} />}
            title={agent.name}
            {...row(
              projectName,
              "Background agent",
              agent.startedAt ? shortAge(agent.startedAt) : null
            )}
            onClick={() => openBackgroundAgent(agent)}
          />
        ))}
        {/* Servers keep their own row: it holds the open/start button */}
        {working.devServers.map((server) => (
          <DevServerRow
            key={server.id}
            server={server}
            projectName={projectNames[server.project_id]}
            className="row min-h-14 gap-3 rounded-none px-3.5 py-3"
          />
        ))}
      </GroupCard>
    </section>
  );
}

/** "Done today": one row to the list when narrow, the latest when wide */
export function DoneTodaySection({
  now,
  wide,
  sessions,
  onOpenSession,
}: Pick<SectionProps, "now" | "wide" | "onOpenSession"> & {
  sessions: Session[];
}) {
  const done = now.doneToday;
  if (!done.length) return null;
  const prs = done.filter((item) => item.prNumber != null).length;

  if (!wide)
    return (
      <GroupCard>
        <GroupRow
          leading={
            <span className="bg-work/15 text-work flex h-7 w-7 flex-none items-center justify-center rounded-full">
              <Check className="h-4 w-4" strokeWidth={2.6} />
            </span>
          }
          title={<span className="font-normal">Done today</span>}
          trailing={joined(`${done.length}`, prs ? `${prs} PRs` : null)}
          chevron
          // M8 gives Done today a list of its own
          onClick={() => runNav("projects")}
        />
      </GroupCard>
    );

  const byId = new Map(sessions.map((s) => [s.id, s]));
  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Done today · {done.length}</SectionTitle>
      <GroupCard aria-label="Done today">
        {done.slice(0, DONE_SHOWN).map((item) => {
          const session = byId.get(item.sessionId);
          return (
            <GroupRow
              key={item.sessionId}
              leading={<Avatar {...agentAvatar(session?.agent_type)} />}
              title={item.title}
              subtitle={item.prNumber ? `PR #${item.prNumber} merged` : "Done"}
              trailing={shortAge(item.at)}
              onClick={session ? () => onOpenSession(session) : undefined}
            />
          );
        })}
      </GroupCard>
    </section>
  );
}

/** Projects with nothing going on: quiet grey rows, Projects one tap away */
export function QuietSection({
  now,
  wide,
}: Pick<SectionProps, "now" | "wide">) {
  if (!now.quiet.length) return null;
  return (
    <section className={cn("flex flex-col", wide ? "gap-3.5" : "gap-2")}>
      <SectionTitle
        action={{ label: "All projects", onClick: () => runNav("projects") }}
      >
        Quiet · {now.quiet.length}
      </SectionTitle>
      <GroupCard aria-label="Quiet projects">
        {now.quiet.slice(0, QUIET_SHOWN).map((project) => (
          <GroupRow
            key={project.id}
            leading={<Avatar label={project.name} size="sm" />}
            title={
              <span className="text-muted-foreground font-normal">
                {project.name}
              </span>
            }
            chevron
            onClick={() => openPage({ kind: "project", projectId: project.id })}
            className="min-h-12 py-2.5"
          />
        ))}
      </GroupCard>
    </section>
  );
}
