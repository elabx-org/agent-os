import { NextResponse } from "next/server";
import { cardOf } from "@/lib/project-card";
import { getProject } from "@/lib/projects";
import { repoOfFolder } from "@/lib/session-move";
import { userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

// GET /api/projects/[id]/card - the project as another machine would set
// it up (lib/project-move-types.ts), and the repository its folder is in
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const no = userOnly(request);
  if (no) return no;
  const { id } = await params;
  const card = cardOf(id);
  const project = getProject(id);
  if (!card || !project) {
    return NextResponse.json({ error: "No such project" }, { status: 404 });
  }
  return NextResponse.json({
    card,
    repo: await repoOfFolder(project.working_directory).catch(() => null),
  });
}
