import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requireUser } from "@/lib/user-proof";
import { reviewStore } from "@/lib/review-comments";
import type { MarkSentResult } from "@/lib/review-types";

// POST /api/sessions/[id]/review-comments/sent (user only) MarkSentRequest -
// MarkSentResult: after the combined message went through the queue. Only
// the session's pending ones among ids flip; the rest (a comment still being
// saved has no id yet) are left out. With queueItemId the message only went
// into the queue: they wait for it instead (409 when it is gone)
const MAX_IDS = 500;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const body = await request.json().catch(() => null);
  const ids: unknown = body?.ids;
  const itemId: unknown = body?.queueItemId;
  if (!Array.isArray(ids) || ids.length > MAX_IDS) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (
    itemId !== undefined &&
    (!Number.isInteger(itemId) || Number(itemId) < 1)
  ) {
    return NextResponse.json({ error: "Bad queue item" }, { status: 400 });
  }
  const valid = ids.filter((n): n is number => Number.isInteger(n) && n >= 1);
  const comments =
    itemId === undefined
      ? reviewStore().markSent(id, valid)
      : reviewStore().markQueued(id, valid, itemId as number);
  if (!comments) {
    return NextResponse.json({ error: "Queue item gone" }, { status: 409 });
  }
  const result: MarkSentResult = { comments };
  return NextResponse.json(result);
}
