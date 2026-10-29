import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { userOnly } from "@/lib/permission-guard";
import { requireUser } from "@/lib/user-proof";
import { trustConfig } from "@/lib/project-config";

// POST /api/projects/[id]/trust {hash} - approves that config hash, so its
// setup steps and scripts may run; requireUser
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const proof = requireUser(request);
  if (!proof.ok) return userOnly(proof.reason);
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.is_uncategorized) {
    return NextResponse.json(
      { error: "Uncategorized has no config" },
      { status: 400 }
    );
  }
  const { hash } = await request.json().catch(() => ({}));
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    return NextResponse.json({ error: "hash required" }, { status: 400 });
  }
  trustConfig(id, hash);
  return NextResponse.json({ ok: true });
}
