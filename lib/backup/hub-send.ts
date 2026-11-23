/**
 * This server keeping copies of its own Claude sessions on a linked
 * machine: the mirror of lib/backup/machine.ts, so either side can carry
 * on when the other is off. Server only; started from lib/tickers.ts on
 * the hub.
 *
 * Only what the user shares with that machine goes (lib/backup/share.ts),
 * only to a machine that is online and can take copies (CAP_PEER), and
 * through the same inbox routes a machine uses here: this server calls
 * them down the link with its own proof (lib/link/own-proof.ts). One
 * session at a time, after each reply and every 5 minutes.
 */

import fs from "fs";
import http from "http";
import path from "path";
import { readClaudeState } from "../claude-state";
import { getDb, queries, type Project, type Session } from "../db";
import type { UpAnswer, UpInit } from "../link/client";
import { OWN_PROOF_HEADER, ownProof } from "../link/own-proof";
import { CAP_PEER } from "../link/protocol";
import { home } from "../link/secrets";
import { linkHub, machinesOn } from "../link/server";
import {
  listMachines,
  machineById,
  machineCaps,
  serverName,
  type MachineRow,
} from "../link/store";
import { serverNameOr } from "../server-name";
import { onEdge, wantWatch } from "../session-watch";
import { locateTranscript } from "../transcript-locate";
import {
  backupOne,
  eligible,
  liveDeps,
  pauseTaken,
  readBackupState,
  signature,
  writeBackupState,
  type BackupState,
  type CopyStatus,
  type RunOutcome,
} from "./machine";
import { parseMovedTo } from "../session-move-types";
import { inShare, shareOf } from "./share";
import type { SyncRow, SyncState, SyncView } from "./share-types";
import { backupRows } from "./store";

const SWEEP_MS = 5 * 60_000;
const SETTLE_MS = 5000;
const AGAIN_MS = 20_000;

const shared = globalThis as typeof globalThis & {
  __agentosHubSend?: {
    /** "<machine>|<session>" waiting to be copied */
    dirty: Set<string>;
    lastRun: Map<string, number>;
    working: boolean;
    started: boolean;
    lastSweep: number | null;
  };
};
const state = () =>
  (shared.__agentosHubSend ??= {
    dirty: new Set(),
    lastRun: new Map(),
    working: false,
    started: false,
    lastSweep: null,
  });

const recordFile = (machineId: string) =>
  path.join(home(), "peer-state", `${machineId}.json`);

export const readRecord = (machineId: string) =>
  readBackupState(machineId, recordFile(machineId));

const writeRecord = (machineId: string, record: BackupState) =>
  writeBackupState(record, recordFile(machineId));

const getSession = (id: string) =>
  (queries.getSession(getDb()).get(id) as Session | undefined) ?? null;

/** A machine that can be sent copies right now */
function ready(machine: MachineRow): boolean {
  return (
    machine.status === "approved" &&
    machineCaps(machine).includes(CAP_PEER) &&
    linkHub().presence(machine.id) === "online"
  );
}

/** The machines the user shares something with */
function sharing(): MachineRow[] {
  if (!machinesOn()) return [];
  return listMachines().filter(
    (m) => m.status === "approved" && shareOf(m).level !== "none"
  );
}

/** This server's sessions that machine gets a copy of */
export function sharedSessions(machine: MachineRow): Session[] {
  const share = shareOf(machine);
  if (share.level === "none") return [];
  return (queries.getAllSessions(getDb()).all() as Session[]).filter(
    (s) => eligible(s) && inShare(s, share)
  );
}

/** A call to a machine's inbox, with what it answered when it refused */
function uploader(machineId: string) {
  const port = Number(process.env.PORT || "3011");
  const seen: { error: string | null } = { error: null };
  const upload = (init: UpInit) =>
    new Promise<UpAnswer>((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port,
          method: init.method,
          // Built here alone: the id is one of this server's own rows
          path: `/m/${machineId}${init.path}`,
          headers: { ...init.headers, [OWN_PROOF_HEADER]: ownProof() },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("error", reject);
          res.on("end", () => {
            const body = Buffer.concat(chunks);
            const status = res.statusCode ?? 502;
            if (status !== 200) {
              try {
                const said = JSON.parse(body.toString("utf8")) as {
                  error?: unknown;
                };
                seen.error =
                  typeof said.error === "string"
                    ? said.error.slice(0, 200)
                    : null;
              } catch {
                seen.error = null;
              }
            }
            resolve({ status, headers: res.headers, body });
          });
        }
      );
      request.on("error", reject);
      if (init.body && !Buffer.isBuffer(init.body)) {
        init.body.on("error", (error) => request.destroy(error));
        init.body.pipe(request);
      } else {
        request.end(init.body ?? undefined);
      }
    });
  return { upload, seen };
}

/** Lines in a file between two offsets */
async function countLines(file: string, from: number, to: number) {
  if (to <= from) return 0;
  let lines = 0;
  for await (const chunk of fs.createReadStream(file, {
    start: from,
    end: to - 1,
  })) {
    const buffer = chunk as Buffer;
    for (let i = 0; i < buffer.length; i++) if (buffer[i] === 10) lines++;
  }
  return lines;
}

const FAILED =
  "The copy didn't go through. It is tried again at the next check.";

/** Copies one session to one machine, and notes how it went */
async function sendOne(machine: MachineRow, session: Session): Promise<void> {
  const record = readRecord(machine.id);
  const before = record.sessions[session.id];
  const was = record.status?.[session.id];
  const { upload, seen } = uploader(machine.id);
  let outcome: RunOutcome = "failed";
  let error: string | undefined;
  try {
    outcome = await backupOne(session, record, {
      ...liveDeps(),
      upload,
      // The machine carries this session on from its copy: ours pauses
      // (only this one, and under this server's own name for the machine)
      pause: (list) =>
        pauseTaken(
          list
            .filter((t) => t?.sessionId === session.id)
            .map((t) => ({ ...t, hubName: machine.name })),
          undefined,
          { id: machine.id }
        ),
    });
    if (outcome === "failed") error = seen.error ?? FAILED;
    if (outcome === "off") error = `${machine.name} isn't taking copies.`;
  } catch (failure) {
    console.error(`[share] copying to ${machine.name}:`, failure);
    error = "This server couldn't read the session to copy it.";
  }
  const now = Date.now();
  const same = outcome === "copied" || outcome === "unchanged";
  const after = record.sessions[session.id];
  const status: CopyStatus = {
    at: same ? now : (was?.at ?? null),
    tried: now,
    outcome,
    ...(error ? { error } : {}),
    entries: was?.entries,
    unsaved: was?.unsaved,
  };
  if (same && after) {
    try {
      status.unsaved = (
        JSON.parse(after.sig) as [number, unknown, string[]]
      )[2].length;
    } catch {
      status.unsaved = 0;
    }
    const located = await locateTranscript(session).catch(() => null);
    if (located?.file) {
      // Counted from where the last copy ended, unless it started over
      const grown =
        before &&
        before.claudeSessionId === after.claudeSessionId &&
        before.bytes >= 0 &&
        before.bytes <= after.bytes &&
        was?.entries != null;
      status.entries = grown
        ? was.entries! +
          (await countLines(located.file, before.bytes, after.bytes))
        : await countLines(located.file, 0, after.bytes);
    }
  }
  (record.status ??= {})[session.id] = status;
  writeRecord(machine.id, record);
}

/** Copies what is marked, one session at a time across all machines */
async function work(): Promise<void> {
  const s = state();
  if (s.working) return;
  s.working = true;
  try {
    for (;;) {
      const now = Date.now();
      const key = [...s.dirty].find(
        (k) => now - (s.lastRun.get(k) ?? 0) >= AGAIN_MS
      );
      if (!key) {
        if (s.dirty.size > 0) setTimeout(() => void work(), AGAIN_MS).unref();
        return;
      }
      s.dirty.delete(key);
      s.lastRun.set(key, now);
      const [machineId, sessionId] = key.split("|");
      const machine = machineById(machineId);
      const session = getSession(sessionId);
      if (!machine || !session || !ready(machine)) continue;
      if (!eligible(session) || !inShare(session, shareOf(machine))) continue;
      await sendOne(machine, session);
    }
  } finally {
    s.working = false;
  }
}

function mark(machineId: string, sessionId: string): void {
  state().dirty.add(`${machineId}|${sessionId}`);
  void work();
}

/**
 * One machine: it drops the copies of sessions no longer shared with it,
 * and whatever changed since its last copy is marked
 */
export async function sweepMachine(machine: MachineRow): Promise<void> {
  if (!ready(machine)) return;
  const sessions = sharedSessions(machine);
  const record = readRecord(machine.id);
  const held = Object.keys(record.sessions).length > 0;
  if (sessions.length === 0 && !held) return;
  const { upload } = uploader(machine.id);
  const body = Buffer.from(
    JSON.stringify({ ids: sessions.map((s) => s.id).slice(0, 2000) })
  );
  const told = await upload({
    method: "POST",
    path: "/api/link/inbox/backup/sessions",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
    },
    body,
  }).catch(() => null);
  if (told?.status !== 200) {
    console.error(
      `[share] ${machine.name} didn't take the list of shared sessions (${told?.status ?? "no answer"})`
    );
    return;
  }
  const keep = new Set(sessions.map((s) => s.id));
  let dropped = false;
  for (const id of Object.keys(record.sessions)) {
    if (keep.has(id)) continue;
    delete record.sessions[id];
    delete record.status?.[id];
    dropped = true;
  }
  if (dropped) writeRecord(machine.id, record);
  for (const session of sessions) {
    const located = await locateTranscript(session).catch(() => null);
    if (!located?.file) continue;
    const sig = await signature(session, located.file).catch(() => "");
    const known = record.sessions[session.id];
    if (known?.sig !== sig || record.status?.[session.id]?.outcome === "failed")
      state().dirty.add(`${machine.id}|${session.id}`);
  }
  void work();
}

/** Every machine, including one whose sharing was just turned off */
export async function sweepAll(): Promise<void> {
  if (!machinesOn()) return;
  state().lastSweep = Date.now();
  for (const machine of listMachines()) {
    if (machine.status !== "approved") continue;
    await sweepMachine(machine).catch((error) =>
      console.error(`[share] checking ${machine.name}:`, error)
    );
  }
}

/** lib/tickers.ts, on the hub */
export function startHubSend(): void {
  const s = state();
  if (s.started) return;
  s.started = true;
  wantWatch(() => sharing().length > 0);
  onEdge((edge) => {
    if (
      edge.from !== "running" ||
      edge.to === "running" ||
      edge.to === "gone"
    ) {
      return;
    }
    const hooks = readClaudeState(edge.sessionId);
    if (hooks.busy !== false || hooks.pendingPermission) return;
    const session = getSession(edge.sessionId);
    if (!session) return;
    for (const machine of sharing()) {
      if (!inShare(session, shareOf(machine))) continue;
      setTimeout(() => mark(machine.id, edge.sessionId), SETTLE_MS).unref();
    }
  });
  setInterval(() => void sweepAll(), SWEEP_MS).unref();
  setTimeout(() => void sweepAll(), 30_000).unref();
}

// --- What the pages show ---

const projectNames = () => {
  const names = new Map<string, string>();
  for (const p of queries.getAllProjects(getDb()).all() as Project[]) {
    if (!p.is_uncategorized) names.set(p.id, p.name);
  }
  return names;
};

/** How every copy between this server and a machine stands */
export function syncView(machine: MachineRow): SyncView {
  const s = state();
  const online = linkHub().presence(machine.id) === "online";
  const record = readRecord(machine.id);
  const names = projectNames();
  const rows: SyncRow[] = sharedSessions(machine).map((session) => {
    const status = record.status?.[session.id];
    const copy = record.sessions[session.id];
    const waiting =
      !status ||
      s.dirty.has(`${machine.id}|${session.id}`) ||
      !["copied", "unchanged", "failed", "off"].includes(status.outcome);
    const sync: SyncState =
      status?.outcome === "failed" || status?.outcome === "off"
        ? "failed"
        : waiting
          ? "waiting"
          : "synced";
    return {
      sessionId: session.id,
      name: session.name,
      projectName:
        (session.project_id && names.get(session.project_id)) || null,
      direction: "to",
      state: sync,
      syncedAt: status?.at ?? null,
      head: copy?.head ?? null,
      unsaved: status?.unsaved ?? null,
      entries: status?.entries ?? null,
      ...(sync === "failed" && status?.error ? { error: status.error } : {}),
    };
  });
  // Sessions the machine carried on from its copy while this server was
  // off: paused here, and said to be there
  for (const session of queries.getAllSessions(getDb()).all() as Session[]) {
    const went = session.settled_at ? parseMovedTo(session.moved_to) : null;
    if (went?.machine !== machine.id || !went.takeover) continue;
    rows.push({
      sessionId: session.id,
      name: session.name,
      projectName:
        (session.project_id && names.get(session.project_id)) || null,
      direction: "to",
      state: "elsewhere",
      syncedAt: went.takeover.copyAt || null,
      head: went.head || null,
      unsaved: null,
      entries: null,
    });
  }
  for (const row of backupRows(machine.id)) {
    rows.push({
      sessionId: row.session_id,
      name: row.name,
      projectName: row.project_name,
      direction: "from",
      state: row.state === "current" ? "synced" : "elsewhere",
      syncedAt: row.copied_at,
      head: row.head,
      unsaved: row.snapshot_commit ? 1 : 0,
      entries: null,
    });
  }
  const counts = new Map<string, number>();
  for (const session of queries.getAllSessions(getDb()).all() as Session[]) {
    if (!eligible(session) || !session.project_id) continue;
    counts.set(session.project_id, (counts.get(session.project_id) ?? 0) + 1);
  }
  return {
    machineName: machine.name,
    hubName: serverNameOr(serverName(), "This server"),
    online,
    supported: machineCaps(machine).includes(CAP_PEER),
    share: shareOf(machine),
    backup: machine.backup === 1,
    projects: [...names].map(([id, name]) => ({
      id,
      name,
      sessions: counts.get(id) ?? 0,
    })),
    rows,
    lastCheckAt: s.lastSweep,
    nextCheckAt: s.started && s.lastSweep ? s.lastSweep + SWEEP_MS : null,
    working: s.working,
  };
}
