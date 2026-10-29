"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Workflow } from "lucide-react";
import type { SubagentInfo } from "@/lib/claude-subagents";
import type { WorkflowAgent, WorkflowInfo } from "@/lib/claude-workflows";
import { fromSubagentStatus, STATE_TEXT_CLASS } from "@/lib/agent-state";
import { KindBadge, StateWord } from "@/components/rows/AgentRow";
import { cn } from "@/lib/utils";

export interface PhaseGroup {
  name: string;
  agents: WorkflowAgent[];
}

/** The declared phases in order, each with its agents; undeclared ones after */
export function workflowPhases(run: WorkflowInfo): PhaseGroup[] {
  const groups = new Map<string, PhaseGroup>();
  for (const name of run.phases) groups.set(name, { name, agents: [] });
  for (const agent of run.agents) {
    const name = agent.phase ?? "Other";
    if (!groups.has(name)) groups.set(name, { name, agents: [] });
    groups.get(name)!.agents.push(agent);
  }
  return [...groups.values()];
}

/** A workflow's agent as a subagent, for the chat's subagent panel */
export function workflowAgentInfo(
  run: WorkflowInfo,
  agent: WorkflowAgent
): SubagentInfo {
  return {
    agentId: agent.agentId,
    toolUseId: null,
    description: agent.label,
    agentType: agent.phase ? `${agent.phase} phase` : "Workflow agent",
    status: agent.status,
    steps: null,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  };
}

/** 134,975 as "135.0k" */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Every phase of a run, the current one open */
export function WorkflowPhaseList({
  run,
  onOpenAgent,
  className,
}: {
  run: WorkflowInfo;
  onOpenAgent?: (agentId: string) => void;
  className?: string;
}) {
  const running = run.status === "running";
  const phases = workflowPhases(run);
  const phaseIndex = phases.findIndex((p) => p.name === run.phase);
  return (
    <ol className={cn("text-[12px]", className)}>
      {phases.map((phase, i) => (
        <WorkflowPhase
          key={phase.name}
          number={i + 1}
          phase={phase}
          current={running && i === phaseIndex}
          reached={i <= phaseIndex || !running}
          onOpenAgent={onOpenAgent}
        />
      ))}
    </ol>
  );
}

/** One phase: its number, name and agents done; its agents when open */
function WorkflowPhase({
  number,
  phase,
  current,
  reached,
  onOpenAgent,
}: {
  number: number;
  phase: PhaseGroup;
  current: boolean;
  reached: boolean;
  onOpenAgent?: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(current);
  useEffect(() => {
    if (current) setOpen(true);
  }, [current]);
  const done = phase.agents.filter((a) => a.status === "done").length;
  const total = phase.agents.length;
  const finished = total > 0 && done === total && !current;
  return (
    <li>
      <button
        type="button"
        aria-expanded={total ? open : undefined}
        disabled={!total}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "hover:bg-accent/50 flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left disabled:hover:bg-transparent",
          current && "text-foreground font-medium",
          !reached && "text-muted-foreground/60"
        )}
      >
        <span className="w-3 shrink-0 text-center tabular-nums">
          {finished ? (
            <span className={STATE_TEXT_CLASS.done}>✓</span>
          ) : current ? (
            <span className="text-work">›</span>
          ) : (
            number
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{phase.name}</span>
        {total > 0 && (
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {done}/{total}
          </span>
        )}
      </button>
      {open && total > 0 && (
        <ul className="pb-1 pl-4">
          {phase.agents.map((agent) => (
            <li key={agent.agentId}>
              <AgentLine agent={agent} onOpen={onOpenAgent} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function AgentMark({ status }: { status: WorkflowAgent["status"] }) {
  return (
    <span
      aria-label={status}
      className={cn(
        "w-3 shrink-0 text-center leading-5",
        status === "done"
          ? STATE_TEXT_CLASS.done
          : status === "running"
            ? "text-work"
            : "text-muted-foreground"
      )}
    >
      {status === "done" ? "✓" : status === "running" ? "●" : "○"}
    </span>
  );
}

/** An agent: its state, label, model and context; its conversation on tap */
function AgentLine({
  agent,
  onOpen,
}: {
  agent: WorkflowAgent;
  onOpen?: (agentId: string) => void;
}) {
  const body = (
    <>
      <AgentMark status={agent.status} />
      <span className="min-w-0 flex-1">
        <span className="block font-mono leading-5 break-all">
          {agent.label}
        </span>
        {(agent.model || agent.tokens) && (
          <span className="text-muted-foreground block text-[11px] tabular-nums">
            {[agent.model, agent.tokens && `${tokens(agent.tokens)} tokens`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </span>
    </>
  );
  if (!onOpen)
    return <div className="flex min-w-0 gap-2 px-1.5 py-0.5">{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(agent.agentId)}
      aria-label={`Open ${agent.label}`}
      className="hover:bg-accent/50 active:bg-accent flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left"
    >
      {body}
      <ChevronRight
        aria-hidden="true"
        className="text-muted-foreground h-3.5 w-3.5 shrink-0"
      />
    </button>
  );
}

/** "Phase 2 of 4 · Build" */
function phaseLine(run: WorkflowInfo): string | null {
  const phases = workflowPhases(run);
  const i = phases.findIndex((p) => p.name === run.phase);
  if (run.status !== "running" || !run.phase) return null;
  return i >= 0
    ? `Phase ${i + 1} of ${phases.length} · ${run.phase}`
    : run.phase;
}

/**
 * A Workflow call in the conversation: its state and phase, a bar of the
 * phases done, its latest agents, and the whole run on "Show all"
 */
export function WorkflowCard({
  run,
  onOpenAgent,
  onShowAll,
}: {
  run: WorkflowInfo;
  onOpenAgent: (agentId: string) => void;
  onShowAll: () => void;
}) {
  const state = fromSubagentStatus(
    run.status === "failed" ? "stopped" : run.status
  );
  const phases = workflowPhases(run);
  const i = phases.findIndex((p) => p.name === run.phase);
  const done = run.status === "done" ? phases.length : Math.max(0, i);
  const current = phases[i];
  const latest = [...run.agents].reverse().slice(0, 3);
  const line = phaseLine(run);
  return (
    <div className="bg-card border-border overflow-hidden rounded-xl border">
      <div className="flex min-w-0 items-center gap-2.5 px-3 pt-2.5">
        <KindBadge kind="subagent" state={state} icon={Workflow} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px]">{run.name}</div>
          <div className="text-muted-foreground truncate text-xs">
            <StateWord state={state} />
            {run.status === "failed" && " (failed)"}
            {line && ` · ${line}`}
          </div>
        </div>
      </div>
      {phases.length > 0 && (
        <div className="flex items-center gap-2 px-3 pt-2">
          <div className="flex h-1 flex-1 gap-0.5" aria-hidden="true">
            {phases.map((p, n) => (
              <span
                key={p.name}
                className={cn(
                  "flex-1 rounded-full",
                  n < done
                    ? "bg-emerald-500"
                    : n === i && run.status === "running"
                      ? "bg-work"
                      : "bg-secondary"
                )}
              />
            ))}
          </div>
          {current && run.status === "running" && (
            <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
              {current.agents.filter((a) => a.status === "done").length}/
              {current.agents.length}
            </span>
          )}
        </div>
      )}
      {latest.length > 0 && (
        <ul className="px-1.5 pt-1.5 text-[12px]">
          {latest.map((agent) => (
            <li key={agent.agentId}>
              <AgentLine agent={agent} onOpen={onOpenAgent} />
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onShowAll}
        className="text-primary border-border mt-1.5 w-full border-t px-3 py-2 text-left text-xs font-medium"
      >
        Show all {run.agents.length}{" "}
        {run.agents.length === 1 ? "agent" : "agents"}
        {phases.length > 0 && ` · ${phases.length} phases`}
      </button>
    </div>
  );
}

/**
 * A whole workflow run: over the chat on a phone, beside it when there's
 * room. An agent opens its own conversation; back returns here.
 */
export function WorkflowPanel({
  run,
  onOpenAgent,
  onClose,
  className,
}: {
  run: WorkflowInfo;
  onOpenAgent: (agentId: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const state = fromSubagentStatus(
    run.status === "failed" ? "stopped" : run.status
  );
  const line = phaseLine(run);
  return (
    <section
      aria-label={run.name}
      className={cn(
        "bg-background border-border absolute inset-0 z-10 flex flex-col @2xl/chat:static @2xl/chat:w-[46%] @2xl/chat:max-w-xl @2xl/chat:shrink-0 @2xl/chat:border-l",
        className
      )}
    >
      <header className="border-border flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the conversation"
          className="text-primary active:bg-accent hover:bg-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-medium">
            {run.name}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            <StateWord state={state} />
            {run.status === "failed" && " (failed)"}
            {line ? ` · ${line}` : ` · Workflow`}
          </div>
        </div>
        <KindBadge kind="subagent" state={state} icon={Workflow} />
        <span className="w-2" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(0.75rem+var(--pane-inset-bottom,env(safe-area-inset-bottom)))]">
        <div className="mx-auto max-w-3xl">
          {run.agents.length === 0 && run.phases.length === 0 ? (
            <div className="text-muted-foreground py-8 text-sm">
              No agents yet.
            </div>
          ) : (
            <WorkflowPhaseList
              run={run}
              onOpenAgent={onOpenAgent}
              className="text-[13px]"
            />
          )}
        </div>
      </div>
    </section>
  );
}
