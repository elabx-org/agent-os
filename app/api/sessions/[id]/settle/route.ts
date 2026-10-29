import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requireUser } from "@/lib/user-proof";
import { SettleRefused, settleSession, unsettleSession } from "@/lib/settle";
import type { SettleResult, UnsettleResult } from "@/lib/settle-types";

// POST /api/sessions/[id]/settle {force?} - SettleResult; DELETE - unsettle,
// UnsettleResult (M8, lib/settle.ts; types in lib/settle-types.ts).
// User-only (requireUser); 409 SettleError {reason} when refused

type Params = { params: Promise<{ id: string }> };

/** The user's session, or the response refusing the request */
async function target(
  request: NextRequest,
  params: Params["params"]
): Promise<Session | NextResponse> {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const { id } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return session;
}

function refused(error: unknown, what: string): NextResponse {
  if (error instanceof SettleRefused) {
    return NextResponse.json(error.body, { status: error.status });
  }
  console.error(`${what} failed:`, error);
  return NextResponse.json({ error: `${what} failed` }, { status: 500 });
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await target(request, params);
  if (session instanceof NextResponse) return session;
  const body = await request.json().catch(() => null);
  try {
    const settled = await settleSession(session, {
      reason: "manual",
      force: body?.force === true,
    });
    const result: SettleResult = { session: settled };
    return NextResponse.json(result);
  } catch (error) {
    return refused(error, "Settle");
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await target(request, params);
  if (session instanceof NextResponse) return session;
  try {
    const result: UnsettleResult = await unsettleSession(session);
    return NextResponse.json(result);
  } catch (error) {
    return refused(error, "Undo");
  }
}
