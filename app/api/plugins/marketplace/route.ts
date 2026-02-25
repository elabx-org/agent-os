import { NextRequest, NextResponse } from "next/server";
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

// POST /api/plugins/marketplace - Add a marketplace
export async function POST(request: NextRequest) {
  try {
    const { repo } = await request.json();

    if (!repo || typeof repo !== "string") {
      return NextResponse.json({ error: "repo is required" }, { status: 400 });
    }

    // Validate it looks like a GitHub repo (owner/name)
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      return NextResponse.json(
        { error: "Invalid repo format. Use owner/repo-name" },
        { status: 400 }
      );
    }

    const claude = getClaudePath();
    execSync(`${claude} plugin marketplace add github:${repo}`, {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, HOME: process.env.HOME || "/config" },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to add marketplace";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/plugins/marketplace - Remove a marketplace
export async function DELETE(request: NextRequest) {
  try {
    const { name } = await request.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const claude = getClaudePath();
    execSync(`${claude} plugin marketplace remove ${name}`, {
      encoding: "utf-8",
      timeout: 15000,
      env: { ...process.env, HOME: process.env.HOME || "/config" },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to remove marketplace";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
