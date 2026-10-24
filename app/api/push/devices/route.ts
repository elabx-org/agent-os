import { NextRequest, NextResponse } from "next/server";
import { readPushConfig, writePushConfig } from "@/lib/push/config";

// POST /api/push/devices - { token }: the iOS app's APNs device token
export async function POST(request: NextRequest) {
  const { token } = (await request.json().catch(() => ({}))) as {
    token?: unknown;
  };
  if (typeof token !== "string" || !/^[0-9a-f]{32,200}$/i.test(token)) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  const config = readPushConfig();
  if (!config.devices.some((d) => d.token === token)) {
    config.devices.push({ token, addedAt: new Date().toISOString() });
    writePushConfig(config);
  }
  return NextResponse.json({ ok: true, devices: config.devices.length });
}
