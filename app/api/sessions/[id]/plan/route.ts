import { NextResponse } from "next/server";

// M2 contract: GET -> PlanResponse (lib/claude-plan.ts). U2.3

export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
