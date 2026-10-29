/**
 * The routes that can hand a session full access (create, fork, summarize,
 * launch, restart, the mode route) decide here who asked: the user, with
 * proof (lib/user-proof.ts); an agent that says so, which gets at most
 * capForAgent; or a request that is neither, refused as the user's own.
 */

import { NextResponse } from "next/server";
import type { Session } from "@/lib/db";
import {
  forgetRetried,
  hasAgentMarkers,
  recordAgentAction,
  agentActor,
  recordRefusal,
  type AgentActionKind,
} from "@/lib/agent-actions";
import { requireUser, type UserProofFailure } from "@/lib/user-proof";
import type { UserOnlyError } from "@/lib/permission-mode";
import { recordNotification, setDelivered } from "@/lib/push/history";
import { sendPush } from "@/lib/push/send";

export type Requester =
  | { by: "user" }
  | { by: "agent"; reason: UserProofFailure }
  | { by: null; reason: UserProofFailure };

/**
 * "agent" only when the request says so; without the markers and without
 * proof it could be an agent that left them off, or the user's tab with a
 * stale cookie (which retries through fetchAsUser on reason "no_proof")
 */
export function requester(request: Request): Requester {
  const proof = requireUser(request);
  if (proof.ok) return { by: "user" };
  return hasAgentMarkers(request)
    ? { by: "agent", reason: proof.reason }
    : { by: null, reason: proof.reason };
}

/** 403 for something only the user may do */
export function userOnly(reason: UserProofFailure): NextResponse {
  const error: UserOnlyError = { error: "user_only", reason };
  return NextResponse.json(error, { status: 403 });
}

/**
 * Asking for full access: the user gets it, an agent gets the capped
 * version (recorded), anyone else a 403 (recorded). Returns the 403, or
 * whether full access is granted.
 */
export function grantFullAccess(
  request: Request,
  who: Requester,
  audit: { targetSessionId: string; action: AgentActionKind; detail: string }
): { grant: boolean; refuse: NextResponse | null } {
  if (who.by === "user") {
    forgetRetried(audit.targetSessionId, audit.action);
    return { grant: true, refuse: null };
  }
  recordRefusal(request, audit);
  if (who.by === null) return { grant: false, refuse: userOnly(who.reason) };
  return { grant: false, refuse: null };
}

/** An agent's request that went through, for the card's history */
export function recordAllowed(
  request: Request,
  audit: { targetSessionId: string; action: AgentActionKind; detail: string }
): void {
  recordAgentAction({
    ...audit,
    actorTmux: agentActor(request),
    allowed: true,
  });
}

/** A push and a history entry, so a switch nobody meant is seen */
export function announceFullAccess(session: Pick<Session, "id" | "name">) {
  const msg = {
    kind: "finished" as const,
    title: "Full access switched on",
    body: `${session.name} won't ask before acting`,
    sessionId: session.id,
  };
  const entry = recordNotification(msg);
  if (process.env.AGENTOS_DISABLE_PUSH === "1") return;
  sendPush(msg)
    .then((report) => setDelivered(entry.id, report))
    .catch(() => {});
}
