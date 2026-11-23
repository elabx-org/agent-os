import { jobFailed, jobId, jobJson, notFromHub } from "@/lib/jobs/inbox";
import { startJob } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ job: string }> };

// POST /api/link/inbox/job/[job]/start - its code is here: make the folder
// and start its session. Answers at once; GET the job to follow it
export async function POST(request: Request, { params }: Context) {
  const no = notFromHub(request);
  if (no) return no;
  const id = jobId((await params).job);
  if (!id) return jobJson({ error: "Not that" }, 400);
  try {
    startJob(id);
    return jobJson({ ok: true });
  } catch (error) {
    return jobFailed(error, "start");
  }
}
