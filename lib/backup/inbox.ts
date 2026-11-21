/**
 * The guard and answers shared by the copy routes on the hub
 * (app/api/link/inbox/backup/*, …/taken/*): only AgentOS on a linked
 * machine, through the link, while the user keeps its copies here.
 */

import { NextResponse } from "next/server";
import { machinesOn } from "../link/server";
import type { MachineRow } from "../link/store";
import { requireLinkMachine } from "../link/up-guard";
import { BACKUP_ERRORS, BackupError } from "./receive";
import { BACKUP_LIMITS } from "./store";

const noStore = { "Cache-Control": "no-store" };

export function backupMachine(
  request: Request
): { ok: true; machine: MachineRow } | { ok: false; response: Response } {
  if (!machinesOn()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  const link = requireLinkMachine(request);
  if (!link.ok) return link;
  if (link.machine.backup !== 1) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: BACKUP_ERRORS.backup_off, code: "backup_off" },
        { status: 403, headers: noStore }
      ),
    };
  }
  return link;
}

/** A JSON body of at most 1 MiB, or null */
export async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text().catch(() => "");
  if (text.length > BACKUP_LIMITS.json) throw new BackupError("too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new BackupError("bad_request");
  }
}

/** A refusal as its answer; anything else is the server's own failure */
export function backupFailed(error: unknown, what: string): Response {
  if (error instanceof BackupError) {
    return NextResponse.json(error.body(), {
      status: error.status,
      headers: noStore,
    });
  }
  console.error(`[backup] ${what}:`, error);
  return NextResponse.json(
    { error: "The server couldn't keep the copy" },
    { status: 500, headers: noStore }
  );
}

export const backupJson = (body: unknown) =>
  NextResponse.json(body, { headers: noStore });
