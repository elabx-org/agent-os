import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { authConfig } from "@/lib/auth";
import {
  learnPublicBase,
  recordOpen,
  sharedState,
  waitForEvents,
} from "@/lib/browser-open";
import { configuredPublicUrl, proxyConfig } from "@/lib/port-proxy-config";
import { agentOsHome } from "@/lib/push/config";
import { proxyUrlFor } from "@/lib/proxy-url";

export const dynamic = "force-dynamic";

/** Longest a GET may wait for a link (?wait=<seconds>) */
const MAX_WAIT_S = 25;

/** Where the user opens Agent-OS, for links the helper prints */
function publicBase(): string | null {
  const configured = configuredPublicUrl();
  if (configured) return configured;
  try {
    const signIn = authConfig()?.publicUrl;
    if (signIn) return signIn;
  } catch {
    // Half-configured sign-in: reported at startup
  }
  try {
    // Read directly: readPushConfig() writes defaults on first use
    const push = JSON.parse(
      fs.readFileSync(path.join(agentOsHome(), "push.json"), "utf8")
    ) as { publicUrl?: string };
    const url = push.publicUrl?.trim().replace(/\/+$/, "");
    if (url && /^https?:\/\/[^/]+$/i.test(url)) return url;
  } catch {
    // No push settings
  }
  return sharedState().learnedBase;
}

// POST /api/browser-open - the agentos-browser helper hands over a link
// {url, session?}; answers {ok, open} with the link to print
export async function POST(request: NextRequest) {
  // A custom header: a browser can't send it cross-site without a preflight
  if (request.headers.get("x-agentos-browser") !== "1") {
    return NextResponse.json({ error: "Missing header" }, { status: 400 });
  }
  let body: { url?: unknown; session?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = recordOpen(body?.url, body?.session);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: result.reason === "rate_limited" ? 429 : 400 }
    );
  }
  const { event } = result;
  let open: string | null = null;
  const base = publicBase();
  if (event.kind === "loopback" && base && event.port && event.path) {
    const config = proxyConfig();
    open = proxyUrlFor(event.port, event.path, {
      origin: base,
      subdomainBase: config.subdomainBase,
      enabled: config.enabled,
    });
  }
  return NextResponse.json({ ok: true, seq: event.seq, open });
}

// GET /api/browser-open?after=<seq>[&wait=<seconds>] - links newer than
// seq; without `after` only the current seq. The page polls without wait:
// a held request would take one of HTTP/1.1's six connections per tab
export async function GET(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "http";
  if (host && (proto === "http" || proto === "https")) {
    learnPublicBase(`${proto}://${host}`);
  }

  const afterParam = request.nextUrl.searchParams.get("after");
  const after =
    afterParam !== null && /^\d+$/.test(afterParam) ? Number(afterParam) : null;
  const waitParam = Number(request.nextUrl.searchParams.get("wait") ?? 0);
  const waitMs =
    Number.isFinite(waitParam) && waitParam > 0
      ? Math.min(waitParam, MAX_WAIT_S) * 1000
      : 0;
  const result = await waitForEvents(
    after,
    waitMs,
    sharedState(),
    request.signal
  );
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
