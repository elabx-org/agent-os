import { NextResponse } from "next/server";
import { validCard } from "@/lib/project-move-types";
import { ensureRepository, projectFor } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

// POST /api/projects/adopt - { card, repo: { name, remote } }: sets a
// project from another machine up here when no chat carried its code: in
// the checkout this machine has of that repository, else a clone of it.
// An existing project in that folder is left as it is
export async function POST(request: Request) {
  const no = userOnly(request);
  if (no) return no;
  const body = (await request.json().catch(() => ({}))) as {
    card?: unknown;
    repo?: { name?: unknown; remote?: unknown } | null;
  };
  const name = body.repo?.name;
  const remote = body.repo?.remote;
  if (
    !validCard(body.card) ||
    typeof name !== "string" ||
    name.length > 300 ||
    !(remote === null || (typeof remote === "string" && remote.length <= 2000))
  ) {
    return NextResponse.json({ error: "Which project?" }, { status: 400 });
  }
  if (!remote) {
    return NextResponse.json(
      {
        error:
          "Its repository has no remote, so only a chat can carry the code across. Move a chat from it first",
      },
      { status: 409 }
    );
  }
  try {
    const placed = await ensureRepository(name, remote);
    if (!placed) {
      return NextResponse.json(
        {
          error:
            "This machine couldn't clone the repository (it may not be signed in to git or GitHub here)",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({
      projectId: projectFor(placed.repo, placed.repo, body.card),
      folder: placed.repo,
      mode: placed.mode,
    });
  } catch (error) {
    return moveError(error);
  }
}
