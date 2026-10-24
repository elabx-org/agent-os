import { NextResponse } from "next/server";
import { sendPush } from "@/lib/push/send";

// POST /api/push/test - send a test notification on every channel
export async function POST() {
  const report = await sendPush({
    kind: "test",
    title: "Agent-OS",
    body: "Notifications work. You'll hear from here when a session needs you or finishes.",
  });
  return NextResponse.json({ report });
}
