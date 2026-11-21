/**
 * Copies of a linked machine's sessions kept on the hub, and continuing
 * one there while the machine is offline. Shapes shared by the machine
 * (lib/backup/machine.ts), the hub (lib/backup/receive.ts, takeover.ts)
 * and the pages. No server imports.
 */

import {
  ageText,
  type MoveInResult,
  type MoveManifest,
} from "../session-move-types";
import type { MoveSnapshot } from "../worktree-move-git";

/** A session id a copy may be kept under: never read as an option or a path */
export const BACKUP_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
/** A copy upload's id, and a take-over's */
export const BACKUP_ID = /^[0-9a-f]{16}$/;

/** What the machine says about the session when it commits a copy */
export interface BackupManifest extends Omit<
  MoveManifest,
  "moveId" | "repo" | "snapshot" | "sourceTrusted"
> {
  /** null: not a git folder, or no commits yet */
  repo: MoveManifest["repo"] | null;
  /** Uncommitted work, under refs/agent-os/<sid>/backup */
  snapshot: MoveSnapshot | null;
  projectName: string | null;
  lastActiveAt: number;
  transcriptBytes: number;
}

/** POST …/backup/[session]/begin */
export interface BackupBegin {
  v: 1;
  claudeSessionId: string;
  repo: { name: string; remote: string | null; first: string } | null;
  transcriptBytes: number;
}

/** The hub's answer to begin: what its copy holds now */
export interface BackupPlan {
  /** 16 hex; later calls with an older one are stale */
  backupId: string;
  /** Conversation bytes the hub holds */
  offset: number;
  /** sha256 of the hub's last min(offset, 65536) bytes */
  tail: string;
  head: string | null;
  snapshot: string | null;
  /** Commits in the hub's copy (at most 400) */
  have: string[];
}

export type BackupRefusal =
  | "backup_off"
  | "taking"
  | "taken"
  | "full"
  | "too_large"
  | "mismatch"
  | "missing_code"
  | "stale";

/** One copy, as Settings and the copies sheet show it */
export interface BackupView {
  sessionId: string;
  name: string;
  projectName: string | null;
  copiedAt: number;
  lastActiveAt: number;
  state: "current" | "taking" | "taken";
  canContinue: boolean;
  /** Why it can't be continued here, in the user's words */
  whyNot?: string;
  hasSettings: boolean;
  /** Taken, and the machine hasn't confirmed it paused its own */
  unconfirmed: boolean;
}

export type TakeStep =
  | "preparing"
  | "code"
  | "conversation"
  | "starting"
  | "done"
  | "failed";

/** GET /api/machines/[id]/backups/[session]/take?job= */
export interface TakeJob {
  id: string;
  sessionId: string;
  machineId: string;
  machineName: string;
  hubName: string;
  copyAt: number;
  step: TakeStep;
  error?: string;
  result?: MoveInResult;
}

/** "5 minutes": how old a copy is */
export const copyAge = (ms: number): string => ageText(ms);

/** What the user reads at each step of a take-over */
export function takeStepText(step: TakeStep, hubName: string): string {
  switch (step) {
    case "preparing":
      return "Getting the copy ready";
    case "code":
      return "Putting the code in place";
    case "conversation":
      return "Putting the conversation in place";
    case "starting":
      return `Starting it on ${hubName}`;
    case "done":
      return `Now on ${hubName}`;
    case "failed":
      return "It didn't start here. The copy is untouched.";
  }
}

/** Why a copy can't be continued here (3.9's sentences) */
export const TAKE_WHY_NOT = {
  notGit:
    "Its folder isn't a git repository, so only the conversation was copied.",
  online: (name: string) => `${name} is online. Open it there to carry on.`,
  justLeft: (name: string) =>
    `${name} only just dropped off. Give it a minute in case it comes back.`,
  tooOld: (name: string) =>
    `${name} needs to update before its sessions can be continued here.`,
  alreadyHere: "This session is already on this server.",
  movedNoAnswer:
    "A move of this session ended without an answer. Open it on this server and resume it there.",
  tooLarge: "Its code is too large to put in place here.",
  cameBack: (name: string) =>
    `${name} came back online. Open the session there.`,
  taking: "It's already being continued here.",
  noCopy: "No copy of that session.",
  settings:
    "This copy has Claude settings that can run commands by themselves. Tick I understand to continue.",
};

/** "1.2 GB": what copies take on the hub */
export function sizeText(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "3 sessions copied" */
export const copiedWord = (n: number) =>
  n === 1 ? "1 session copied" : `${n} sessions copied`;
