/**
 * Settings, Machines: the lines of "What {name}'s sessions did here"
 * (GET /api/machines/[id]/activity). Client-safe.
 */

import type { MachineAction } from "@/lib/link/machine-actions";

export interface ActivityLine {
  text: string;
  /** Muted, under it: the first 200 characters of the task or message */
  detail: string | null;
}

export function activityLine(
  action: MachineAction,
  machineName: (id: string) => string | null = () => null
): ActivityLine {
  if (action.action === "refused") {
    return {
      text: `was refused: ${action.detail ?? "no reason given"}`,
      detail: null,
    };
  }
  const target = action.target_name ? `"${action.target_name}"` : "a session";
  const verb =
    action.action === "start"
      ? `started ${target}`
      : action.action === "message"
        ? `sent a message to ${target}`
        : action.action === "answer"
          ? `answered a question in ${target}`
          : action.action === "interrupt"
            ? `interrupted ${target}`
            : `stopped ${target}`;
  const where = action.target_machine_id
    ? ` on ${machineName(action.target_machine_id) ?? "another machine"}`
    : "";
  return { text: verb + where, detail: action.detail };
}

/** The row's detail: "Nothing yet", or how many happened today */
export function activitySummary(
  actions: Pick<MachineAction, "at">[],
  now = Date.now()
): string {
  if (!actions.length) return "Nothing yet";
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = actions.filter((a) => a.at >= midnight.getTime()).length;
  return `${today} today`;
}
