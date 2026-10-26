"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { File, GitPullRequest, Loader2 } from "lucide-react";
import type { Session } from "@/lib/db";
import type { SubagentInfo } from "@/lib/claude-subagents";
import { cn } from "@/lib/utils";
import {
  fromSubagentStatus,
  STATE_TEXT_CLASS,
  type AgentState,
} from "@/lib/agent-state";
import {
  useElapsed,
  useSessionActivity,
  type SessionActivity,
} from "@/hooks/useSessionActivity";
import { useAnswerPrompt } from "@/data/prompts/queries";
import { AgentRow, SectionHeader, StateWord } from "@/components/rows/AgentRow";
import { DevServerRow } from "@/components/DevServers/DevServerCard";
import { KIND_STYLE, shortLabel, splitOptions } from "@/components/Inbox";
import { mobileNavActions } from "@/stores/mobileNav";
import { openSubagent } from "@/stores/agentOpen";
import { runNav } from "@/lib/nav-actions";

const MAX_FILES = 5;
const MAX_AGENTS = 5;

const PR_PILL: Record<string, string> = {
  open: "bg-blue-400/15 text-blue-600 dark:text-blue-400",
  merged: "bg-emerald-400/15 text-emerald-600 dark:text-emerald-400",
  closed: "bg-secondary text-muted-foreground",
};

/**
 * The live activity rail beside the session: what it's doing now (and the
 * answer it waits on), changed files, its subagents, dev server and PR.
 * `compact` is the strip's sheet, which brings its own title; `onNavigate`
 * runs after anything that leaves the rail, so the sheet can close.
 */
export function ActivityRail({
  session,
  active = true,
  compact,
  onNavigate,
  className,
}: {
  session: Session;
  active?: boolean;
  compact?: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const activity = useSessionActivity(session, { active, rail: true });
  const { files, agents, devServer, pr } = activity;
  const block = cn(
    "border-border grid gap-1 border-b last:border-b-0",
    compact ? "px-2 py-2" : "px-3 py-2.5"
  );

  const toChat = () => {
    mobileNavActions.requestViewMode("chat", session.id);
    onNavigate?.();
  };

  // Running agents first, then the most recent
  const agentRows = [...agents.list]
    .sort(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") ||
        b.updatedAt.localeCompare(a.updatedAt)
    )
    .slice(0, MAX_AGENTS);

  return (
    <div className={cn("min-h-0 overflow-y-auto", className)}>
      {!compact && (
        <div className="text-muted-foreground px-5 pt-[18px] pb-1 text-[11.5px] font-semibold tracking-[.07em] uppercase">
          Live activity
        </div>
      )}

      <section className={block}>
        <SectionHeader className="pt-1">Now</SectionHeader>
        <NowBlock session={session} activity={activity} onMore={toChat} />
      </section>

      <section className={block}>
        <SectionHeader
          className="pt-1"
          count={files.count || undefined}
          action={
            files.count
              ? {
                  label: "Review",
                  onClick: () => {
                    runNav("git");
                    onNavigate?.();
                  },
                }
              : undefined
          }
        >
          Files changed
        </SectionHeader>
        {files.count === 0 ? (
          <p className="text-muted-foreground px-2 pb-1 text-[12.5px]">
            No changes
          </p>
        ) : (
          <ul className="grid gap-1.5 px-2 pt-0.5 pb-1">
            {files.list.slice(0, MAX_FILES).map((file) => (
              <li
                key={file.path}
                className="flex min-w-0 items-center gap-2 text-[12.5px]"
              >
                <File
                  aria-hidden="true"
                  className="text-muted-foreground h-[13px] w-[13px] shrink-0"
                />
                <code
                  title={file.path}
                  className="min-w-0 flex-1 truncate font-mono text-xs"
                >
                  {file.path}
                </code>
                <LineCounts add={file.additions} del={file.deletions} />
              </li>
            ))}
            {files.count > MAX_FILES && (
              <li className="text-muted-foreground text-xs">
                {files.count - MAX_FILES} more
              </li>
            )}
          </ul>
        )}
      </section>

      {agents.list.length > 0 && (
        <section className={block}>
          <SectionHeader className="pt-1" count={agents.list.length}>
            Agents
          </SectionHeader>
          <div className="space-y-px">
            {agentRows.map((agent) => (
              <SubagentRow
                key={agent.agentId}
                agent={agent}
                onOpen={() => {
                  // The chat opens the subagent's panel once it shows
                  openSubagent(session.id, agent.agentId);
                  toChat();
                }}
              />
            ))}
          </div>
        </section>
      )}

      {devServer && (
        <section className={block}>
          <SectionHeader className="pt-1">Dev server</SectionHeader>
          <DevServerRow server={devServer} dense />
        </section>
      )}

      {pr && (
        <section className={block}>
          <SectionHeader className="pt-1">Pull request</SectionHeader>
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:bg-accent/50 flex min-h-[36px] min-w-0 items-center gap-2 rounded-lg px-2 text-[12.5px]"
          >
            <GitPullRequest
              aria-hidden="true"
              className="text-muted-foreground h-[13px] w-[13px] shrink-0"
            />
            <code className="min-w-0 flex-1 truncate font-mono text-xs">
              #{pr.number}
              {pr.title ? ` ${pr.title}` : ""}
            </code>
            <span
              className={cn(
                "shrink-0 rounded-full px-[7px] py-0.5 text-[11px] font-semibold",
                PR_PILL[pr.status] ?? PR_PILL.closed
              )}
            >
              {pr.status}
            </span>
          </a>
        </section>
      )}
    </div>
  );
}

function NowBlock({
  session,
  activity,
  onMore,
}: {
  session: Session;
  activity: SessionActivity;
  onMore: () => void;
}) {
  const { state, now, prompt } = activity;
  const elapsed = useElapsed(
    state === "work" || state === "needs" ? now.startedAt : undefined
  );

  if (state === "needs") {
    return (
      <div className="grid gap-2 px-2 pb-1">
        <BigState
          mark={<span className="h-2 w-2 rounded-full bg-amber-400" />}
          elapsed={elapsed}
        >
          {now.label}
        </BigState>
        <PromptAnswer sessionId={session.id} prompt={prompt} onMore={onMore} />
      </div>
    );
  }

  if (state === "work") {
    return (
      <div className="grid gap-2 px-2 pb-1">
        <BigState
          mark={<Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
          elapsed={elapsed}
        >
          {now.label}
          {now.command && (
            <code className="text-muted-foreground ml-1.5 font-mono text-[12.5px] font-normal">
              {now.command}
            </code>
          )}
        </BigState>
        <IndeterminateBar />
      </div>
    );
  }

  return (
    <div className="px-2 pb-1">
      <BigState mark={<StateDot state={state} />}>{now.label}</BigState>
    </div>
  );
}

function BigState({
  mark,
  elapsed,
  children,
}: {
  mark: ReactNode;
  elapsed?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-[15px] font-medium">
      <span className="grid w-4 shrink-0 place-items-center">{mark}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {elapsed && (
        <span className="text-muted-foreground shrink-0 text-xs font-normal tabular-nums">
          {elapsed}
        </span>
      )}
    </div>
  );
}

function StateDot({ state }: { state: AgentState }) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full",
        state === "done"
          ? "bg-emerald-500"
          : state === "error"
            ? "bg-red-500"
            : "bg-muted-foreground/50"
      )}
    />
  );
}

/** The full command it asks about, and the Inbox card's answers */
function PromptAnswer({
  sessionId,
  prompt,
  onMore,
}: {
  sessionId: string;
  prompt: SessionActivity["prompt"];
  onMore: () => void;
}) {
  const { answer, answering, error } = useAnswerPrompt(sessionId);

  if (prompt === undefined)
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the session…
      </div>
    );
  if (prompt === null)
    return (
      <p className="text-muted-foreground text-[12.5px]">
        Needs a typed reply.{" "}
        <button type="button" onClick={onMore} className="underline">
          Open the chat
        </button>
      </p>
    );

  const split = splitOptions(prompt.options);
  return (
    <>
      {prompt.detail ? (
        <pre className="bg-background border-border max-h-48 overflow-y-auto rounded-[9px] border px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">
          {prompt.detail}
        </pre>
      ) : (
        prompt.question && <p className="text-sm">{prompt.question}</p>
      )}
      <div className="flex gap-2">
        {split.main.map((option) => (
          <button
            key={`${option.index}-${option.label}`}
            type="button"
            title={option.label}
            disabled={answering !== null}
            onClick={() => answer(option)}
            className={cn(
              "flex min-h-[40px] min-w-0 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold disabled:opacity-60",
              KIND_STYLE[option.kind]
            )}
          >
            {answering === option.index && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            )}
            <span className="truncate">{shortLabel(option)}</span>
          </button>
        ))}
      </div>
      {split.more && (
        <button
          type="button"
          onClick={onMore}
          className="text-muted-foreground justify-self-start text-xs"
        >
          More…
        </button>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </>
  );
}

function SubagentRow({
  agent,
  onOpen,
}: {
  agent: SubagentInfo;
  onOpen: () => void;
}) {
  const state = fromSubagentStatus(agent.status);
  const parts = [
    agent.agentType,
    agent.steps !== null
      ? `${agent.steps} ${agent.steps === 1 ? "step" : "steps"}`
      : null,
    agent.status === "running"
      ? null
      : duration(agent.startedAt, agent.updatedAt),
  ].filter(Boolean);
  return (
    <AgentRow
      kind="subagent"
      state={state}
      title={agent.description || agent.agentType}
      subtitle={
        <>
          <StateWord state={state} />
          {parts.map((part) => ` · ${part}`).join("")}
        </>
      }
      dense
      onClick={onOpen}
    />
  );
}

function LineCounts({ add, del }: { add?: number; del?: number }) {
  if (add === undefined && del === undefined) return null;
  return (
    <span className="shrink-0 font-mono text-[11px]">
      <span className={STATE_TEXT_CLASS.done}>+{add ?? 0}</span>{" "}
      <span className={STATE_TEXT_CLASS.error}>−{del ?? 0}</span>
    </span>
  );
}

/** A bar for work with no known end; still under reduced motion */
function IndeterminateBar() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el?.animate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = el.animate(
      [{ transform: "translateX(-100%)" }, { transform: "translateX(250%)" }],
      { duration: 1600, iterations: Infinity, easing: "ease-in-out" }
    );
    return () => animation.cancel();
  }, []);
  return (
    <div className="bg-secondary h-1 overflow-hidden rounded-full">
      <span ref={ref} className="block h-full w-2/5 rounded-full bg-blue-500" />
    </div>
  );
}

/** "26m", "1h 5m"; under a minute "<1m" */
function duration(from: string, to: string): string | null {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
