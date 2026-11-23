/**
 * The other side of a copy, whichever side this is. On the hub a peer is
 * a linked machine; on a machine the only peer is its hub, under the id
 * "hub" (lib/link/up-guard.ts). Server only.
 */

import { hubMemo, hubOfflineFor, hubUp, isMachineMode } from "../link/machine";
import { CAP_TAKE, HUB_PEER } from "../link/protocol";
import { linkHub } from "../link/server";
import { machineById, serverName, type MachineRow } from "../link/store";
import { hubPeerRow } from "../link/up-guard";
import { serverNameOr } from "../server-name";

/** The hub's name as this machine last heard it */
export const hubNameHere = () =>
  hubUp().hubName || hubMemo().hubName || "the server";

export function peerRow(id: string): MachineRow | null {
  if (!isMachineMode()) return machineById(id);
  if (id !== HUB_PEER) return null;
  return {
    ...hubPeerRow(),
    name: hubNameHere(),
    caps: JSON.stringify([CAP_TAKE]),
  };
}

export const peerOnline = (id: string): boolean =>
  isMachineMode()
    ? id === HUB_PEER && hubUp().linked
    : linkHub().presence(id) === "online";

export const peerOfflineFor = (id: string): number =>
  isMachineMode() ? hubOfflineFor() : linkHub().offlineFor(id);

/** This side, as a move names it */
export function here(): { machine: string; name: string } {
  if (!isMachineMode()) {
    return { machine: HUB_PEER, name: serverNameOr(serverName()) };
  }
  const memo = hubMemo();
  return {
    machine: hubUp().machineId || memo.machineId || "m_000000000000",
    name: hubUp().name || memo.name || "this machine",
  };
}

/** A session was continued here: its other side must pause its own */
export function tellPeerTaken(id: string): void {
  if (!isMachineMode()) {
    linkHub().tellTaken(id);
    return;
  }
  void import("./peer-taken")
    .then((m) => m.tellHubTaken())
    .catch((error) => console.error("[take] telling the server:", error));
}
