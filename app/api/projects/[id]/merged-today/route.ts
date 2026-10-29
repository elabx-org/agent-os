import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { expandPath } from "@/lib/git-status";
import { mergedToday, type MergedTodayResponse } from "@/lib/merged-today";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/merged-today - { prs } merged today, newest first
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const project = getProject(id);
  if (!project)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const body: MergedTodayResponse = {
    prs: project.is_uncategorized
      ? []
      : await mergedToday(expandPath(project.working_directory)),
  };
  return NextResponse.json(body);
}
