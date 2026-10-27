import { NextRequest, NextResponse } from "next/server";
import { appendChunk, cancel, getJob } from "@/lib/video";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const missing = () =>
  NextResponse.json({ error: "Video not found" }, { status: 404 });

// GET /api/video/[id] - where the upload and the frames are
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const job = getJob((await params).id);
  return job ? NextResponse.json(job) : missing();
}

// PUT /api/video/[id]?offset=N - one chunk of the video, as the raw body
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const job = getJob((await params).id);
  if (!job) return missing();
  const offset = Number(request.nextUrl.searchParams.get("offset"));
  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "offset required" }, { status: 400 });
  }
  try {
    appendChunk(job, offset, Buffer.from(await request.arrayBuffer()));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 400 }
    );
  }
  return NextResponse.json({ received: job.received });
}

// DELETE /api/video/[id] - stop and forget it, frames and all
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const job = getJob((await params).id);
  if (job) cancel(job);
  return NextResponse.json({ ok: true });
}
