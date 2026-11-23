import { NextResponse } from "next/server";
import { jobMode, setJobMode } from "@/lib/jobs/settings";
import { cleanJobMode } from "@/lib/jobs/types";
import { requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

// GET /api/jobs/settings - { mode }: how much a job's session may do on
// this machine without asking
export async function GET() {
  return NextResponse.json({ mode: jobMode() }, { headers: noStore });
}

// PUT /api/jobs/settings { mode } - manual | acceptEdits | auto. The
// user's page only: no session, here or elsewhere, can raise it
export async function PUT(request: Request) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
  const mode = cleanJobMode(body.mode);
  if (!mode) {
    return NextResponse.json({ error: "Which one?" }, { status: 400 });
  }
  setJobMode(mode);
  return NextResponse.json({ mode }, { headers: noStore });
}
