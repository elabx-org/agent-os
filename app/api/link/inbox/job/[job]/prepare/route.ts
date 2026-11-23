import { jobFailed, jobId, jobJson, notFromHub } from "@/lib/jobs/inbox";
import { cleanPrepare, prepareJob } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ job: string }> };

// POST /api/link/inbox/job/[job]/prepare - the hub is about to send a job:
// what it is and which code it needs. Answers with the commits this machine
// already has, so only the rest is sent. Through the link only
export async function POST(request: Request, { params }: Context) {
  const no = notFromHub(request);
  if (no) return no;
  const id = jobId((await params).job);
  const text = await request.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text.length <= 4 * 1024 * 1024 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const clean = cleanPrepare(body);
  if (!id || !clean) return jobJson({ error: "Not that" }, 400);
  try {
    return jobJson(await prepareJob(id, clean));
  } catch (error) {
    return jobFailed(error, "prepare");
  }
}
