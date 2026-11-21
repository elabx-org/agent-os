import { backupFailed, backupJson, backupMachine } from "@/lib/backup/inbox";
import { receiveBundle } from "@/lib/backup/receive";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ session: string }> };

// PUT /api/link/inbox/backup/[session]/bundle?backup= - the copy's code as a
// git bundle, checked object by object; kept aside until commit
export async function PUT(request: Request, { params }: Context) {
  const link = backupMachine(request);
  if (!link.ok) return link.response;
  const { session } = await params;
  const backup = new URL(request.url).searchParams.get("backup");
  try {
    return backupJson(
      await receiveBundle(link.machine, session, backup, request.body)
    );
  } catch (error) {
    return backupFailed(error, "bundle");
  }
}
