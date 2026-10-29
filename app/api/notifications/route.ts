import { NextRequest, NextResponse } from "next/server";
import { listNotifications, markNotificationsRead } from "@/lib/push/history";

// GET /api/notifications?since=<ms> - what needed you or happened lately,
// newest first, with the unread count
export async function GET(request: NextRequest) {
  const since = Number(new URL(request.url).searchParams.get("since"));
  return NextResponse.json(
    listNotifications({ since: Number.isFinite(since) ? since : undefined })
  );
}

// POST /api/notifications - { read: ids | "all" } marks them read
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    read?: unknown;
  } | null;
  const read = body?.read;
  const ids =
    read === "all"
      ? "all"
      : Array.isArray(read) && read.every((id) => typeof id === "string")
        ? (read as string[])
        : null;
  if (!ids) {
    return NextResponse.json(
      { error: 'Expected { read: ids or "all" }' },
      { status: 400 }
    );
  }
  markNotificationsRead(ids);
  return NextResponse.json(listNotifications());
}

// DELETE /api/notifications - clears the history (Needs you → Clear
// history), returns the empty list. M1b U1b.2 implements it.
export async function DELETE() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
