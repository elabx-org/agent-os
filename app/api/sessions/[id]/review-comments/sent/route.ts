import { NextResponse } from "next/server";

// POST /api/sessions/[id]/review-comments/sent (user only) MarkSentRequest -
// MarkSentResult: after the combined message went through the queue
// M12 contract stub: U12.1 implements
export const POST = () =>
  NextResponse.json({ error: "Not implemented" }, { status: 501 });
