/**
 * The guard and answers of the job routes on the machine that runs jobs
 * (app/api/link/inbox/job/*): only its hub's AgentOS, through the link.
 * Server only.
 */

import { NextResponse } from "next/server";
import { HUB_PEER } from "../link/protocol";
import { requireLinkMachine } from "../link/up-guard";
import { JobRefused } from "./runner";
import { JOB_ID } from "./types";

const noStore = { "Cache-Control": "no-store" };

/** Null when the call is the hub's own; else the answer to give */
export function notFromHub(request: Request): Response | null {
  const link = requireLinkMachine(request);
  if (!link.ok) return link.response;
  return link.machine.id === HUB_PEER
    ? null
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export const jobJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: noStore });

export function jobId(id: string): string | null {
  return JOB_ID.test(id) ? id : null;
}

export function jobFailed(error: unknown, what: string): Response {
  if (error instanceof JobRefused) {
    return jobJson({ error: error.message }, error.status);
  }
  console.error(`[jobs] ${what}:`, error);
  return jobJson({ error: "It didn't work on this machine." }, 500);
}
