import { NextRequest, NextResponse } from "next/server";
import { finalize, getJob } from "@/lib/video";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/video/[id]/finalize - { exclude }: the frames to send, in their
// own folder, and the line for Claude
export async function POST(request: NextRequest, { params }: RouteParams) {
  const job = getJob((await params).id);
  if (!job) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  const { exclude } = (await request.json().catch(() => ({}))) as {
    exclude?: string[];
  };
  try {
    return NextResponse.json(
      finalize(job, Array.isArray(exclude) ? exclude : [])
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 409 }
    );
  }
}
