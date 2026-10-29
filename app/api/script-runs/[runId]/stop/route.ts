import { NextRequest, NextResponse } from "next/server";
import { userOnly } from "@/lib/permission-guard";
import { requireUser } from "@/lib/user-proof";
import { isRunId, stopScriptRun } from "@/lib/script-runs";

// POST /api/script-runs/[runId]/stop - {run: ScriptRun}; requireUser.
// SIGTERM to the run's process group, SIGKILL a second later
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const proof = requireUser(request);
  if (!proof.ok) return userOnly(proof.reason);
  const run = isRunId(runId) ? await stopScriptRun(runId) : null;
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}
