import { NextRequest, NextResponse } from "next/server";
import { getScriptRun, isRunId, readRunLog } from "@/lib/script-runs";
import type { ScriptRunLogResponse } from "@/lib/project-config-types";

// GET /api/script-runs/[runId]/log?lines=N - ScriptRunLogResponse, the
// last N (1-500, default 50) lines of a background run's log
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  if (!isRunId(runId) || !getScriptRun(runId)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const param = new URL(request.url).searchParams.get("lines");
  const asked = param ? Number(param) : NaN;
  const lines = Number.isFinite(asked)
    ? Math.min(Math.max(Math.round(asked), 1), 500)
    : 50;
  const response: ScriptRunLogResponse = {
    lines: await readRunLog(runId, lines),
  };
  return NextResponse.json(response);
}
