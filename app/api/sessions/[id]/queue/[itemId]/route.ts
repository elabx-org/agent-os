import { NextResponse } from "next/server";

// M2 contract: PATCH EditQueueItemRequest -> EditQueueItemResult; DELETE cancels (or drops the undo notice) -> {ok: true}. U2.1

export async function PATCH() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
