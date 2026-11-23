import { NextResponse } from "next/server";
import {
  inventory,
  readRecord,
  writeRecord,
} from "@/lib/claude-setup/inventory";
import { SETUP_KEY } from "@/lib/claude-setup/types";
import { requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

// GET /api/claude-setup - this machine's skills, commands, agents and
// plugins, what AgentOS copied here, and the last copy
export async function GET() {
  return NextResponse.json(inventory(), {
    headers: { "Cache-Control": "no-store" },
  });
}

// PATCH /api/claude-setup - { follow, skip }: whether this machine keeps
// matching its server, and what it leaves out. The owner's call
export async function PATCH(request: Request) {
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    follow?: unknown;
    skip?: unknown;
  };
  const record = readRecord();
  if (typeof body.follow === "boolean") record.follow = body.follow;
  if (Array.isArray(body.skip)) {
    record.skip = [
      ...new Set(
        body.skip.filter(
          (key): key is string => typeof key === "string" && SETUP_KEY.test(key)
        )
      ),
    ].slice(0, 500);
  }
  writeRecord(record);
  return NextResponse.json({ follow: record.follow, skip: record.skip });
}
