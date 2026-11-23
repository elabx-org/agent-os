import { jobFailed, jobId, jobJson, notFromHub } from "@/lib/jobs/inbox";
import { receiveJobBundle } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ job: string }> };

// PUT /api/link/inbox/job/[job]/bundle - the code this machine lacks, as a
// git bundle; checked object by object when the job starts
export async function PUT(request: Request, { params }: Context) {
  const no = notFromHub(request);
  if (no) return no;
  const id = jobId((await params).job);
  if (!id) return jobJson({ error: "Not that" }, 400);
  try {
    await receiveJobBundle(id, request.body);
    return jobJson({ ok: true });
  } catch (error) {
    return jobFailed(error, "bundle");
  }
}
