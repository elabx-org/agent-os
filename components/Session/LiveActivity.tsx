"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, GitPullRequest } from "lucide-react";
import type { Session } from "@/lib/db";
import type { PlanStep } from "@/lib/claude-plan";
import type { SubagentInfo } from "@/lib/claude-subagents";
import type { WorkflowInfo } from "@/lib/claude-workflows";
import type { GitFile } from "@/lib/git-status";
import { cn } from "@/lib/utils";
import {
  fromSubagentStatus,
  LIMIT_EDGE_CLASS,
  LIMIT_TEXT_CLASS,
  STATE_DOT_CLASS,
  STATE_WORD,
} from "@/lib/agent-state";
import {
  useSessionActivity,
  type SessionActivity,
} from "@/hooks/useSessionActivity";
import { NeedsYouCard } from "@/components/Chat/NeedsYouCard";
import { StateDot } from "@/components/a/StateDot";
import { mobileNavActions } from "@/stores/mobileNav";
import { openSubagent } from "@/stores/agentOpen";
import { runNav } from "@/lib/nav-actions";
import {
  formatAge,
  liveSummary,
  phaseRows,
  workingLine,
} from "./activity-format";

const MAX_FILES = 5;
const MAX_AGENTS = 5;
const MAX_WORKFLOWS = 2;

const PR_PILL: Record<string, string> = {
  open: "bg-blue-400/15 text-blue-600 dark:text-blue-400",
  merged: "bg-emerald-400/15 text-emerald-600 dark:text-emerald-400",
  closed: "bg-secondary text-muted-foreground",
};

/** Re-renders every `ms`, for clocks that read Date.now() */
function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

/**
 * The Live activity (E-Live sheet, Desk-Chat rail): what the agent waits on
 * or does now, Claude's plan, its workflow's phases, the files changed, and
 * on the rail its background agents and what runs. `title` renders the
 * heading (the sheet's is its dialog title); `menu` sits beside it.
 */
export function LiveActivity({
  session,
  active = true,
  variant,
  title = (text) => text,
  menu,
  onNavigate,
  className,
}: {
  session: Session;
  active?: boolean;
  variant: "sheet" | "rail";
  title?: (text: string) => ReactNode;
  menu?: ReactNode;
  /** After anything that leaves the Live activity, so a sheet can close */
  onNavigate?: () => void;
  className?: string;
}) {
  const activity = useSessionActivity(session, { active, rail: true });
  const { state, plan, tokens, files, agents, workflows, devServer, pr } =
    activity;
  useTick(15_000);
  const rail = variant === "rail";

  const toChat = () => {
    mobileNavActions.requestViewMode("chat", session.id);
    onNavigate?.();
  };
  const openAgent = (agentId: string) => {
    // The chat opens the agent's conversation once it shows
    openSubagent(session.id, agentId);
    toChat();
  };

  // Running first, then the most recent
  const byRecent = <T extends { status: string; updatedAt: string }>(
    list: readonly T[]
  ) =>
    [...list].sort(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") ||
        b.updatedAt.localeCompare(a.updatedAt)
    );
  const workflowRows = byRecent(workflows.list).slice(0, MAX_WORKFLOWS);
  // The sheet keeps to what's live; the rail lists the finished too
  const agentRows = byRecent(agents.list)
    .filter((a) => rail || a.status === "running")
    .slice(0, MAX_AGENTS);
  const summary = liveSummary(
    state === "work" || state === "needs" ? Date.now() - activity.since : null,
    tokens
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-y-auto",
        rail ? "gap-[18px] px-[18px] py-5" : "gap-3.5 px-4 pb-4",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div
          className={cn(
            "min-w-0 truncate",
            rail ? "t-head" : "text-[20px] leading-tight font-bold"
          )}
        >
          {title("Live activity")}
        </div>
        {menu}
        {summary && (
          <span className="text-muted-foreground ml-auto shrink-0 text-[13px] tabular-nums">
            {summary}
          </span>
        )}
      </div>

      {state === "needs" ? (
        <NeedsYouCard
          session={session}
          variant={rail ? "rail" : "sheet"}
          onOpenTerminal={() => {
            mobileNavActions.requestViewMode("terminal", session.id);
            onNavigate?.();
          }}
        />
      ) : (
        <StatusLine activity={activity} />
      )}

      {plan && plan.items.length > 0 && (
        <Section label="Plan" gap={rail ? "gap-2.5" : "gap-[9px]"}>
          {plan.items.map((step, i) => (
            <PlanStepRow key={i} step={step} />
          ))}
        </Section>
      )}

      {workflowRows.map((run) => (
        <WorkflowBlock key={run.runId} run={run} onOpenAgent={openAgent} />
      ))}

      <Section
        label="Files changed"
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
        {files.count === 0 ? (
          <p className="text-muted-foreground text-[13px]">No changes</p>
        ) : (
          <>
            {files.list.slice(0, MAX_FILES).map((file) => (
              <FileRow key={file.path} file={file} fullPath={rail} />
            ))}
            {files.count > MAX_FILES && (
              <span className="text-muted-foreground text-[13px]">
                {files.count - MAX_FILES} more
              </span>
            )}
          </>
        )}
      </Section>

      {agentRows.length > 0 && (
        <Section label="Background agents">
          <div className="group-card">
            {agentRows.map((agent) => (
              <AgentRow
                key={agent.agentId}
                agent={agent}
                onOpen={() => openAgent(agent.agentId)}
              />
            ))}
          </div>
        </Section>
      )}

      {devServer && devServer.status === "running" && (
        <Section label="Running">
          <RunningRow server={devServer} />
        </Section>
      )}

      {pr && (
        <Section label="Pull request">
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-9 min-w-0 items-center gap-2 text-[13px]"
          >
            <GitPullRequest
              aria-hidden
              className="text-muted-foreground h-[14px] w-[14px] shrink-0"
            />
            <span className="min-w-0 flex-1 truncate font-mono">
              #{pr.number}
              {pr.title ? ` ${pr.title}` : ""}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-[7px] py-0.5 text-[11px] font-semibold",
                PR_PILL[pr.status] ?? PR_PILL.closed
              )}
            >
              {pr.status}
            </span>
          </a>
        </Section>
      )}
    </div>
  );
}

/**
 * What it's doing, when it isn't waiting on you: N-Queue's status card,
 * "Working · Editing ActivityStrip.tsx  4m", else its state word
 */
/** "Limited · resets 3:40 pm" with the word in the limited violet */
export function LimitedLabel({ label }: { label: string }) {
  const rest = label.replace(/^Limited/, "");
  return (
    <>
      <span className={cn("font-semibold", LIMIT_TEXT_CLASS)}>Limited</span>
      {rest}
    </>
  );
}

export function StatusLine({
  activity,
  className,
}: {
  activity: SessionActivity;
  className?: string;
}) {
  const { state, now } = activity;
  const work = state === "work";
  return (
    <div
      className={cn(
        "status-card min-w-0 shrink-0",
        work && "tone-work",
        state === "needs" && "tone-needs",
        state === "limited" && LIMIT_EDGE_CLASS,
        className
      )}
    >
      <StateDot state={state} className="mr-1" />
      <span className="min-w-0 flex-1 truncate">
        {work ? (
          <>
            <span className="dark:text-work font-semibold text-emerald-600">
              Working
            </span>
            {now.label !== "Working" && ` · ${workingLine(now)}`}
          </>
        ) : state === "needs" ? (
          <span className="dark:text-needs font-semibold text-amber-600">
            {now.label}
          </span>
        ) : state === "limited" ? (
          <LimitedLabel label={now.label} />
        ) : (
          STATE_WORD[state]
        )}
      </span>
      {(work || state === "needs") && now.startedAt !== undefined && (
        <span className="text-muted-foreground shrink-0 pr-1.5 text-[13px] tabular-nums">
          {formatAge(Date.now() - now.startedAt)}
        </span>
      )}
    </div>
  );
}

function Section({
  label,
  action,
  gap = "gap-2",
  children,
}: {
  label: string;
  action?: { label: string; onClick: () => void };
  gap?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col", gap)}>
      <div className="text-muted-foreground flex items-center text-[13px] font-semibold">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="text-primary dark:text-meter shrink-0 font-medium"
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function PlanStepRow({ step }: { step: PlanStep }) {
  return (
    <div className={cn("plan-step", step.status === "active" && "active")}>
      <span
        aria-hidden
        className={cn(
          "step-mark",
          step.status === "done" && "done",
          step.status === "active" && "active"
        )}
      >
        {step.status === "done" && (
          <Check className="h-3 w-3" strokeWidth={3} />
        )}
      </span>
      <span className="sr-only">
        {step.status === "done"
          ? "Done: "
          : step.status === "active"
            ? "Now: "
            : "To do: "}
      </span>
      <span className="min-w-0 flex-1">{step.text}</span>
    </div>
  );
}

/** "Workflow · review-changes", its phases on a card */
function WorkflowBlock({
  run,
  onOpenAgent,
}: {
  run: WorkflowInfo;
  onOpenAgent: (agentId: string) => void;
}) {
  const rows = phaseRows(run);
  return (
    <Section label={`Workflow · ${run.name}`}>
      <div className="flex flex-col gap-2 rounded-2xl bg-[#f7f7f9] px-3 py-2.5 dark:bg-[#141416]">
        {rows.map((row) => {
          // A phase opens its agent: the running one, else the last
          const agents = run.agents.filter(
            (a) => (a.phase ?? "Other") === row.name
          );
          const agent =
            agents.find((a) => a.status === "running") ?? agents.at(-1);
          return (
            <button
              key={row.name}
              type="button"
              disabled={!agent}
              onClick={() => agent && onOpenAgent(agent.agentId)}
              className="flex min-h-7 min-w-0 items-center gap-2 text-left text-sm"
            >
              <span className="grid w-5 shrink-0 place-items-center">
                {row.status === "done" ? (
                  <Check
                    aria-hidden
                    className="dark:text-work h-4 w-4 text-emerald-600"
                    strokeWidth={2.6}
                  />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2 rounded-full",
                      row.status === "active"
                        ? "bg-work"
                        : "border-muted-foreground/50 border"
                    )}
                  />
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  row.status === "todo" && "text-muted-foreground"
                )}
              >
                {row.name}
                {row.detail && ` · ${row.detail}`}
              </span>
              {row.right && (
                <span className="text-muted-foreground shrink-0 text-[13px] tabular-nums">
                  {row.right}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function FileRow({ file, fullPath }: { file: GitFile; fullPath: boolean }) {
  const name = fullPath ? file.path : file.path.split("/").pop() || file.path;
  return (
    <button
      type="button"
      title={file.path}
      onClick={() => runNav("git")}
      className="flex min-w-0 items-center gap-2 text-left text-[13px]"
    >
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      {file.additions !== undefined && (
        <span className="n-add shrink-0">+{file.additions}</span>
      )}
      {file.deletions !== undefined && (
        <span className="n-del shrink-0">−{file.deletions}</span>
      )}
    </button>
  );
}

function AgentRow({
  agent,
  onOpen,
}: {
  agent: SubagentInfo;
  onOpen: () => void;
}) {
  const state = fromSubagentStatus(agent.status);
  const ms =
    (agent.status === "running" ? Date.now() : Date.parse(agent.updatedAt)) -
    Date.parse(agent.startedAt);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="row min-h-0 w-full gap-2.5 px-3 py-2.5 text-left"
    >
      <span
        aria-hidden
        className={cn("h-2 w-2 shrink-0 rounded-full", STATE_DOT_CLASS[state])}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{agent.agentType}</span>
        <span className="text-muted-foreground truncate text-[13px]">
          {agent.description || STATE_WORD[state]}
          {Number.isFinite(ms) && ` · ${formatAge(ms)}`}
        </span>
      </span>
    </button>
  );
}

/** "● next dev :3000  Open" */
function RunningRow({
  server,
}: {
  server: NonNullable<SessionActivity["devServer"]>;
}) {
  let port: number | undefined;
  try {
    port = (JSON.parse(server.ports || "[]") as number[])[0];
  } catch {}
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span aria-hidden className="bg-work h-2 w-2 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1 truncate font-mono">
        {server.command || server.name}
        {port ? ` :${port}` : ""}
      </span>
      {port && (
        <a
          href={`http://localhost:${port}`}
          target="_blank"
          rel="noopener noreferrer"
          className="pill pill-secondary pill-sm h-[30px] shrink-0"
        >
          Open
        </a>
      )}
    </div>
  );
}
