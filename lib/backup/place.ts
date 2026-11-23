/**
 * Where a session's copy is and how fresh, for the line in the chat and
 * the row on the project page. Asked of the hub, which knows both ways:
 * its own sessions' copies on machines (hub-send.ts) and the copies it
 * keeps of a machine's sessions (store.ts). Server only.
 */

import { CAP_PEER } from "../link/protocol";
import {
  listMachines,
  machineById,
  machineCaps,
  serverName,
} from "../link/store";
import { serverNameOr } from "../server-name";
import { syncView } from "./hub-send";
import { addShareProject, shareOf } from "./share";
import type { Place, PlaceView } from "./share-types";
import { backupRows } from "./store";

/** Sessions that live on this server: their copies on linked machines */
function onHub(ids: Set<string>): PlaceView {
  const places: PlaceView["places"] = {};
  for (const machine of listMachines()) {
    if (machine.status !== "approved") continue;
    if (shareOf(machine).level === "none") continue;
    for (const row of syncView(machine).rows) {
      if (row.direction !== "to" || !ids.has(row.sessionId)) continue;
      (places[row.sessionId] ??= []).push({
        machineId: machine.id,
        name: machine.name,
        kind: "mac",
        state: row.state,
        syncedAt: row.syncedAt,
        entries: row.entries,
        head: row.head,
        unsaved: row.unsaved,
      });
    }
  }
  return { here: serverNameOr(serverName()), places };
}

/** Sessions that live on a machine: the copy this server keeps */
function onMachine(machineId: string, ids: Set<string>): PlaceView {
  const machine = machineById(machineId);
  const places: PlaceView["places"] = {};
  if (!machine) return { here: "that machine", places };
  const hub = serverNameOr(serverName());
  for (const row of backupRows(machineId)) {
    if (!ids.has(row.session_id) || row.orphan === 1) continue;
    (places[row.session_id] ??= []).push({
      machineId: "hub",
      name: hub,
      kind: "server",
      state: row.state === "current" ? "synced" : "elsewhere",
      syncedAt: row.copied_at,
      entries: null,
      head: row.head,
      unsaved: row.snapshot_commit ? 1 : 0,
    });
  }
  return { here: machine.name, places };
}

/** GET /api/machines/place */
export function placeView(on: string | null, ids: string[]): PlaceView {
  const set = new Set(ids);
  return on ? onMachine(on, set) : onHub(set);
}

/**
 * A project the user sent to a machine is shared with it from then on:
 * its chats that stay here are copied there too. Nothing when the machine
 * can't take copies or already gets every project
 */
export function shareSentProject(machineId: string, projectId: string): void {
  const machine = machineById(machineId);
  if (!machine || machine.status !== "approved") return;
  if (!machineCaps(machine).includes(CAP_PEER)) return;
  addShareProject(machine, projectId);
}
