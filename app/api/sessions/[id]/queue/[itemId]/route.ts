import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { recordRefusal } from "@/lib/agent-actions";
import { requester, userOnly } from "@/lib/permission-guard";
import { cancelItem, editItem, queueStore } from "@/lib/queue/store";
import type {
  EditQueueItemRequest,
  EditQueueItemResult,
  QueueItem,
} from "@/lib/queue/types";

const MAX_TEXT = 100_000;

type Params = { params: Promise<{ id: string; itemId: string }> };

/**
 * The session's item, or the response that says why not. Only the user
 * changes what the user queued
 */
async function findItem(
  request: NextRequest,
  params: Params["params"],
  detail: string
): Promise<{ item: QueueItem } | { refuse: NextResponse }> {
  const { id, itemId } = await params;
  const itemNo = Number(itemId);
  const session = queries.getSession(getDb()).get(id) as Session | undefined;
  const item =
    session && Number.isSafeInteger(itemNo) && itemNo > 0
      ? queueStore().getItem(id, itemNo)
      : null;
  if (!item) {
    return {
      refuse: NextResponse.json(
        { error: "Queued item not found" },
        { status: 404 }
      ),
    };
  }
  const who = requester(request);
  if (who.by !== "user" && item.origin !== "agent") {
    recordRefusal(request, {
      targetSessionId: id,
      action: "send_keys",
      detail,
    });
    return { refuse: userOnly(who.reason) };
  }
  if (item.status !== "pending") {
    return {
      refuse: NextResponse.json(
        { error: "Already sent or cancelled" },
        { status: 409 }
      ),
    };
  }
  return { item };
}

// PATCH /api/sessions/[id]/queue/[itemId] {text?, position?} -
// EditQueueItemResult. Only while pending; position is 1-based among the
// pending items
export async function PATCH(request: NextRequest, { params }: Params) {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const patch: EditQueueItemRequest = {};
  if (body && body.text !== undefined) {
    if (
      typeof body.text !== "string" ||
      !body.text.trim() ||
      body.text.length > MAX_TEXT
    ) {
      return NextResponse.json({ error: "Invalid text" }, { status: 400 });
    }
    patch.text = body.text;
  }
  if (body && body.position !== undefined) {
    if (!Number.isInteger(body.position) || (body.position as number) < 1) {
      return NextResponse.json({ error: "Invalid position" }, { status: 400 });
    }
    patch.position = body.position as number;
  }
  if (patch.text === undefined && patch.position === undefined) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const found = await findItem(request, params, "Edit a queued message");
  if ("refuse" in found) return found.refuse;
  const { item } = found;
  if (item.kind === "undo_notice") {
    return NextResponse.json(
      { error: "The undo notice can only be dropped" },
      { status: 400 }
    );
  }
  const edited = editItem(item.sessionId, item.id, patch);
  if (!edited) {
    return NextResponse.json(
      { error: "Already sent or cancelled" },
      { status: 409 }
    );
  }
  const result: EditQueueItemResult = { item: edited };
  return NextResponse.json(result);
}

// DELETE /api/sessions/[id]/queue/[itemId] - {ok: true}: cancels a pending
// item, or drops the undo notice
export async function DELETE(request: NextRequest, { params }: Params) {
  const found = await findItem(request, params, "Cancel a queued message");
  if ("refuse" in found) return found.refuse;
  const { item } = found;
  if (!cancelItem(item.sessionId, item.id)) {
    return NextResponse.json(
      { error: "Already sent or cancelled" },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
