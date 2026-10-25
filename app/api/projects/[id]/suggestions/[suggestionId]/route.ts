import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProject } from "@/lib/projects";
import { listSuggestions, takeSuggestion } from "@/lib/project-context";

// POST /api/projects/[id]/suggestions/[suggestionId] - { action: "accept" }
// adds the suggested line to the project's instructions; "dismiss" drops it
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; suggestionId: string }> }
) {
  const { id, suggestionId } = await params;
  const project = getProject(id);
  if (!project || project.is_uncategorized) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const { action } = await request.json();
  if (action !== "accept" && action !== "dismiss") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const text = takeSuggestion(id, suggestionId);
  if (text === null) {
    return NextResponse.json(
      { error: "Suggestion not found" },
      { status: 404 }
    );
  }
  let instructions = project.instructions;
  if (action === "accept") {
    const line = text.replace(/\s*\n\s*/g, " ");
    instructions = [
      project.instructions?.trim(),
      `- ${line.replace(/^[-*]\s+/, "")}`,
    ]
      .filter(Boolean)
      .join("\n");
    getDb()
      .prepare(
        "UPDATE projects SET instructions = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(instructions, id);
  }
  return NextResponse.json({ instructions, suggestions: listSuggestions(id) });
}
