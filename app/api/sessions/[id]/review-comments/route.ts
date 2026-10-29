import { NextResponse } from "next/server";

// GET /api/sessions/[id]/review-comments?scope= - ReviewCommentsResponse
// POST (user only) NewReviewComment - ReviewCommentResult
// DELETE ?pending=1 (user only) - DiscardResult: the tray's Discard
// M12 contract stub: U12.1 implements
const notYet = () =>
  NextResponse.json({ error: "Not implemented" }, { status: 501 });

export const GET = notYet;
export const POST = notYet;
export const DELETE = notYet;
