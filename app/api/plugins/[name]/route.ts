import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync } from "fs";

interface RouteParams {
  params: Promise<{ name: string }>;
}

function getClaudePath(): string {
  const home = process.env.HOME || "/config";
  const paths = [
    `${home}/.local/bin/claude`,
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return "claude";
}

const ALLOWED_ACTIONS = ["install", "uninstall", "enable", "disable", "update"] as const;
type PluginAction = (typeof ALLOWED_ACTIONS)[number];

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { name } = await params;
    const body = await request.json();
    const action = body.action as string;

    if (!name) {
      return NextResponse.json(
        { error: "Plugin name is required" },
        { status: 400 }
      );
    }

    if (!action || !ALLOWED_ACTIONS.includes(action as PluginAction)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${ALLOWED_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate plugin name to prevent command injection
    if (!/^[\w@./-]+$/.test(name)) {
      return NextResponse.json(
        { error: "Invalid plugin name" },
        { status: 400 }
      );
    }

    const claude = getClaudePath();
    const cmd = `${claude} plugin ${action} "${name}"`;

    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 60000,
      env: { ...process.env, HOME: process.env.HOME || "/config" },
    });

    return NextResponse.json({ success: true, output: output.trim() });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to perform plugin action";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
