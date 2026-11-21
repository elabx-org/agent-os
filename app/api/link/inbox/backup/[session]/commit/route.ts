import {
  backupFailed,
  backupJson,
  backupMachine,
  jsonBody,
} from "@/lib/backup/inbox";
import { commitBackup } from "@/lib/backup/receive";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ session: string }> };

// POST /api/link/inbox/backup/[session]/commit {backupId, manifest} - the
// copy changes to what this upload sent. 409 missing_code, stale, mismatch
export async function POST(request: Request, { params }: Context) {
  const link = backupMachine(request);
  if (!link.ok) return link.response;
  const { session } = await params;
  try {
    return backupJson(
      await commitBackup(link.machine, session, await jsonBody(request))
    );
  } catch (error) {
    return backupFailed(error, "commit");
  }
}
