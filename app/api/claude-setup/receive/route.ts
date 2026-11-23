import { NextResponse } from "next/server";
import { Readable } from "stream";
import type { ReadableStream as NodeWebStream } from "stream/web";
import {
  SETUP_FOLLOW_HEADER,
  SETUP_FORCE_HEADER,
} from "@/lib/claude-setup/proof";
import { SETUP_KEY } from "@/lib/claude-setup/types";
import { SetupRefused, installSetup } from "@/lib/claude-setup/install";
import { readRecord } from "@/lib/claude-setup/inventory";
import { requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

// POST /api/claude-setup/receive - a tar.gz of skills, commands and
// agents from this machine's server, with the plugins to install. Taken
// from the user's own tap, or without one only while this machine's
// owner has "keep matching" on. It adds and updates its own copies only
export async function POST(request: Request) {
  const proof = requireUser(request);
  const following =
    request.headers.get(SETUP_FOLLOW_HEADER) === "1" && readRecord().follow;
  if (!proof.ok && !following) {
    return NextResponse.json(
      { error: "user_only", reason: proof.ok ? undefined : proof.reason },
      { status: 403 }
    );
  }
  if (!request.body) {
    return NextResponse.json({ error: "Nothing was sent" }, { status: 400 });
  }
  try {
    // Replacing the owner's own versions is never "keep matching"
    const force = proof.ok
      ? new Set(
          (request.headers.get(SETUP_FORCE_HEADER) ?? "")
            .split(",")
            .map((key) => decodeURIComponent(key.trim()))
            .filter((key) => SETUP_KEY.test(key))
        )
      : undefined;
    const job = await installSetup(
      Readable.fromWeb(request.body as unknown as NodeWebStream),
      { force }
    );
    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof SetupRefused) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error("[claude-setup] receive:", error);
    return NextResponse.json(
      { error: "The copy couldn't be put in place" },
      { status: 500 }
    );
  }
}
