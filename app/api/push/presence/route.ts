import { NextRequest, NextResponse } from "next/server";
import { setPresence } from "@/lib/push/config";

// POST /api/push/presence - { sessionId, visible }: what the app is showing,
// so a session you are looking at doesn't also buzz your phone
export async function POST(request: NextRequest) {
  const text = await request.text();
  let body: { clientId?: unknown; sessionId?: unknown; visible?: unknown } = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (typeof body.clientId !== "string" || body.clientId.length > 64) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  setPresence(
    body.clientId,
    typeof body.sessionId === "string" ? body.sessionId : null,
    body.visible === true
  );
  return NextResponse.json({ ok: true });
}
