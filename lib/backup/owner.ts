/**
 * The user's own routes for copies (app/api/machines/[id]/backups/*):
 * hub-only (all under /api/machines), never on the up-channel table.
 */

import { NextResponse } from "next/server";
import { machinesOn } from "../link/server";
import { isUserPageRequest, requireUser } from "../user-proof";

/** Off with the Labs flag; reading needs the user's own page */
export function ownerRead(request: Request): NextResponse | null {
  if (!machinesOn()) {
    return NextResponse.json(
      { error: "Linked machines are off" },
      { status: 404 }
    );
  }
  return isUserPageRequest(request)
    ? null
    : NextResponse.json({ error: "user_only" }, { status: 403 });
}

/** Changing anything is the user's alone */
export function ownerWrite(request: Request): NextResponse | null {
  if (!machinesOn()) {
    return NextResponse.json(
      { error: "Linked machines are off" },
      { status: 404 }
    );
  }
  const proof = requireUser(request);
  return proof.ok
    ? null
    : NextResponse.json(
        { error: "user_only", reason: proof.reason },
        { status: 403 }
      );
}
