/**
 * What a machine's AgentOS itself may send up for copies of its sessions
 * (lib/backup): the "system" kind, only to /api/link/inbox/*, only while
 * the user's "Keep a copy of its sessions on this server" is on. The
 * routes check the per-boot proof and learn the machine from the tunnel.
 */

import type { UpRule } from "./up";

/** BACKUP_SESSION_ID without its anchors */
const SID = "[A-Za-z0-9][A-Za-z0-9_-]{0,79}";
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
/** A large upload's answer comes once all of it is in and checked */
const LONG_MS = 45 * 60_000;
const SHORT_MS = 120_000;

const backup = (rest: string) =>
  new RegExp(`^\\/api\\/link\\/inbox\\/backup\\/${rest}$`);

export const BACKUP_UP_RULES: UpRule[] = [
  {
    kind: "system",
    method: "POST",
    path: backup("sessions"),
    relay: false,
    maxBody: MiB,
    headMs: SHORT_MS,
  },
  {
    kind: "system",
    method: "POST",
    path: backup(`${SID}\\/begin`),
    relay: false,
    maxBody: MiB,
    headMs: SHORT_MS,
  },
  {
    kind: "system",
    method: "PUT",
    path: backup(`${SID}\\/bundle`),
    relay: false,
    query: ["backup"],
    maxBody: 2 * GiB,
    headMs: LONG_MS,
  },
  {
    kind: "system",
    method: "PUT",
    path: backup(`${SID}\\/file`),
    relay: false,
    query: ["backup", "offset", "reset"],
    maxBody: 2 * GiB,
    headMs: LONG_MS,
  },
  {
    kind: "system",
    method: "POST",
    path: backup(`${SID}\\/commit`),
    relay: false,
    maxBody: MiB,
    headMs: SHORT_MS,
  },
  {
    kind: "system",
    method: "GET",
    path: new RegExp(`^\\/api\\/link\\/inbox\\/taken\\/${SID}$`),
    relay: false,
    maxBody: 0,
    headMs: SHORT_MS,
  },
  {
    kind: "system",
    method: "POST",
    path: /^\/api\/link\/inbox\/peer\/taken$/,
    relay: false,
    maxBody: MiB,
    headMs: LONG_MS,
  },
];
