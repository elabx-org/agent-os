import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { forgetRetried, recordRefusal } from "@/lib/agent-actions";
import {
  announceFullAccess,
  recordAllowed,
  requester,
  userOnly,
} from "@/lib/permission-guard";
import { getFlag } from "@/lib/flags";
import {
  decideApply,
  forgetModeMiss,
  noteModeMiss,
  retryPendingSoon,
} from "@/lib/permission-apply";
import { isRunning } from "@/lib/session-launch";
import { readiness } from "@/lib/session-ready";
import {
  effectiveMode,
  isEscalation,
  normalizeMode,
  parseLaunchCaps,
  type Mode,
  type PermissionModeState,
  type SetPermissionModeResult,
} from "@/lib/permission-mode";
import {
  allowPendingPrompt,
  applyModeLive,
  readLiveMode,
} from "@/lib/permission-mode-live";

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

// POST /api/sessions/[id]/permission-mode {mode, allowPending?, prompt?} -
// SetPermissionModeResult. Full access, answering the pending request and
// any step up from the current mode are the user's (requireUser). An agent
// that says so may lower the stored mode, which applies at its next launch:
// no keys are pressed in a session for an agent. A request with neither
// proof nor agent markers is refused (it may be the user's stale tab, which
// re-proves and retries). With proof, a running Claude session switches at
// once where its Shift+Tab cycle allows, else from its next launch
// (permission_pending). With flag modeAtIdle, a pick made mid-turn waits
// (permission_pending, no keys) and lib/permission-apply presses it in at
// the next idle edge. allowPending answers only the request the card
// showed (`prompt`: its allow option's index and label).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const mode = normalizeMode(body.mode);
  const allowPending = body.allowPending === true;
  const shown =
    body.prompt &&
    typeof body.prompt.index === "number" &&
    typeof body.prompt.label === "string"
      ? {
          index: body.prompt.index as number,
          label: body.prompt.label as string,
        }
      : null;
  if (!mode) {
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  }
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const current = effectiveMode(session);
  const audit = {
    targetSessionId: id,
    action: "permission_mode" as const,
    detail: allowPending ? `${mode} + allow` : mode,
  };
  const who = requester(request);
  const userOnlyChange =
    mode === "bypassPermissions" || allowPending || isEscalation(mode, current);
  if (who.by !== "user" && (userOnlyChange || who.by === null)) {
    recordRefusal(request, audit);
    return userOnly(who.reason);
  }
  if (who.by === "agent") {
    // Lowering, stored only: never keys in another session for an agent
    recordAllowed(request, audit);
    queries
      .updateSessionPermissionMode(getDb())
      .run(mode, null, mode === "bypassPermissions" ? 1 : 0, id);
    const running = await isRunning(session);
    const result: SetPermissionModeResult = {
      mode,
      pending: null,
      appliedNow: false,
      needsRestart: running,
      appliesAt: running ? "restart" : "nextLaunch",
    };
    return NextResponse.json(result);
  }
  forgetRetried(id, "permission_mode");
  forgetModeMiss(id);

  if (allowPending && shown && (await allowPendingPrompt(session, shown))) {
    // The dialog goes before the footer is back
    await new Promise((r) => setTimeout(r, 300));
  }

  let pending: Mode | null = null;
  let appliedNow = false;
  let needsRestart = false;
  const running = await isRunning(session);
  const flagOn = getFlag("modeAtIdle");
  const decision = decideApply({
    agentType: session.agent_type,
    running,
    // Only read when it decides something: a running Claude with the flag on
    ready:
      running && flagOn && session.agent_type === "claude"
        ? (await readiness(session)).ready
        : true,
    mode,
    flagOn,
    canCycleBypass: canApplyLive(session, running),
  });
  let appliesAt = decision.appliesAt;
  if (decision.action === "live") {
    const outcome = await applyModeLive(session, mode);
    appliedNow = outcome.applied;
    // Claude resumes its conversation, so it can take it at a restart
    if (!appliedNow) {
      // The cycle came round without it: the idle edge needn't try again
      if (outcome.live !== null) noteModeMiss(id, mode);
      pending = mode;
      needsRestart = true;
      appliesAt = "restart";
    }
  } else if (decision.action === "pending") {
    pending = mode;
    needsRestart = decision.appliesAt === "restart";
    if (decision.appliesAt === "nextTurn") retryPendingSoon(id);
  } else {
    // Others take it when they're next started
    needsRestart = running;
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
    appliesAt,
  };
  return NextResponse.json(result);
}
