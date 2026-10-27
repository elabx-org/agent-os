import { NextRequest, NextResponse } from "next/server";
import { MAX_BYTES, createJob } from "@/lib/video";

// POST /api/video - { name, size }: a video about to be uploaded in chunks
export async function POST(request: NextRequest) {
  const { name, size } = (await request.json().catch(() => ({}))) as {
    name?: string;
    size?: number;
  };
  if (typeof size !== "number" || size <= 0) {
    return NextResponse.json({ error: "size required" }, { status: 400 });
  }
  if (size > MAX_BYTES) {
    return NextResponse.json({ error: "Video too large" }, { status: 413 });
  }
  const job = createJob(String(name || "video.mov"), size);
  return NextResponse.json({ id: job.id });
}
