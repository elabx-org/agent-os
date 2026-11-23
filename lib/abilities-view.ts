/**
 * This machine's abilities with the ones of the machines linked to it
 * (lib/abilities.ts), and the exchange between a machine and its server.
 * Server only.
 */

import {
  abilities,
  peerAbilities,
  setPeerAbilities,
  abilityNotes,
} from "./abilities";
import {
  cleanAbilities,
  machineSection,
  type AbilitiesView,
} from "./abilities-types";
import { here, hubNameHere } from "./backup/peer";
import type { JobRule } from "./jobs/types";
import { hubMemo, hubUp, isMachineMode, uploadToHub } from "./link/machine";
import { HUB_PEER } from "./link/protocol";
import { machinesOn } from "./link/server";
import { listMachines } from "./link/store";

function peers(): AbilitiesView["peers"] {
  if (isMachineMode()) {
    // Its server, once it has linked to one
    if (!hubUp().linked && !hubMemo().machineId) return [];
    return [
      { id: HUB_PEER, name: hubNameHere(), abilities: peerAbilities(HUB_PEER) },
    ];
  }
  if (!machinesOn()) return [];
  return listMachines()
    .filter((m) => m.status === "approved")
    .map((m) => ({ id: m.id, name: m.name, abilities: peerAbilities(m.id) }));
}

/** GET /api/abilities */
export async function abilitiesView(fresh = false): Promise<AbilitiesView> {
  return {
    name: here().name,
    abilities: await abilities(fresh),
    notes: abilityNotes(),
    peers: peers(),
  };
}

/**
 * What a starting session is told about its machine; null when no other
 * machine is linked, or the check takes longer than a session should wait
 */
export async function machineNote(rule?: JobRule): Promise<string | null> {
  try {
    if (peers().length === 0) return null;
    const view = await Promise.race([
      abilitiesView(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    // Jobs go from the server to its machines (lib/jobs/hub.ts)
    return view ? machineSection(view, !isMachineMode(), rule) : null;
  } catch (error) {
    console.error("[abilities] note:", error);
    return null;
  }
}

/**
 * On a machine: tells its server what this machine can do and keeps what
 * the server says of itself. An older server has no such route: nothing
 */
export async function swapAbilities(): Promise<void> {
  if (!isMachineMode() || !hubUp().linked) return;
  const body = Buffer.from(JSON.stringify({ abilities: await abilities() }));
  const answer = await uploadToHub({
    method: "POST",
    path: "/api/link/inbox/peer/abilities",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
    },
    body,
  });
  if (answer.status !== 200) return;
  try {
    const said = JSON.parse(answer.body.toString("utf8")) as {
      abilities?: unknown;
    };
    const theirs = cleanAbilities(said.abilities);
    if (theirs) setPeerAbilities(HUB_PEER, theirs);
  } catch {
    // Not an answer this build reads
  }
}

/** On the server: a linked machine said what it can do */
export async function takeAbilities(
  machineId: string,
  body: unknown
): Promise<{ abilities: AbilitiesView["abilities"] } | null> {
  const theirs = cleanAbilities((body as { abilities?: unknown })?.abilities);
  if (!theirs) return null;
  setPeerAbilities(machineId, theirs);
  return { abilities: await abilities() };
}
