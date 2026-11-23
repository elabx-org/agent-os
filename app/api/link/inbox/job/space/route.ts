import { jobFailed, jobJson, notFromHub } from "@/lib/jobs/inbox";
import { clearCache, jobSpace } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

// GET /api/link/inbox/job/space - the space jobs take on this machine
export async function GET(request: Request) {
  const no = notFromHub(request);
  if (no) return no;
  try {
    return jobJson(await jobSpace());
  } catch (error) {
    return jobFailed(error, "space");
  }
}

// DELETE /api/link/inbox/job/space[?cache=name] - clears the build output
// kept for one project, or for all. The hub asks only when its user did
export async function DELETE(request: Request) {
  const no = notFromHub(request);
  if (no) return no;
  const name = new URL(request.url).searchParams.get("cache");
  try {
    return (await clearCache(name))
      ? jobJson({ ok: true })
      : jobJson({ error: "A job is using it right now." }, 409);
  } catch (error) {
    return jobFailed(error, "clear");
  }
}
