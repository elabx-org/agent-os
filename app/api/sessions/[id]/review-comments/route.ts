import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requireUser } from "@/lib/user-proof";
import {
  parseNewComment,
  parseReviewScope,
  reviewStore,
} from "@/lib/review-comments";
import type {
  DiscardResult,
  ReviewCommentResult,
  ReviewCommentsResponse,
} from "@/lib/review-types";

// GET /api/sessions/[id]/review-comments?scope= - ReviewCommentsResponse
// POST (user only) NewReviewComment - ReviewCommentResult
// DELETE ?pending=1 (user only) - DiscardResult: the tray's Discard
type Params = { params: Promise<{ id: string }> };

const findSession = (id: string) =>
  queries.getSession(getDb()).get(id) as Session | undefined;

const notFound = () =>
  NextResponse.json({ error: "Session not found" }, { status: 404 });

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!findSession(id)) return notFound();
  const raw = request.nextUrl.searchParams.get("scope");
  const scope = raw ? parseReviewScope(raw) : null;
  if (raw && !scope) {
    return NextResponse.json({ error: "Bad scope" }, { status: 400 });
  }
  const result: ReviewCommentsResponse = {
    comments: reviewStore().list(id, scope),
  };
  return NextResponse.json(result);
}

export async function POST(request: NextRequest, { params }: Params) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const { id } = await params;
  if (!findSession(id)) return notFound();
  const parsed = parseNewComment(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const result: ReviewCommentResult = {
    comment: reviewStore().add(id, parsed.comment),
  };
  return NextResponse.json(result, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const { id } = await params;
  if (!findSession(id)) return notFound();
  // Only the pending ones go; sent comments stay with the session
  if (request.nextUrl.searchParams.get("pending") !== "1") {
    return NextResponse.json({ error: "pending=1 required" }, { status: 400 });
  }
  const result: DiscardResult = { removed: reviewStore().discardPending(id) };
  return NextResponse.json(result);
}
