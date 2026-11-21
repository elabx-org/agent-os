import { backupFailed, backupJson, backupMachine } from "@/lib/backup/inbox";
import { takenHeld } from "@/lib/backup/receive";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ session: string }> };

// GET /api/link/inbox/taken/[session] - {held}: whether this server still
// has the session it continued from that machine's copy. Only then may the
// machine run its own copy again
export async function GET(request: Request, { params }: Context) {
  const link = backupMachine(request);
  if (!link.ok) return link.response;
  const { session } = await params;
  try {
    return backupJson(takenHeld(link.machine, session));
  } catch (error) {
    return backupFailed(error, "taken");
  }
}
