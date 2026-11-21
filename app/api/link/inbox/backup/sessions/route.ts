import {
  backupFailed,
  backupJson,
  backupMachine,
  jsonBody,
} from "@/lib/backup/inbox";
import { syncSessions } from "@/lib/backup/receive";

export const dynamic = "force-dynamic";

// POST /api/link/inbox/backup/sessions {ids} - a linked machine's AgentOS
// names the sessions it still has; copies of the others go. Through the
// link only (lib/backup/inbox.ts)
export async function POST(request: Request) {
  const link = backupMachine(request);
  if (!link.ok) return link.response;
  try {
    return backupJson(
      await syncSessions(link.machine, await jsonBody(request))
    );
  } catch (error) {
    return backupFailed(error, "sessions");
  }
}
