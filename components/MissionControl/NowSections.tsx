"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import { GroupCard, GroupRow } from "@/components/a/GroupCard";
import { PrChip } from "@/components/a/PrChip";
import { SectionTitle } from "@/components/a/SectionTitle";
import { StateDot } from "@/components/a/StateDot";
import { openBackgroundAgent } from "@/components/BackgroundAgents";
import { DevServerRow } from "@/components/DevServers/DevServerCard";
import { SwipeRow } from "@/components/ui/swipe-row";
import { LimitedCard, LimitedRow } from "@/components/Chat/LimitedCard";
import { limitView } from "@/components/Chat/limited-model";
import { askLabel, InboxItem } from "@/components/Inbox";
import { PROMPT_POLL_SLOW_MS, useSessionPrompt } from "@/data/prompts/queries";
import { displayTitle } from "@/hooks/useSessionTitles";
import { confirmSettleBusy, useSettle } from "@/hooks/useSettle";
import { STATE_TEXT_CLASS, STATE_WORD } from "@/lib/agent-state";
import { runNav } from "@/lib/nav-actions";
import { sessionPr, wantsSettleChip } from "@/lib/settle-types";
import { settleWithUndo } from "@/lib/undo";
import { openSubagent } from "@/stores/agentOpen";
import { mobileNavActions } from "@/stores/mobileNav";
import { openPage } from "@/stores/workspacePage";
import type { SessionStatus } from "@/components/views/types";
import type { BackgroundAgent } from "@/lib/claude-background";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { shortAge } from "./now-summary";
import { settleCaption } from "./settle-model";
import type { NowItems } from "./useNowItems";

/** Quiet projects listed on Now; the rest are under Projects */
const QUIET_SHOWN = 3;
/** Done today rows on the wide page; the rest are a tap away */
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
          {now.waiting.map((session, i) => (
            <NeedsRow
              key={session.id}
              session={session}
              pollMs={pollFor(i)}
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
      {now.waiting.slice(skipFirst ? 1 : 0).map((session, i) => (
        <InboxItem
          key={session.id}
          as="div"
          variant="card"
          pollMs={pollFor(skipFirst ? i + 1 : i)}
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

/** The first waiting session's prompt is reread every 2s, the rest less
    often: each read is a tmux capture on the server */
const pollFor = (index: number) =>
  index === 0 ? undefined : PROMPT_POLL_SLOW_MS;

/** A waiting session on the wide page: what it's asking, under its title */
function NeedsRow({
  session,
  title,
  selected,
  pollMs,
  onOpen,
}: {
  session: Session;
  title: string;
  selected: boolean;
  pollMs?: number;
  onOpen: () => void;
}) {
  const { data: prompt } = useSessionPrompt(session.id, { pollMs });
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

/**
 * At a usage limit (N-Limited): a card with Resume at reset / Resume now /
 * Snooze for each one still to decide, then one group of rows for those
 * decided, "Will resume at 3:40 pm" or snoozed, each with Cancel
 */
export function LimitedSection({
  now,
  wide,
  projectNames,
  onOpenSession,
}: Pick<SectionProps, "now" | "wide" | "projectNames" | "onOpenSession">) {
  if (!now.limited.length) return null;
  const decide: Session[] = [];
  const decided: { session: Session; view: "scheduled" | "snoozed" }[] = [];
  for (const session of now.limited) {
    const view = limitView(session);
    if (view === "card") decide.push(session);
    else if (view) decided.push({ session, view });
  }
  if (!decide.length && !decided.length) return null;
  const titleOf = (session: Session) => displayTitle(session, now.titles).title;

  return (
    <section className={cn("flex flex-col", wide ? "gap-3.5" : "gap-2")}>
      <SectionTitle state={wide ? "limited" : undefined}>Limited</SectionTitle>
      {decide.map((session) => (
        <LimitedCard
          key={session.id}
          session={session}
          projectName={projectOf(projectNames, session)}
          title={titleOf(session)}
          onOpen={() => onOpenSession(session)}
        />
      ))}
      {decided.length > 0 && (
        <GroupCard aria-label="Limited, resuming or snoozed">
          {decided.map(({ session, view }) => (
            <LimitedRow
              key={session.id}
              session={session}
              title={titleOf(session)}
              view={view}
              onOpen={() => onOpenSession(session)}
            />
          ))}
        </GroupCard>
      )}
    </section>
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
  const { settle } = useSettle();
  if (now.workingCount === 0) return null;

  // A working row: ask first (its turn ends with the tmux window), then it
  // moves to Settled with a few seconds to undo before the settle is sent
  const settleRow = async (session: Session, title: string) => {
    if (!(await confirmSettleBusy())) return;
    settleWithUndo({
      id: session.id,
      title,
      caption: settleCaption(session),
      commit: () => settle(session, { force: true }),
    });
  };

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
      {/* Swiped rows aren't .row siblings: the hairline goes between all */}
      <GroupCard
        aria-label="Working"
        className="[&>*+*]:border-hair [&>*+*]:border-t dark:[&>*+*]:border-white/[0.06]"
      >
        {working.sessions.map((session) => {
          const title = displayTitle(session, now.titles).title;
          const settle = () => settleRow(session, title);
          return (
            // Swipe left to settle (N-Settle); a vertical drag still scrolls
            <SwipeRow
              key={session.id}
              className="rounded-none"
              trailing={{
                label: "",
                icon: SettleTile,
                tone: "bg-[#7C3AED]",
                onAction: settle,
              }}
            >
              <WorkingSessionRow
                session={session}
                title={title}
                {...row(
                  projectOf(projectNames, session),
                  sessionStatuses[session.id]?.lastLine?.trim() || "Working",
                  shortAge(session.updated_at)
                )}
                selected={session.id === selectedId}
                onOpen={() => onOpenSession(session)}
                onSettle={settle}
              />
            </SwipeRow>
          );
        })}
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

/** The revealed Settle action (N-Settle .swipe .act): check over the word */
function SettleTile() {
  return (
    <span className="flex w-[60px] flex-col items-center gap-[3px] text-[13px] font-semibold">
      <Check className="h-6 w-6" strokeWidth={2.3} />
      Settle
    </span>
  );
}

/**
 * A working session's row, with its PR's chip under the title when it has
 * one ("#107 open · ✓ checks passed"), or "PR #106 merged · Settle" once it
 * merged. The row opens the session; the chip's Settle is its own button
 */
function WorkingSessionRow({
  session,
  title,
  subtitle,
  trailing,
  chevron,
  selected,
  onOpen,
  onSettle,
}: {
  session: Session;
  title: string;
  subtitle: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  selected: boolean;
  onOpen: () => void;
  onSettle: () => void;
}) {
  const pr = sessionPr(session);
  const id = useId();
  return (
    // On the card's colour: the swipe's action sits under the row
    <div className="bg-card">
      <div
        className={cn(
          "row has-[>button:first-child:active]:bg-accent [@media(pointer:fine)]:hover:bg-accent/50 relative w-full",
          pr && "items-start",
          selected && "sel"
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          aria-current={selected || undefined}
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-sub${pr ? ` ${id}-pr` : ""}`}
          className="absolute inset-0"
        />
        <span className="pointer-events-none relative flex min-w-0 flex-1 items-start gap-3">
          <Avatar {...agentAvatar(session.agent_type)} />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5 self-center text-left">
            <span className="min-w-0">
              <span
                id={`${id}-title`}
                className="block truncate text-[16px] font-medium"
              >
                {title}
              </span>
              <span
                id={`${id}-sub`}
                className="text-muted-foreground mt-0.5 block truncate text-[14px]"
              >
                {subtitle}
              </span>
            </span>
            {pr && (
              <span id={`${id}-pr`} className="contents">
                <PrChip
                  pr={pr}
                  baseBranch={session.base_branch}
                  onSettle={wantsSettleChip(session) ? onSettle : undefined}
                />
              </span>
            )}
          </span>
        </span>
        {trailing != null && (
          <span
            className={cn(
              "text-muted-foreground pointer-events-none relative flex shrink-0 items-center text-[13px]",
              pr && "mt-2.5"
            )}
          >
            {trailing}
          </span>
        )}
        {chevron && (
          <ChevronRight
            aria-hidden
            strokeWidth={2}
            className={cn(
              "pointer-events-none relative h-4 w-4 flex-none text-[#AEAEB2] dark:text-[#636366]",
              // Swiped open: the Settle tile stands in for it (N-Settle)
              "[[data-swiped]_&]:invisible",
              pr && "mt-3"
            )}
          />
        )}
      </div>
    </div>
  );
}

/**
 * "Done today" on the wide page (Open-Now): the latest settled sessions,
 * the rest a tap away. Narrow, the Settled group lists them (SettledSection)
 */
export function DoneTodaySection({
  now,
  wide,
  onOpenSession,
}: Pick<SectionProps, "now" | "wide" | "onOpenSession">) {
  const [all, setAll] = useState(false);
  const done = now.doneToday;
  if (!wide || !done.length) return null;

  const byId = new Map(now.settled.map((s) => [s.id, s]));
  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle
        action={
          done.length > DONE_SHOWN
            ? {
                label: all ? "Show less" : "Show all",
                onClick: () => setAll(!all),
              }
            : undefined
        }
      >
        Done today · {done.length}
      </SectionTitle>
      <GroupCard aria-label="Done today">
        {(all ? done : done.slice(0, DONE_SHOWN)).map((item) => {
          const session = byId.get(item.sessionId);
          return (
            <GroupRow
              key={item.sessionId}
              leading={<Avatar {...agentAvatar(session?.agent_type)} />}
              title={item.title}
              subtitle={
                item.prNumber ? `PR #${item.prNumber} merged` : "Settled"
              }
              trailing={shortAge(item.at)}
              onClick={session ? () => onOpenSession(session) : undefined}
            />
          );
        })}
      </GroupCard>
    </section>
  );
}

/** Projects with nothing going on, then sessions outside any project:
    quiet grey rows, Projects one tap away */
export function QuietSection({
  now,
  wide,
  onOpenSession,
}: Pick<SectionProps, "now" | "wide" | "onOpenSession">) {
  const projects = now.quiet.slice(0, QUIET_SHOWN);
  const loose = now.loose.slice(0, QUIET_SHOWN - projects.length);
  if (!projects.length && !loose.length) return null;
  const quietRow = (label: string) => (
    <span className="text-muted-foreground font-normal">{label}</span>
  );
  return (
    <section className={cn("flex flex-col", wide ? "gap-3.5" : "gap-2")}>
      <SectionTitle
        action={{ label: "All projects", onClick: () => runNav("projects") }}
      >
        Quiet · {now.quiet.length + now.loose.length}
      </SectionTitle>
      <GroupCard aria-label="Quiet">
        {projects.map((project) => (
          <GroupRow
            key={project.id}
            leading={<Avatar label={project.name} size="sm" />}
            title={quietRow(project.name)}
            chevron
            onClick={() => openPage({ kind: "project", projectId: project.id })}
            className="min-h-12 py-2.5"
          />
        ))}
        {loose.map((session) => {
          // Paused (handed off): its own state word and where it went
          const handoff = now.handoffs[session.id];
          return (
            <GroupRow
              key={session.id}
              leading={
                <Avatar
                  {...agentAvatar(session.agent_type)}
                  size="sm"
                  className={handoff ? "opacity-60" : undefined}
                />
              }
              title={quietRow(displayTitle(session, now.titles).title)}
              subtitle={handoff}
              trailing={handoff ? STATE_WORD.paused : undefined}
              chevron
              onClick={() => onOpenSession(session)}
              className="min-h-12 py-2.5"
            />
          );
        })}
      </GroupCard>
    </section>
  );
}
