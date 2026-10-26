import { NextRequest, NextResponse } from "next/server";
import {
  hasApnsKey,
  readPushConfig,
  writeApnsKey,
  writePushConfig,
  type PushConfig,
} from "@/lib/push/config";

/** The settings as the page sees them: secrets only say whether they are set */
function view(config: PushConfig) {
  const { apns } = config;
  const hasKey = hasApnsKey();
  return {
    events: config.events,
    publicUrl: config.publicUrl,
    ntfy: { ...config.ntfy, token: "", hasToken: !!config.ntfy.token },
    apns: { ...apns, hasKey },
    devices: config.devices.length,
    /** Apple push can actually deliver: on, keyed and a device to send to */
    apnsReady:
      apns.enabled &&
      !!apns.teamId &&
      !!apns.keyId &&
      hasKey &&
      config.devices.length > 0,
    lastTest: config.lastTest ?? null,
  };
}

export type PushSettingsView = ReturnType<typeof view>;

// GET /api/push - phone notification settings
export async function GET() {
  return NextResponse.json(view(readPushConfig()));
}

interface PushUpdate {
  events?: Partial<PushConfig["events"]>;
  publicUrl?: string;
  ntfy?: Partial<PushConfig["ntfy"]> & { clearToken?: boolean };
  apns?: Partial<PushConfig["apns"]> & { key?: string };
}

// PUT /api/push - change settings; an empty token or key leaves the stored one
export async function PUT(request: NextRequest) {
  const update = (await request.json().catch(() => null)) as PushUpdate | null;
  if (!update) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const config = readPushConfig();
  if (update.events) config.events = { ...config.events, ...update.events };
  if (typeof update.publicUrl === "string") config.publicUrl = update.publicUrl;

  if (update.ntfy) {
    const { token, clearToken, ...rest } = update.ntfy;
    config.ntfy = { ...config.ntfy, ...rest };
    if (token) config.ntfy.token = token;
    if (clearToken) config.ntfy.token = "";
  }

  if (update.apns) {
    const { key, ...rest } = update.apns;
    config.apns = { ...config.apns, ...rest };
    if (key) {
      if (
        !/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(key)
      ) {
        return NextResponse.json(
          { error: "That isn't a .p8 key: paste the whole file" },
          { status: 400 }
        );
      }
      writeApnsKey(key);
    }
  }

  writePushConfig(config);
  return NextResponse.json(view(config));
}
