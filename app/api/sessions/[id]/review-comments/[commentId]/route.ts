import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { requireUser } from "@/lib/user-proof";
import { parseCommentBody, reviewStore } from "@/lib/review-comments";
import type { DiscardResult, ReviewCommentResult } from "@/lib/review-types";

// PATCH /api/sessions/[id]/review-comments/[commentId] (user only)
// EditReviewCommentRequest - ReviewCommentResult; DELETE (user only) -
// {removed}. Pending comments only (409 once sent).
type Params = { params: Promise<{ id: string; commentId: string }> };

/** The user's proof, the session and the comment, or the refusal */
async function target(request: NextRequest, { params }: Params) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const { id, commentId } = await params;
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  const n = Number(commentId);
  const comment =
    session && Number.isInteger(n) && n > 0 ? reviewStore().get(id, n) : null;
  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (comment.sentAt !== null) {
    return NextResponse.json({ error: "Already sent" }, { status: 409 });
  }
  return comment;
}

export async function PATCH(request: NextRequest, context: Params) {
  const comment = await target(request, context);
  if (comment instanceof NextResponse) return comment;
  const parsed = parseCommentBody(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const edited = reviewStore().edit(comment.sessionId, comment.id, parsed.body);
  // Sent (or gone) between the read and the write
  if (!edited) {
    return NextResponse.json({ error: "Already sent" }, { status: 409 });
  }
  const result: ReviewCommentResult = { comment: edited };
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest, context: Params) {
  const comment = await target(request, context);
  if (comment instanceof NextResponse) return comment;
  if (!reviewStore().remove(comment.sessionId, comment.id)) {
    return NextResponse.json({ error: "Already sent" }, { status: 409 });
  }
  const result: DiscardResult = { removed: 1 };
  return NextResponse.json(result);
}
