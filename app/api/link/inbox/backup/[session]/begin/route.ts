import {
  backupFailed,
  backupJson,
  backupMachine,
  jsonBody,
} from "@/lib/backup/inbox";
import { beginBackup } from "@/lib/backup/receive";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ session: string }> };

// POST /api/link/inbox/backup/[session]/begin BackupBegin - BackupPlan: what
// this server's copy holds, and a new upload id. 409 taken (with what to
// pause) when this server has the session itself
export async function POST(request: Request, { params }: Context) {
  const link = backupMachine(request);
  if (!link.ok) return link.response;
  const { session } = await params;
  try {
    return backupJson(
      await beginBackup(link.machine, session, await jsonBody(request))
    );
  } catch (error) {
    return backupFailed(error, "begin");
  }
}
