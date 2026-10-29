import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { isAgentOrigin } from "@/lib/agent-origin";
import { AGENT_ACTOR_HEADER, recordAgentAction } from "@/lib/agent-actions";
import { requireUser } from "@/lib/user-proof";
import { isRunning } from "@/lib/session-launch";
import {
  effectiveMode,
  isEscalation,
  normalizeMode,
  parseLaunchCaps,
  type Mode,
  type PermissionModeState,
  type SetPermissionModeResult,
  type UserOnlyError,
} from "@/lib/permission-mode";
import {
  allowPendingPrompt,
  applyModeLive,
  readLiveMode,
} from "@/lib/permission-mode-live";
import { recordNotification, setDelivered } from "@/lib/push/history";
import { sendPush } from "@/lib/push/send";

function getSession(id: string): Session | null {
  return (queries.getSession(getDb()).get(id) as Session | undefined) ?? null;
}

/** Full access now, without a relaunch: only through the Labs Shift+Tab cycle */
function canApplyLive(session: Session, running: boolean): boolean {
  return (
    running &&
    session.agent_type === "claude" &&
    parseLaunchCaps(session.launch_caps).allowBypassCycle
  );
}

/** Audit, never in the way of the answer */
function audit(
  request: NextRequest,
  sessionId: string,
  allowed: boolean,
  detail: string
) {
  try {
    recordAgentAction({
      actorTmux: request.headers.get(AGENT_ACTOR_HEADER),
      targetSessionId: sessionId,
      action: "permission_mode",
      allowed,
      detail,
    });
  } catch (error) {
    console.error("Error recording agent action:", error);
  }
}

/** A push and a history entry, so a switch nobody meant is seen */
function announceFullAccess(session: Session) {
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

// GET /api/sessions/[id]/permission-mode - PermissionModeState
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const running = await isRunning(session);
  const state: PermissionModeState = {
    mode: effectiveMode(session),
    pending: normalizeMode(session.permission_pending),
    live: running ? await readLiveMode(session) : null,
    canApplyLive: canApplyLive(session, running),
    agentType: session.agent_type,
  };
  return NextResponse.json(state);
}

// POST /api/sessions/[id]/permission-mode {mode, allowPending?} -
// SetPermissionModeResult. Full access, answering the pending request and
// any step up from the current mode are the user's (requireUser); agents
// may only lower it. A running Claude session switches at once where its
// Shift+Tab cycle allows, else from its next launch (permission_pending).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const mode = normalizeMode(body.mode);
  const allowPending = body.allowPending === true;
  if (!mode) {
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  }
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const current = effectiveMode(session);
  const detail = allowPending ? `${mode} + allow` : mode;
  const fromAgent =
    isAgentOrigin(request) || request.headers.has(AGENT_ACTOR_HEADER);
  if (
    mode === "bypassPermissions" ||
    allowPending ||
    isEscalation(mode, current)
  ) {
    const proof = requireUser(request);
    if (!proof.ok) {
      // Without agent markers it's the user's tab with a stale cookie, which
      // retries through the iframe; not worth a "tried and was blocked" line
      if (fromAgent || proof.reason === "cross_site") {
        audit(request, id, false, detail);
      }
      const error: UserOnlyError = { error: "user_only", reason: proof.reason };
      return NextResponse.json(error, { status: 403 });
    }
  } else if (fromAgent) {
    audit(request, id, true, detail);
  }

  if (allowPending && (await allowPendingPrompt(session))) {
    // The dialog goes before the footer is back
    await new Promise((r) => setTimeout(r, 300));
  }

  let pending: Mode | null = null;
  let appliedNow = false;
  let needsRestart = false;
  if (await isRunning(session)) {
    if (session.agent_type === "claude") {
      if (mode !== "bypassPermissions" || canApplyLive(session, true)) {
        appliedNow = (await applyModeLive(session, mode)).applied;
      }
      // Claude resumes its conversation, so it can take it at the next idle
      if (!appliedNow) pending = mode;
    }
    // Others take it when they're next started
    needsRestart = !appliedNow;
  }

  queries
    .updateSessionPermissionMode(getDb())
    .run(mode, pending, mode === "bypassPermissions" ? 1 : 0, id);
  if (mode === "bypassPermissions" && current !== mode) {
    announceFullAccess(session);
  }

  const result: SetPermissionModeResult = {
    mode,
    pending,
    appliedNow,
    needsRestart,
  };
  return NextResponse.json(result);
}
