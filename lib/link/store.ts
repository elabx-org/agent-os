/**
 * Linked machines on the hub: the rows behind Settings -> Machines.
 * Live connections are in lib/link/hub.ts; this is only what's on disk.
 */

import { randomBytes } from "crypto";
import { getDb, queries } from "../db";
import {
  SERVER_NAME_PREFERENCE_KEY,
  normalizeServerName,
} from "../server-name";

export type MachineStatus = "pending" | "approved";

export interface MachineRow {
  id: string;
  name: string;
  public_key: string;
  status: MachineStatus;
  platform: string | null;
  sha: string | null;
  signed_in_as: string | null;
  created_at: number;
  approved_at: number | null;
  last_seen: number | null;
  /** 1: sessions on this server may use it through AgentOS's tools */
  agents: number;
  /** 1: its sessions may use this server (lib/link/up.ts) */
  uses_hub: number;
  /** 1: it may keep copies of its sessions on this server */
  backup: number;
  /** JSON string[]: what it said it can do in its last hello */
  caps: string | null;
}

const clean = (value: string, max: number) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);

export function listMachines(): MachineRow[] {
  return getDb()
    .prepare(`SELECT * FROM machines ORDER BY created_at`)
    .all() as MachineRow[];
}

export function machineById(id: string): MachineRow | null {
  return (
    (getDb().prepare(`SELECT * FROM machines WHERE id = ?`).get(id) as
      | MachineRow
      | undefined) ?? null
  );
}

export function machineByKey(publicKey: string): MachineRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM machines WHERE public_key = ?`)
      .get(publicKey) as MachineRow | undefined) ?? null
  );
}

export function createPendingMachine(input: {
  name: string;
  publicKey: string;
  platform: string;
  sha: string | null;
  signedInAs: string | null;
}): MachineRow {
  const id = `m_${randomBytes(6).toString("hex")}`;
  getDb()
    .prepare(
      `INSERT INTO machines (id, name, public_key, status, platform, sha, signed_in_as, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
    .run(
      id,
      clean(input.name, 60) || "Machine",
      input.publicKey,
      clean(input.platform, 40),
      input.sha ? clean(input.sha, 64) : null,
      input.signedInAs ? clean(input.signedInAs, 120) : null,
      Date.now()
    );
  return machineById(id)!;
}

export function approveMachine(id: string): MachineRow | null {
  getDb()
    .prepare(
      `UPDATE machines SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'`
    )
    .run(Date.now(), id);
  return machineById(id);
}

export function renameMachine(id: string, name: string): MachineRow | null {
  const value = clean(name, 60);
  if (value) {
    getDb().prepare(`UPDATE machines SET name = ? WHERE id = ?`).run(value, id);
  }
  return machineById(id);
}

/** Whether sessions on this server may use the machine */
export function setMachineAgents(id: string, allowed: boolean): void {
  getDb()
    .prepare(`UPDATE machines SET agents = ? WHERE id = ?`)
    .run(allowed ? 1 : 0, id);
}

/** Whether the machine's sessions may use this server */
export function setMachineUsesHub(id: string, on: boolean): void {
  getDb()
    .prepare(`UPDATE machines SET uses_hub = ? WHERE id = ?`)
    .run(on ? 1 : 0, id);
}

/** Whether the machine may keep copies of its sessions on this server */
export function setMachineBackup(id: string, on: boolean): void {
  getDb()
    .prepare(`UPDATE machines SET backup = ? WHERE id = ?`)
    .run(on ? 1 : 0, id);
}

/** What the machine said it can do when it last connected */
export function setMachineCaps(id: string, caps: string[]): void {
  getDb()
    .prepare(`UPDATE machines SET caps = ? WHERE id = ?`)
    .run(JSON.stringify(caps), id);
}

/** The stored caps; empty when none or unreadable */
export function machineCaps(row: Pick<MachineRow, "caps">): string[] {
  try {
    const value: unknown = JSON.parse(row.caps ?? "[]");
    return Array.isArray(value)
      ? value.filter((c): c is string => typeof c === "string")
      : [];
  } catch {
    return [];
  }
}

export function removeMachine(id: string): boolean {
  return (
    getDb().prepare(`DELETE FROM machines WHERE id = ?`).run(id).changes > 0
  );
}

export function touchMachine(
  id: string,
  seen: { platform: string; sha: string | null; signedInAs: string | null }
): void {
  getDb()
    .prepare(
      `UPDATE machines SET last_seen = ?, platform = ?, sha = ?, signed_in_as = COALESCE(?, signed_in_as) WHERE id = ?`
    )
    .run(
      Date.now(),
      clean(seen.platform, 40),
      seen.sha ? clean(seen.sha, 64) : null,
      seen.signedInAs ? clean(seen.signedInAs, 120) : null,
      id
    );
}

/** The name the user gave this server, null when they gave none */
export function serverName(): string | null {
  try {
    const row = queries
      .getPreference(getDb())
      .get(SERVER_NAME_PREFERENCE_KEY) as { value: string } | undefined;
    return normalizeServerName(row ? JSON.parse(row.value) : null);
  } catch {
    return null;
  }
}
