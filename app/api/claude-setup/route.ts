import { NextResponse } from "next/server";
import {
  inventory,
  listItems,
  readRecord,
  writeRecord,
} from "@/lib/claude-setup/inventory";
import { SETUP_FOLLOW_HEADER } from "@/lib/claude-setup/proof";
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
  const peek = (await request
    .clone()
    .json()
    .catch(() => ({}))) as object;
  // "Keep matching" may only mark what the server took back
  const following =
    request.headers.get(SETUP_FOLLOW_HEADER) === "1" &&
    readRecord().follow &&
    Object.keys(peek).every((name) => name === "adopt");
  if (!proof.ok && !following) {
    return NextResponse.json(
      { error: "user_only", reason: proof.ok ? undefined : proof.reason },
      { status: 403 }
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    follow?: unknown;
    skip?: unknown;
    adopt?: unknown;
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
  // The server took these as they are here: from now on they are the
  // copy both sides started from
  if (Array.isArray(body.adopt)) {
    const here = new Map(listItems().map((item) => [item.key, item.hash]));
    for (const key of body.adopt) {
      if (typeof key !== "string" || key.startsWith("plugin:")) continue;
      const hash = here.get(key);
      if (hash) record.placed[key] = hash;
    }
  }
  writeRecord(record);
  return NextResponse.json({ follow: record.follow, skip: record.skip });
}
