import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { lastRunsByScript } from "@/lib/script-runs";
import type { ScriptRunsResponse } from "@/lib/project-config-types";

// GET /api/projects/[id]/scripts/runs - ScriptRunsResponse (last run per
// script, reconciled)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.is_uncategorized) {
    return NextResponse.json(
      { error: "Uncategorized has no scripts" },
      { status: 400 }
    );
  }
  const response: ScriptRunsResponse = { runs: await lastRunsByScript(id) };
  return NextResponse.json(response);
}
