import { NextRequest, NextResponse } from "next/server";
import { PRESETS, extract, getJob, type Preset } from "@/lib/video";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/video/[id]/extract - { preset }: make its frames (in the
// background; GET /api/video/[id] follows it)
export async function POST(request: NextRequest, { params }: RouteParams) {
  const job = getJob((await params).id);
  if (!job) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  const { preset } = (await request.json().catch(() => ({}))) as {
    preset?: Preset;
  };
  if (!preset || !(preset in PRESETS)) {
    return NextResponse.json({ error: "preset required" }, { status: 400 });
  }
  if (job.stage === "uploading") {
    return NextResponse.json({ error: "Upload not finished" }, { status: 409 });
  }
  if (job.stage !== "extracting") void extract(job, preset);
  return NextResponse.json(job);
}
