import { NextRequest, NextResponse } from "next/server";
import { listListeningPorts } from "@/lib/listening-ports";
import { proxyConfig } from "@/lib/port-proxy-config";
import { isRefusedPort } from "@/lib/port-proxy-target";

export const dynamic = "force-dynamic";

// GET /api/ports - listening TCP ports the proxy can reach, and its settings
// (?only=config skips the port scan)
export async function GET(request: NextRequest) {
  const config = proxyConfig();
  const proxy = {
    enabled: config.enabled,
    mode: config.subdomainBase ? "path+subdomain" : "path",
    subdomainBase: config.subdomainBase,
    sandbox: config.sandbox,
  };
  if (request.nextUrl.searchParams.get("only") === "config") {
    return NextResponse.json({ proxy });
  }
  try {
    const ports = (await listListeningPorts()).map((entry) => ({
      ...entry,
      self: entry.port === config.ownPort,
      refused: isRefusedPort(entry.port, config),
    }));
    return NextResponse.json({ proxy, ports });
  } catch (error) {
    console.error("Error listing ports:", error);
    return NextResponse.json(
      { error: "Failed to list ports" },
      { status: 500 }
    );
  }
}
