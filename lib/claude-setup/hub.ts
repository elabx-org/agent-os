/**
 * The server's part of bringing a linked machine's Claude setup in line
 * with its own (lib/claude-setup): what the machine is missing, a copy
 * the user asked for, and "keep matching" for machines whose owner
 * turned that on. Server only.
 */

import { caller } from "../link/move";
import { linkHub, ownSha } from "../link/server";
import { listMachines, machineById, serverName } from "../link/store";
import { serverNameOr } from "../server-name";
import { packSetup } from "./install";
import { listItems } from "./inventory";
import { SETUP_FOLLOW_HEADER, SETUP_PROOF_HEADER, setupProof } from "./proof";
import {
  SETUP_KEY,
  followKeys,
  setupDiff,
  type SetupDiff,
  type SetupInventory,
  type SetupJob,
} from "./types";

const shared = globalThis as typeof globalThis & {
  __agentosSetupFollow?: ReturnType<typeof setInterval>;
};

export interface MachineSetup extends SetupDiff {
  hubName: string;
  machineName: string;
  follow: boolean;
  skip: string[];
  job: SetupJob | null;
  claude: boolean;
}

type Headers = Record<string, string>;

export class SetupUnavailable extends Error {}

function ready(machineId: string): string {
  const row = machineById(machineId);
  if (!row || row.status !== "approved") {
    throw new SetupUnavailable("No such machine");
  }
  if (linkHub().presence(machineId) !== "online") {
    throw new SetupUnavailable(`${row.name} is offline`);
  }
  const mine = ownSha();
  if (row.sha && mine && row.sha !== mine) {
    throw new SetupUnavailable(
      `${row.name} is updating itself to this server's AgentOS version. Try again in a minute.`
    );
  }
  return row.name;
}

export async function machineSetup(
  machineId: string,
  headers: Headers
): Promise<MachineSetup> {
  const machineName = ready(machineId);
  const answer = await caller(headers)(machineId, "/api/claude-setup");
  const theirs = await answer.json<SetupInventory>();
  return {
    ...setupDiff(listItems(), theirs.items, theirs.record.placed),
    hubName: serverNameOr(serverName()),
    machineName,
    follow: theirs.record.follow,
    skip: theirs.record.skip,
    job: theirs.job,
    claude: theirs.claude,
  };
}

/** Packs these of the server's items and hands them to the machine */
export async function copySetup(
  machineId: string,
  keys: string[],
  headers: Headers
): Promise<SetupJob> {
  ready(machineId);
  const clean = [...new Set(keys.filter((key) => SETUP_KEY.test(key)))];
  const pack = await packSetup(clean, serverNameOr(serverName()));
  try {
    const answer = await caller(headers)(
      machineId,
      "/api/claude-setup/receive",
      { method: "POST", stream: pack.stream }
    );
    await pack.done;
    return await answer.json<SetupJob>();
  } catch (error) {
    // A pack that failed here is the real reason, not what the machine
    // made of half a file
    await pack.done;
    throw error;
  }
}

async function followOnce(): Promise<void> {
  const headers = {
    [SETUP_PROOF_HEADER]: setupProof(),
    [SETUP_FOLLOW_HEADER]: "1",
  };
  for (const machine of listMachines()) {
    if (machine.status !== "approved") continue;
    try {
      const setup = await machineSetup(machine.id, headers);
      if (!setup.follow || setup.job?.state === "running") continue;
      const keys = followKeys(setup, setup.skip);
      if (keys.length) await copySetup(machine.id, keys, headers);
    } catch (error) {
      if (!(error instanceof SetupUnavailable)) {
        console.error(
          `[claude-setup] keeping ${machine.name} matching:`,
          error
        );
      }
    }
  }
}

/** lib/tickers.ts, on the server only: every 10 minutes */
export function startSetupFollow(): void {
  if (shared.__agentosSetupFollow) return;
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    followOnce()
      .catch((error) => console.error("[claude-setup] follow:", error))
      .finally(() => (busy = false));
  };
  shared.__agentosSetupFollow = setInterval(tick, 10 * 60_000);
  shared.__agentosSetupFollow.unref();
  setTimeout(tick, 90_000).unref();
}
