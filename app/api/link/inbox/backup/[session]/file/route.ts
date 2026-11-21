import { backupFailed, backupJson, backupMachine } from "@/lib/backup/inbox";
import { receiveFile } from "@/lib/backup/receive";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ session: string }> };

// PUT /api/link/inbox/backup/[session]/file?backup=&offset=&reset= - new
// conversation bytes, kept aside until commit. 409 mismatch when offset
// isn't where this server's copy ends
export async function PUT(request: Request, { params }: Context) {
  const link = backupMachine(request);
  if (!link.ok) return link.response;
  const { session } = await params;
  const search = new URL(request.url).searchParams;
  try {
    return backupJson(
      await receiveFile(
        link.machine,
        session,
        {
          backup: search.get("backup"),
          offset: search.get("offset"),
          reset: search.get("reset"),
        },
        request.body
      )
    );
  } catch (error) {
    return backupFailed(error, "file");
  }
}
