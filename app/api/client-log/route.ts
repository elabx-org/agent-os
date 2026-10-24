import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

const MAX_BYTES = 1_000_000;
const MAX_LINES = 200;

function logFile(): string {
  const home = process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  return path.join(home, "logs", "client.log");
}

// POST /api/client-log - { lines: string[] } from the iOS app, for debugging
// what the page saw (taps, focus, keyboard). Kept to about 1 MB.
export async function POST(request: NextRequest) {
  const { lines } = (await request.json().catch(() => ({}))) as {
    lines?: unknown;
  };
  if (!Array.isArray(lines)) {
    return NextResponse.json({ error: "lines required" }, { status: 400 });
  }
  const text = lines
    .slice(0, MAX_LINES)
    .map((line) => String(line).replace(/[\r\n]+/g, " ").slice(0, 500))
    .join("\n");
  const file = logFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
    fs.appendFileSync(file, text + "\n");
  } catch (error) {
    console.error("client-log:", error);
  }
  return NextResponse.json({ ok: true });
}
