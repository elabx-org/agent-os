import { NextResponse } from "next/server";

// M2 contract: POST UndoRequest -> UndoResult; requireUser, 409 while busy. U2.2

export async function POST() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
