import { NextResponse } from "next/server";

// PATCH /api/sessions/[id]/review-comments/[commentId] (user only)
// EditReviewCommentRequest - ReviewCommentResult; DELETE (user only) -
// {removed}. Pending comments only (409 once sent).
// M12 contract stub: U12.1 implements
const notYet = () =>
  NextResponse.json({ error: "Not implemented" }, { status: 501 });

export const PATCH = notYet;
export const DELETE = notYet;
