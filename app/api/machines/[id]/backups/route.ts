import { NextResponse } from "next/server";
import { ownerRead, ownerWrite } from "@/lib/backup/owner";
import { backupRows, deleteCopies } from "@/lib/backup/store";
import { copyViews } from "@/lib/backup/views";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// GET /api/machines/[id]/backups - {copies: BackupView[], bytes, unconfirmed}:
// the copies of that machine's sessions kept here. The user's page only
export async function GET(request: Request, { params }: Context) {
  const no = ownerRead(request);
  if (no) return no;
  const { id } = await params;
  return NextResponse.json(await copyViews(id), {
    headers: { "Cache-Control": "no-store" },
  });
}

// DELETE /api/machines/[id]/backups - deletes its copies here. A session
// this server continued that the machine hasn't confirmed pausing stays:
// it is how the machine will be told
export async function DELETE(request: Request, { params }: Context) {
  const no = ownerWrite(request);
  if (no) return no;
  const { id } = await params;
  return NextResponse.json({ removed: await deleteCopies(backupRows(id)) });
}
