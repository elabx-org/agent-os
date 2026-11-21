/**
 * Take-overs running on the hub (lib/backup/takeover.ts), on globalThis:
 * the link (server.ts's module graph) calls them off when their machine
 * connects, the routes start and poll them. No heavy imports, so the
 * link can load this.
 */

import type { TakeJob } from "./types";

export interface Running {
  job: TakeJob;
  takeId: string;
  /** Its machine connected while this ran */
  cameBack: boolean;
  /** Stops the arrival if it isn't written here yet */
  cancel(): Promise<void>;
}

const shared = globalThis as typeof globalThis & {
  __agentosTakes?: Map<string, Running>;
};
export const takes = () => (shared.__agentosTakes ??= new Map());

/**
 * HubDeps.onMachineBack: the machine connected while its session was
 * being continued here. Called off if it isn't written here yet; else it
 * stands, and the machine is told to pause at once
 */
export function onMachineBack(machine: { id: string }): void {
  for (const run of takes().values()) {
    if (run.job.machineId !== machine.id) continue;
    if (run.job.step === "done" || run.job.step === "failed") continue;
    run.cameBack = true;
    run.cancel().catch(() => {});
  }
}
