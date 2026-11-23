/**
 * A machine continued one of its hub's sessions from the copy it keeps
 * (lib/backup/hub-send.ts), while the hub was off. When the hub is back
 * the machine says so, and the hub pauses its own: the mirror of the
 * hub's "taken" list (lib/backup/taken.ts). Server only.
 */

import { getDb } from "../db";
import { hubUp, uploadToHub } from "../link/machine";
import {
  HUB_PEER,
  type TakenResult,
  type TakenSession,
} from "../link/protocol";
import type { MachineRow } from "../link/store";
import { readRecord } from "./hub-send";
import { pauseTaken, sweep } from "./machine";
import { hubNameHere } from "./peer";
import { onTakenAck, takenFor } from "./taken";
import { onMachineBack } from "./takes";
import { BACKUP_SESSION_ID } from "./types";

// --- On the machine ---

/** Tells the hub which of its sessions carry on here; it pauses its own */
export async function tellHubTaken(): Promise<void> {
  if (!hubUp().linked) return;
  const list = takenFor({ id: HUB_PEER }, getDb());
  if (list.length === 0) return;
  const body = Buffer.from(JSON.stringify({ list }));
  const answer = await uploadToHub({
    method: "POST",
    path: "/api/link/inbox/peer/taken",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
    },
    body,
  });
  if (answer.status !== 200) {
    console.error(`[take] the server didn't take the list (${answer.status})`);
    return;
  }
  let results: TakenResult[] = [];
  try {
    const said = JSON.parse(answer.body.toString("utf8")) as {
      results?: TakenResult[];
    };
    results = Array.isArray(said.results) ? said.results : [];
  } catch {
    return;
  }
  onTakenAck({ id: HUB_PEER, name: hubNameHere() }, results);
  // The server has paused its own: what carries on here is copied to it
  if (results.some((r) => r.state === "paused" || r.state === "already")) {
    void sweep().catch(() => {});
  }
}

/** The link is up again */
export function onHubBack(): void {
  // A copy being continued right now gives way to the hub's own session
  onMachineBack({ id: HUB_PEER });
  setTimeout(() => {
    tellHubTaken().catch((error) =>
      console.error("[take] telling the server:", error)
    );
  }, 500).unref();
}

// --- On the hub ---

/**
 * POST /api/link/inbox/peer/taken: only sessions this server shared with
 * that machine are paused; anything else is "gone" to it
 */
export async function pauseForMachine(
  machine: Pick<MachineRow, "id" | "name">,
  body: unknown
): Promise<TakenResult[]> {
  const list = (body as { list?: unknown })?.list;
  if (!Array.isArray(list) || list.length > 2000) return [];
  const shared = readRecord(machine.id).sessions;
  const mine: TakenSession[] = [];
  const results: TakenResult[] = [];
  for (const entry of list as TakenSession[]) {
    if (
      !entry ||
      typeof entry.sessionId !== "string" ||
      !BACKUP_SESSION_ID.test(entry.sessionId) ||
      typeof entry.takeId !== "string"
    ) {
      continue;
    }
    if (shared[entry.sessionId]) {
      // The name is this server's own word, never the machine's
      mine.push({ ...entry, hubName: machine.name });
    } else {
      results.push({
        sessionId: entry.sessionId,
        takeId: entry.takeId,
        state: "gone",
      });
    }
  }
  return [
    ...results,
    ...(await pauseTaken(mine, undefined, { id: machine.id })),
  ];
}
