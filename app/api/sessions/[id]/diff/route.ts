import { NextResponse } from "next/server";

// M2 contract: GET ?scope=turn:<n>|branch|uncommitted&file= -> SessionDiff. U2.2

export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
