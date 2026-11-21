import { NextResponse } from "next/server";
import { requireLinkMachine } from "@/lib/link/up-guard";

export const dynamic = "force-dynamic";

// POST /api/link/inbox/ping - a linked machine's AgentOS checks it can
// reach the inbox its copies go to. Only through the link
export async function POST(request: Request) {
  const link = requireLinkMachine(request);
  if (!link.ok) return link.response;
  return NextResponse.json({ ok: true, machineId: link.machine.id });
}
