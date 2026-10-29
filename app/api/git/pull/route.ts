import { NextResponse } from "next/server";

// M2b contract (U2b.1). POST /api/git/pull {path} -> PullResponse: fast-forward from the upstream
// (E-Git's column Pull); refused when it would need a merge
export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
