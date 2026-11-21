import { NextResponse } from "next/server";
import { ownerWrite } from "@/lib/backup/owner";
import { backupRow, deleteCopies } from "@/lib/backup/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; session: string }> };

// DELETE /api/machines/[id]/backups/[session] - deletes one copy (not a
// continued one the machine hasn't confirmed pausing)
export async function DELETE(request: Request, { params }: Context) {
  const no = ownerWrite(request);
  if (no) return no;
  const { id, session } = await params;
  const row = backupRow(id, session);
  if (!row) {
    return NextResponse.json(
      { error: "No copy of that session." },
      { status: 404 }
    );
  }
  return NextResponse.json({ removed: await deleteCopies([row]) });
}
