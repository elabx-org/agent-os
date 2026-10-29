import { NextResponse } from "next/server";

// M2 contract: GET -> QueueState; POST EnqueueRequest -> EnqueueResult (lib/queue/types.ts). U2.1

export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
