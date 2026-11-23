/**
 * Which of this server's sessions a linked machine gets copies of: the
 * user's choice per machine, kept on its row (machines.share). Off until
 * the user turns it on. Shapes are shared with the pages; the reads and
 * writes are server only.
 */

import { getDb, type Session } from "../db";
import type { MachineRow } from "../link/store";
import { SHARE_LEVELS, type MachineShare } from "./share-types";

export const NO_SHARE: MachineShare = { level: "none", projects: [] };

const PROJECT_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** What was stored, or nothing shared when it can't be read */
export function parseShare(value: string | null | undefined): MachineShare {
  if (!value) return NO_SHARE;
  try {
    return cleanShare(JSON.parse(value)) ?? NO_SHARE;
  } catch {
    return NO_SHARE;
  }
}

/** A share as the user sent it, or null when it isn't one */
export function cleanShare(value: unknown): MachineShare | null {
  const v = value as { level?: unknown; projects?: unknown } | null;
  if (!v || typeof v !== "object") return null;
  if (!SHARE_LEVELS.includes(v.level as MachineShare["level"])) return null;
  const projects = Array.isArray(v.projects) ? v.projects : [];
  if (
    projects.length > 500 ||
    !projects.every((p) => typeof p === "string" && PROJECT_ID.test(p))
  ) {
    return null;
  }
  return {
    level: v.level as MachineShare["level"],
    projects: [...new Set(projects as string[])],
  };
}

export const shareOf = (machine: Pick<MachineRow, "share">): MachineShare =>
  parseShare(machine.share);

export function setMachineShare(id: string, share: MachineShare): void {
  getDb()
    .prepare(`UPDATE machines SET share = ? WHERE id = ?`)
    .run(JSON.stringify(share), id);
}

/** Whether a session is one the machine gets a copy of */
export function inShare(
  session: Pick<Session, "project_id">,
  share: MachineShare
): boolean {
  if (share.level === "all") return true;
  if (share.level === "none") return false;
  return !!session.project_id && share.projects.includes(session.project_id);
}

/**
 * A machine's share with one more project in it: null when nothing would
 * change (it already gets every project, or this one)
 */
export function shareWithProject(
  share: MachineShare,
  projectId: string
): MachineShare | null {
  if (share.level === "all" || share.projects.includes(projectId)) return null;
  return cleanShare({
    level: "some",
    projects: [...share.projects, projectId],
  });
}

/** Adds one project to what a machine gets; true when that changed it */
export function addShareProject(
  machine: Pick<MachineRow, "id" | "share">,
  projectId: string
): boolean {
  const next = shareWithProject(shareOf(machine), projectId);
  if (!next) return false;
  setMachineShare(machine.id, next);
  return true;
}
