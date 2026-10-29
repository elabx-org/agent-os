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

// M2 contract: signature only; U2.3 implements it

/** Null when the transcript has no plan */
export function planFromItems(_items: readonly ChatItem[]): PlanState | null {
  return null;
}

/** GET /api/sessions/[id]/plan */
export interface PlanResponse {
  plan: PlanState | null;
  /** Context tokens of the latest assistant message ("41k tokens") */
  tokens: number | null;
}
