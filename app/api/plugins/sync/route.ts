import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync } from "fs";

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

export async function POST() {
  try {
    const claude = getClaudePath();
    execSync(`${claude} plugin marketplace update`, {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, HOME: process.env.HOME || "/config" },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to sync marketplaces";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
