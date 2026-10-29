import { NextResponse } from "next/server";

// M2b contract (U2b.1). POST /api/git/commit-message {path} -> CommitMessageResponse: a message
// for what's changed there, written by Claude (D-Git's "Write with Claude")
export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
