import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { PROVIDERS } from "@/lib/providers/registry";

/**
 * GET /api/cli-status
 *
 * Check which AI CLI tools are installed on the host.
 */
export async function GET() {
  const status: Record<string, { installed: boolean }> = {};

  for (const provider of PROVIDERS) {
    if (provider.id === "shell") {
      status[provider.id] = { installed: true };
      continue;
    }

    if (!provider.cli) {
      status[provider.id] = { installed: false };
      continue;
    }

    try {
      const result = execSync(
        `command -v ${provider.cli} 2>/dev/null || true`,
        { encoding: "utf-8", timeout: 3000, shell: "/bin/bash" }
      ).trim();

      status[provider.id] = { installed: !!result };
    } catch {
      status[provider.id] = { installed: false };
    }
  }

  return NextResponse.json(status);
}
