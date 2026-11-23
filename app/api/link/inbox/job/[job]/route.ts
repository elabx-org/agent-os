import { jobFailed, jobId, jobJson, notFromHub } from "@/lib/jobs/inbox";
import { jobReport, stopJob } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ job: string }> };

// GET /api/link/inbox/job/[job] - how the job is doing (JobReport)
export async function GET(request: Request, { params }: Context) {
  const no = notFromHub(request);
  if (no) return no;
  const id = jobId((await params).job);
  try {
    const report = id ? await jobReport(id) : null;
    return report ? jobJson(report) : jobJson({ error: "No such job" }, 404);
  } catch (error) {
    return jobFailed(error, "report");
  }
}

// DELETE /api/link/inbox/job/[job] - stopped: its session and folder go
export async function DELETE(request: Request, { params }: Context) {
  const no = notFromHub(request);
  if (no) return no;
  const id = jobId((await params).job);
  try {
    return id && (await stopJob(id))
      ? jobJson({ ok: true })
      : jobJson({ error: "No such job" }, 404);
  } catch (error) {
    return jobFailed(error, "stop");
  }
}
