/**
 * Claude's plan, from its latest TodoWrite / TaskCreate / TaskUpdate calls
 * in the transcript: the Plan chip (Closed-Chat), the Live activity's Plan
 * (E-Live, Desk-Chat rail). No server imports.
 */

import type { ChatItem } from "./claude-transcript";

export type PlanStepStatus = "done" | "active" | "todo";

export interface PlanStep {
  text: string;
  status: PlanStepStatus;
}

export interface PlanState {
  done: number;
  total: number;
  items: PlanStep[];
}

/** GET /api/sessions/[id]/plan */
export interface PlanResponse {
  plan: PlanState | null;
  /** Context tokens of the latest assistant message ("41k tokens") */
  tokens: number | null;
}

/** The tools whose calls make the plan */
export const PLAN_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);

/** One plan tool call, with its result's text (TaskCreate's says its id) */
export interface PlanCall {
  name: string;
  input: unknown;
  result?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function stepStatus(status: unknown): PlanStepStatus {
  return status === "completed"
    ? "done"
    : status === "in_progress"
      ? "active"
      : "todo";
}

function toPlan(items: PlanStep[]): PlanState | null {
  if (!items.length) return null;
  return {
    done: items.filter((s) => s.status === "done").length,
    total: items.length,
    items,
  };
}

/**
 * The plan the latest calls leave: a TodoWrite replaces the whole list; the
 * task tools build one up by id ("Task #3 created successfully: …"), in id
 * order, a deleted task dropping out. Whichever kind came last wins.
 */
export function planFromCalls(calls: readonly PlanCall[]): PlanState | null {
  let todos: PlanStep[] | null = null;
  const tasks = new Map<string, { text: string; status: unknown }>();
  let last: "todos" | "tasks" | null = null;

  for (const call of calls) {
    const input = (call.input ?? {}) as any;
    if (call.name === "TodoWrite") {
      if (!Array.isArray(input.todos)) continue;
      todos = input.todos
        .filter((t: any) => typeof t?.content === "string" && t.content.trim())
        .map((t: any) => ({
          text: t.content.trim(),
          status: stepStatus(t.status),
        }));
      last = "todos";
    } else if (call.name === "TaskCreate") {
      const id = /Task #(\w+)/.exec(call.result ?? "")?.[1];
      const text =
        typeof input.subject === "string" ? input.subject.trim() : "";
      if (!id || !text) continue;
      tasks.set(id, { text, status: input.status ?? "pending" });
      last = "tasks";
    } else if (call.name === "TaskUpdate") {
      const id = input.taskId === undefined ? "" : String(input.taskId);
      const task = tasks.get(id);
      if (!task) continue;
      if (input.status === "deleted") tasks.delete(id);
      else {
        if (typeof input.status === "string") task.status = input.status;
        if (typeof input.subject === "string" && input.subject.trim())
          task.text = input.subject.trim();
      }
      last = "tasks";
    }
  }

  if (last === "todos") return toPlan(todos ?? []);
  if (last === "tasks") {
    const ordered = [...tasks.entries()].sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    return toPlan(
      ordered.map(([, t]) => ({ text: t.text, status: stepStatus(t.status) }))
    );
  }
  return null;
}

/**
 * Null when the transcript has no plan. Tool items carry their `input` for
 * the plan tools; without it (an older server) a call is skipped
 */
export function planFromItems(items: readonly ChatItem[]): PlanState | null {
  const results = new Map<string, string>();
  for (const item of items)
    if (item.kind === "result") results.set(item.toolUseId, item.preview);
  const calls: PlanCall[] = [];
  for (const item of items) {
    if (item.kind !== "tool" || !PLAN_TOOLS.has(item.name)) continue;
    const input = (item as { input?: unknown }).input;
    if (input === undefined) continue;
    calls.push({ name: item.name, input, result: results.get(item.id) });
  }
  return planFromCalls(calls);
}

/** A tool result's text, whether a string or text parts */
function resultText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
}

/**
 * The plan and context size from raw transcript entries (parsed JSONL
 * lines, oldest first). Tokens: the latest main-chain assistant message's
 * input plus cache tokens, or null when no entry carries usage
 */
export function planFromEntries(entries: readonly unknown[]): PlanResponse {
  const calls: (PlanCall & { id: string })[] = [];
  const byId = new Map<string, PlanCall>();
  let tokens: number | null = null;

  for (const raw of entries) {
    const entry = raw as any;
    if (!entry || entry.isSidechain || !entry.message) continue;
    const content = entry.message.content;
    if (entry.type === "assistant") {
      const usage = entry.message.usage;
      if (usage && typeof usage.input_tokens === "number") {
        tokens =
          usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
      }
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part?.type !== "tool_use" || !PLAN_TOOLS.has(part.name)) continue;
        const call = {
          id: String(part.id),
          name: part.name,
          input: part.input,
        };
        calls.push(call);
        byId.set(call.id, call);
      }
    } else if (entry.type === "user" && Array.isArray(content)) {
      for (const part of content) {
        if (part?.type !== "tool_result") continue;
        const call = byId.get(String(part.tool_use_id));
        if (call) call.result = resultText(part.content);
      }
    }
  }
  return { plan: planFromCalls(calls), tokens };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** "Merge and deploy": the step in hand, else the next, else the last */
export function currentStep(plan: PlanState): PlanStep | undefined {
  return (
    plan.items.find((s) => s.status === "active") ??
    plan.items.find((s) => s.status === "todo") ??
    plan.items[plan.items.length - 1]
  );
}
