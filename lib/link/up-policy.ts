/**
 * The hub's own limits on what sessions on a linked machine do here
 * (HubDeps.beforeUp, lib/link/hub.ts), on top of lib/link/up.ts's 8 at
 * once and 300 a minute: starts per machine, messages per target session,
 * and relays only to machines that enforce the same route rules. The
 * counts live on globalThis: server.ts and the Next routes are separate
 * module graphs, and linkRequest counts starts going down as well.
 */

import { CAP_UP } from "./protocol";
import type { MachineRow } from "./store";
import { upRefusal, type UpDecision, type UpRefusal } from "./up";

interface Window {
  ms: number;
  max: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Starts per machine: 6 a minute, 30 an hour */
export const START_LIMITS: Window[] = [
  { ms: MINUTE, max: 6 },
  { ms: HOUR, max: 30 },
];
/** Messages from one machine to one session: 30 an hour */
export const MESSAGE_LIMITS: Window[] = [{ ms: HOUR, max: 30 }];

/** Times something happened per key, within the longest window */
export class RateWindows {
  private times = new Map<string, number[]>();

  /** false: over a limit, and nothing was counted */
  hit(key: string, limits: Window[], now: number): boolean {
    const longest = Math.max(...limits.map((l) => l.ms));
    const recent = (this.times.get(key) ?? []).filter(
      (at) => at > now - longest
    );
    for (const limit of limits) {
      const inside = recent.filter((at) => at > now - limit.ms).length;
      if (inside >= limit.max) {
        this.times.set(key, recent);
        return false;
      }
    }
    recent.push(now);
    this.times.set(key, recent);
    return true;
  }
}

const shared = globalThis as typeof globalThis & {
  __agentosUpPolicy?: RateWindows;
};

export const policyWindows = (): RateWindows =>
  (shared.__agentosUpPolicy ??= new RateWindows());

const SEND_KEYS =
  /^(?:\/m\/m_[0-9a-f]{12})?\/api\/sessions\/([0-9a-f-]{36})\/send-keys$/;

export interface PolicyDeps {
  /** lib/link/hub.ts hasCap: null when that machine is offline */
  hasCap(machineId: string, cap: string): boolean | null;
  windows?: RateWindows;
  now?: () => number;
}

export function beforeUp(
  decision: Extract<UpDecision, { ok: true }>,
  machine: MachineRow,
  deps: PolicyDeps
): UpRefusal | null {
  const windows = deps.windows ?? policyWindows();
  const now = deps.now?.() ?? Date.now();
  const target = decision.targetMachineId;
  // Only a machine on this version enforces the route rules for callers
  // from another machine
  if (target) {
    const up = deps.hasCap(target, CAP_UP);
    if (up === null) return upRefusal("machine_offline");
    if (!up) return upRefusal("machine_old");
  }
  const action = decision.rule.action;
  if (
    action === "start" &&
    !windows.hit(`start:${machine.id}`, START_LIMITS, now)
  ) {
    return upRefusal("too_many");
  }
  if (action === "message") {
    const session = decision.path.split("?")[0].match(SEND_KEYS)?.[1] ?? "";
    const key = `message:${machine.id}:${target ?? "hub"}:${session}`;
    if (!windows.hit(key, MESSAGE_LIMITS, now)) return upRefusal("too_many");
  }
  return null;
}

/**
 * linkRequest: a start that isn't the user's own browser, going down to a
 * machine. The same limits as a machine's starts here, per target machine
 */
export function allowStartDown(
  machineId: string,
  windows: RateWindows = policyWindows(),
  now = Date.now()
): boolean {
  return windows.hit(`down:${machineId}`, START_LIMITS, now);
}
