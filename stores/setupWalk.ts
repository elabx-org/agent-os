import { proxy } from "valtio";

/**
 * The set-up walk for a linked machine (components/Machines/SetupWalk.tsx):
 * which machine's walk is up. Opened when a machine is approved, and from
 * its page in Settings, Machines.
 */
export const setupWalkStore = proxy<{ machine: string | null }>({
  machine: null,
});

export function openSetupWalk(machineId: string): void {
  setupWalkStore.machine = machineId;
}

export function closeSetupWalk(): void {
  setupWalkStore.machine = null;
}
