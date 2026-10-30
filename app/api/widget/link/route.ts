import { NextRequest, NextResponse } from "next/server";
import { newWidgetKey, widgetKey } from "@/lib/widget-key";

/** The address a widget reaches this server by: the one this page is on */
function feedUrl(request: NextRequest, key: string): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/widget?key=${key}`;
}

// GET /api/widget/link: the link to paste into the widget (signed in only)
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { url: feedUrl(request, widgetKey()) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// POST /api/widget/link: a new key; widgets holding the old link stop
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { url: feedUrl(request, newWidgetKey()) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
