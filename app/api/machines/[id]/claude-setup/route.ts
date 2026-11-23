import { NextResponse } from "next/server";
import {
  SetupUnavailable,
  copySetup,
  machineSetup,
} from "@/lib/claude-setup/hub";
import { SETUP_KEY } from "@/lib/claude-setup/types";
import { caller, userHeaders } from "@/lib/link/move";
import { machinesOn } from "@/lib/link/server";
import { requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const MACHINE = /^m_[0-9a-f]{12}$/;

function failed(error: unknown): NextResponse {
  if (error instanceof SetupUnavailable) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : "It didn't work";
  console.error("[claude-setup]", error);
  return NextResponse.json({ error: message }, { status: 502 });
}

// GET /api/machines/[id]/claude-setup - how this server's skills,
// commands, agents and plugins stand on that machine
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!machinesOn() || !MACHINE.test(id)) {
    return NextResponse.json({ error: "No such machine" }, { status: 404 });
  }
  try {
    return NextResponse.json(await machineSetup(id, userHeaders(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failed(error);
  }
}

// POST /api/machines/[id]/claude-setup - { keys } copies those there;
// { follow, skip } sets that machine's "keep matching". The user's call
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!machinesOn() || !MACHINE.test(id)) {
    return NextResponse.json({ error: "No such machine" }, { status: 404 });
  }
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    keys?: unknown;
    follow?: unknown;
    skip?: unknown;
  };
  const headers = userHeaders(request);
  try {
    if (typeof body.follow === "boolean" || Array.isArray(body.skip)) {
      await caller(headers)(id, "/api/claude-setup", {
        method: "PATCH",
        json: { follow: body.follow, skip: body.skip },
      });
    }
    const keys = Array.isArray(body.keys)
      ? body.keys.filter(
          (key): key is string => typeof key === "string" && SETUP_KEY.test(key)
        )
      : [];
    if (keys.length) await copySetup(id, keys, headers);
    return NextResponse.json(await machineSetup(id, headers));
  } catch (error) {
    return failed(error);
  }
}
