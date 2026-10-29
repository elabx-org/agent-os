import { NextResponse } from "next/server";
import { getClaudeUsage } from "@/lib/claude-usage";

// The fetch, cache and 429 backoff live in lib/claude-usage.ts, shared with
// the Limited detector
export async function GET() {
  const result = await getClaudeUsage();
  if ("data" in result) return NextResponse.json(result.data);
  return NextResponse.json({ error: result.error }, { status: result.status });
}
