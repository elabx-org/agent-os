/**
 * How the agents view words and walks its tree (N-Tree, O-Tree): the
 * counts line, ages and token counts, row labels, which rows show, and the
 * agent selected by default. Pure, so the unit tests read them.
 */

import type {
  AgentTreeResponse,
  TreeCounts,
  TreeNode,
  TreeNodeKind,
} from "@/lib/agent-tree-types";
import type { Session } from "@/lib/db";
import type { SubagentInfo } from "@/lib/claude-subagents";
import type { WorkflowInfo } from "@/lib/claude-workflows";
import { STATE_WORD, dbTimeMs } from "@/lib/agent-state";
import { withoutFinished } from "@/lib/agent-tree-view";
import { formatAge } from "./activity-format";

/** The kinds that are an agent of their own (a row with an avatar) */
const AGENT_KINDS: TreeNodeKind[] = [
  "agent",
  "subagent",
  "fork",
  "handoff",
  "worker",
  "background",
];

export function isAgentNode(node: TreeNode): boolean {
  return AGENT_KINDS.includes(node.kind);
}

/** Forks, handoffs and workers are sessions of their own: a tap opens them */
export function opensSession(node: TreeNode): boolean {
  return (
    !!node.sessionId &&
    (node.kind === "fork" || node.kind === "handoff" || node.kind === "worker")
  );
}

/**
 * Has a conversation the detail can read (GET /subagents/[agentId]); a
 * background agent's id is the CLI's, not a subagent's
 */
export function hasDetail(node: TreeNode): boolean {
  return !!node.agentId && (node.kind === "agent" || node.kind === "subagent");
}

export type CountKey = keyof TreeCounts;

/** "1 asking · 3 working · 2 done · 1 queued": only the states with any */
export function countParts(
  counts: TreeCounts
): { key: CountKey; text: string }[] {
  const order: [CountKey, string][] = [
    ["asking", "asking"],
    ["working", "working"],
    ["done", "done"],
    ["failed", "failed"],
    ["queued", "queued"],
  ];
  return order
    .filter(([key]) => counts[key] > 0)
    .map(([key, word]) => ({ key, text: `${counts[key]} ${word}` }));
}

/** 48_000 as "48k", 212_400 as "212k", 1_250_000 as "1.3M" */
export function shortTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function ms(value: string | null): number {
  return value ? dbTimeMs(value) : NaN;
}

/**
 * How long it ran: from its start to its finish, or to now while it runs
 * ("6m", "24m", "1h 5m"); "" when its start is unknown
 */
export function nodeAge(node: TreeNode, now = Date.now()): string {
  const start = ms(node.startedAt);
  if (Number.isNaN(start)) return "";
  const finished = ms(node.finishedAt);
  const end = Number.isNaN(finished) ? now : finished;
  return formatAge(Math.max(0, end - start)).split(" ")[0];
}

/** A state as the rows say it: "working", "asking you", "done" */
export function stateWord(node: TreeNode): string {
  return node.state === "needs"
    ? "asking you"
    : STATE_WORD[node.state].toLowerCase();
}

/**
 * The row's label for a screen reader, as the mock: "Design undo-diff,
 * working" (the phase before the name), "Forked session Try sheet without
 * blur, Codex, working"
 */
export function nodeLabel(
  node: TreeNode,
  parent: TreeNode | null,
  agentName?: string
): string {
  const word = stateWord(node);
  if (
    node.kind === "fork" ||
    node.kind === "handoff" ||
    node.kind === "worker"
  ) {
    const what =
      node.kind === "fork"
        ? "Forked session"
        : node.kind === "handoff"
          ? "Handed off session"
          : "Worker session";
    return [`${what} ${node.title}`, agentName, word]
      .filter(Boolean)
      .join(", ");
  }
  if (node.kind === "workflow") return `Workflow ${node.title}, ${word}`;
  if (node.kind === "phase") return `Phase ${node.title}, ${word}`;
  const name =
    parent?.kind === "phase" ? `${parent.title} ${node.title}` : node.title;
  return `${name}, ${word}`;
}

/** The line under a workflow: "Workflow · phase 1 of 2" */
export function workflowLine(node: TreeNode): string {
  if (node.subtitle) return node.subtitle;
  return node.workflow
    ? `Workflow · phase ${node.workflow.phase} of ${node.workflow.phases}`
    : "Workflow";
}

/** The line under a phase: "3 agents · 1 done", "1 agent · queued after Design" */
export function phaseLine(node: TreeNode): string {
  if (node.subtitle) return node.subtitle;
  const p = node.phase;
  if (!p) return node.state === "queued" ? "queued" : "";
  const agents = `${p.agents} ${p.agents === 1 ? "agent" : "agents"}`;
  if (node.state === "queued")
    return p.after
      ? `${agents} · queued after ${p.after}`
      : `${agents} · queued`;
  return p.done ? `${agents} · ${p.done} done` : agents;
}

/**
 * The open Duo's short line, right-aligned beside the name: the first part
 * of the subtitle ("12 tool uses"), the phase ("phase 1 of 2"), the agent
 * count ("3 agents") or "queued"
 */
export function shortLine(node: TreeNode): string {
  if (node.kind === "workflow")
    return node.workflow
      ? `phase ${node.workflow.phase} of ${node.workflow.phases}`
      : "";
  if (node.kind === "phase") {
    if (node.state === "queued") return "queued";
    const n = node.phase?.agents;
    return n ? `${n} ${n === 1 ? "agent" : "agents"}` : "";
  }
  if (node.kind === "session") return node.model ?? "";
  return node.subtitle?.split(" · ")[0] ?? "";
}

/** The tree's top level as shown: finished ones dropped unless `showFinished` */
export function shownChildren(
  tree: AgentTreeResponse,
  showFinished: boolean
): TreeNode[] {
  return showFinished ? tree.children : withoutFinished(tree.children);
}

/**
 * The agent the detail shows when nothing is picked: the first working one,
 * else the first asking, else the first agent with a detail at all
 */
export function defaultSelection(tree: AgentTreeResponse): string | null {
  const all: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (isAgentNode(n)) all.push(n);
      walk(n.children);
    }
  };
  walk(tree.children);
  // An agent with a detail to show before a fork or worker (O-Tree)
  const ranked = [
    ...all.filter(hasDetail),
    ...all.filter((n) => !hasDetail(n)),
  ];
  return (
    ranked.find((n) => n.state === "work")?.id ??
    ranked.find((n) => n.state === "needs")?.id ??
    ranked[0]?.id ??
    null
  );
}

/** The detail's title: "Design · undo-diff" (the node's parent, then it) */
export function detailTitle(node: TreeNode, crumbs: string[]): string {
  return crumbs.length > 1
    ? `${crumbs[crumbs.length - 1]} · ${node.title}`
    : node.title;
}

/** A tool call's age: "40s", "2m"; "now" while it runs */
export function toolAge(
  at: string,
  running: boolean,
  now = Date.now()
): string {
  if (running) return "now";
  const t = ms(at);
  if (Number.isNaN(t)) return "";
  return formatAge(Math.max(0, now - t)).split(" ")[0];
}

/**
 * Every agent a session started, and those still live (working, asking or
 * queued): a long session's finished ones run to hundreds
 */
export interface AgentCounts {
  total: number;
  live: number;
}

/**
 * Roughly how many agents a session started, from what is already polled:
 * its subagents, its workflows' agents, and the sessions forked from it or
 * working for it. The tree's total once the agents view shows.
 */
export function cheapAgentCount(
  sessionId: string,
  subagents: readonly Pick<SubagentInfo, "status">[],
  workflows: readonly Pick<WorkflowInfo, "agents">[],
  sessions: readonly Pick<
    Session,
    "parent_session_id" | "conductor_session_id" | "status"
  >[]
): AgentCounts {
  const agents = workflows.flatMap((run) => run.agents);
  const related = sessions.filter(
    (s) =>
      s.parent_session_id === sessionId || s.conductor_session_id === sessionId
  );
  return {
    total: subagents.length + agents.length + related.length,
    live:
      subagents.filter((a) => a.status === "running").length +
      agents.filter((a) => a.status === "running").length +
      related.filter((s) => s.status === "running" || s.status === "waiting")
        .length,
  };
}

/** The tree's own: working, asking and queued are live */
export function treeAgentCounts(tree: AgentTreeResponse): AgentCounts {
  const { working, asking, queued } = tree.counts;
  return { total: tree.total, live: working + asking + queued };
}
