import { NextResponse } from "next/server";
import { readPushConfig, writePushConfig } from "@/lib/push/config";
import { recordNotification } from "@/lib/push/history";
import { sendPush } from "@/lib/push/send";

// POST /api/push/test - send a test notification on every channel
export async function POST() {
  const message = {
    kind: "test" as const,
    title: "AgentOS",
    body: "Notifications work. You'll hear from here when a session needs you or finishes.",
  };
  const report = await sendPush(message);
  // Read after the send: it may have saved device changes
  const config = readPushConfig();
  config.lastTest = { at: Date.now(), report };
  writePushConfig(config);
  // Nothing to answer, so it goes in as read
  recordNotification({ ...message, delivered: report, read: true });
  return NextResponse.json({ report, lastTest: config.lastTest });
}
