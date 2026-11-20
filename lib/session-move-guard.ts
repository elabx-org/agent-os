/**
 * Moving a session between machines is the user's call: every route of
 * lib/session-move.ts answers only their own browser (through the hub,
 * which vouches for it down the link). Server only.
 */

import { NextResponse } from "next/server";
import { MoveRefused } from "./session-move";
import { requireUser } from "./user-proof";

export function userOnly(request: Request): NextResponse | null {
  const proof = requireUser(request);
  return proof.ok
    ? null
    : NextResponse.json(
        { error: "user_only", reason: proof.reason },
        { status: 403 }
      );
}

export function moveError(error: unknown): NextResponse {
  if (error instanceof MoveRefused) {
    return NextResponse.json(
      { error: error.message, reason: error.reason },
      { status: error.status }
    );
  }
  const text = error instanceof Error ? error.message : String(error);
  console.error("[session-move]", error);
  return NextResponse.json(
    { error: text },
    { status: text === "No such move" ? 404 : 500 }
  );
}
