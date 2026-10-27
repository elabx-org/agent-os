import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// The build this server runs, read once: a deploy restarts the server
const BUILD_ID = (() => {
  try {
    return fs
      .readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")
      .trim();
  } catch {
    return "dev";
  }
})();

// GET /api/build - { id }, so an open page can tell a deploy happened
export async function GET() {
  return NextResponse.json(
    { id: BUILD_ID },
    { headers: { "Cache-Control": "no-store" } }
  );
}
