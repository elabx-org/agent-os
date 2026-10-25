import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { buildProjectNote, listSuggestions } from "@/lib/project-context";

// GET /api/projects/[id]/context - the note a session in this project starts
// with (null when it gets none), and the instructions sessions have suggested
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({
    note: await buildProjectNote(project, null),
    suggestions: listSuggestions(id),
  });
}
