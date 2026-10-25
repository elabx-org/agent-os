import { NextRequest, NextResponse } from "next/server";
import { reorderProjects } from "@/lib/projects";

// POST /api/projects/reorder - Save the order of projects, as a list of ids
export async function POST(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      return NextResponse.json(
        { error: "ids must be a list of project ids" },
        { status: 400 }
      );
    }
    reorderProjects(ids);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordering projects:", error);
    return NextResponse.json(
      { error: "Failed to reorder projects" },
      { status: 500 }
    );
  }
}
