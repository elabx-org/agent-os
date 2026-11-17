import { NextResponse } from "next/server";
import { hubSignIn, installCommand } from "@/lib/link/hub-config";
import { linkHub, machinesOn, ownSha } from "@/lib/link/server";
import { requestOrigin } from "@/lib/public-origin";
import { requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

// POST /api/machines/pair - a one-time code (ten minutes) and the command
// to paste on the new machine. The user's call, never an agent's.
export async function POST(request: Request) {
  if (!machinesOn()) {
    return NextResponse.json(
      { error: "Linked machines are off" },
      { status: 404 }
    );
  }
  const proof = requireUser(request);
  if (!proof.ok) {
    return NextResponse.json(
      { error: "user_only", reason: proof.reason },
      { status: 403 }
    );
  }
  const hubUrl = requestOrigin(request);
  if (!hubUrl) {
    return NextResponse.json(
      {
        error:
          "Open AgentOS at its own address (not localhost) to add a machine",
      },
      { status: 400 }
    );
  }
  const { code, expiresAt } = linkHub().createPairingCode();
  return NextResponse.json(
    {
      code,
      expiresAt,
      command: installCommand({
        hubUrl,
        code,
        signIn: hubSignIn(),
        sha: ownSha(),
      }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
