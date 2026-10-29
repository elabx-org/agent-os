import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { getProject } from "@/lib/projects";
import { expandPath } from "@/lib/git-status";
import { createPR, getPRForBranch, isGhReady } from "@/lib/pr";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Where the session's branch lives: its worktree, else (a native worktree
 * session, which only records the branch) its own folder or its project's
 */
function branchCwd(session: Session): string | null {
  if (!session.branch_name) return null;
  if (session.worktree_path) return session.worktree_path;
  const dir =
    session.working_directory ||
    (session.project_id
      ? getProject(session.project_id)?.working_directory
      : "");
  return dir ? expandPath(dir) : null;
}

const GH_MISSING =
  "GitHub CLI not installed or not authenticated. Run 'gh auth login' first.";

// GET /api/sessions/[id]/pr - Get PR info for session
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = branchCwd(session);
    if (!cwd || !session.branch_name) {
      return NextResponse.json(
        { error: "Session is not a worktree session" },
        { status: 400 }
      );
    }

    if (!(await isGhReady())) {
      return NextResponse.json({ error: GH_MISSING }, { status: 400 });
    }

    const pr = await getPRForBranch(cwd, session.branch_name);

    // Update session with PR info if found (SessionCard reads it lowercase)
    if (pr) {
      queries.updateSessionPR(db).run(pr.url, pr.number, pr.state, id);
    }

    return NextResponse.json({ pr });
  } catch (error) {
    console.error("Error fetching PR:", error);
    return NextResponse.json(
      { error: "Failed to fetch PR info" },
      { status: 500 }
    );
  }
}

// POST /api/sessions/[id]/pr - Create PR for session
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description } = body;

    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = branchCwd(session);
    if (!cwd || !session.branch_name) {
      return NextResponse.json(
        { error: "Session is not a worktree session" },
        { status: 400 }
      );
    }

    if (!(await isGhReady())) {
      return NextResponse.json({ error: GH_MISSING }, { status: 400 });
    }

    // Check if PR already exists (a merged or closed one gets a new PR)
    const existingPR = await getPRForBranch(cwd, session.branch_name);
    if (existingPR?.state === "open") {
      return NextResponse.json(
        { error: "PR already exists for this branch", pr: existingPR },
        { status: 409 }
      );
    }

    // Create PR
    const prTitle = title || session.name;
    const pr = await createPR(
      cwd,
      session.branch_name,
      session.base_branch || "main",
      prTitle,
      description || ""
    );

    // Save PR info to session
    queries
      .updateSessionPR(db)
      .run(pr.url, pr.number, pr.state.toLowerCase(), id);

    return NextResponse.json({ pr }, { status: 201 });
  } catch (error) {
    console.error("Error creating PR:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create PR: ${message}` },
      { status: 500 }
    );
  }
}
