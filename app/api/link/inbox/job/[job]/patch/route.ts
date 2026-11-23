import { Readable } from "stream";
import { jobId, jobJson, notFromHub } from "@/lib/jobs/inbox";
import { jobPatch } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ job: string }> };

// GET /api/link/inbox/job/[job]/patch - what the job changed in its copy of
// the code, as a patch the chat can apply
export async function GET(request: Request, { params }: Context) {
  const no = notFromHub(request);
  if (no) return no;
  const id = jobId((await params).job);
  const patch = id ? jobPatch(id) : null;
  if (!patch) return jobJson({ error: "No patch" }, 404);
  return new Response(Readable.toWeb(patch) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
