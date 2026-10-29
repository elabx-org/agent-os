import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { getProject } from "@/lib/projects";
import { userOnly } from "@/lib/permission-guard";
import { recordRefusal } from "@/lib/agent-actions";
import { requireUser } from "@/lib/user-proof";
import {
  expandHome,
  isConfigTrusted,
  readProjectConfig,
  seedInitialTrust,
  type UntrustedConfigError,
} from "@/lib/project-config";
import { startScriptRun } from "@/lib/script-runs";
import { findNativeWorktree } from "@/lib/env-setup";
import { getProviderDefinition } from "@/lib/providers/registry";

// POST /api/projects/[id]/scripts/[scriptId]/run {sessionId?} -
// RunScriptResponse; requireUser; 409 UntrustedConfigError until the hash
// is approved. A terminal script with a session gets the line for its shell
// drawer; anything else runs in the background with a log
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; scriptId: string }> }
) {
  const { id, scriptId } = await params;
  const body = await request.json().catch(() => ({}));
  const sessionId =
    typeof body?.sessionId === "string" && body.sessionId
      ? (body.sessionId as string)
      : undefined;

  const proof = requireUser(request);
  if (!proof.ok) {
    if (sessionId) {
      recordRefusal(request, {
        targetSessionId: sessionId,
        action: "send_keys",
        detail: `Run script ${scriptId}`,
      });
    }
    return userOnly(proof.reason);
  }

  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.is_uncategorized) {
    return NextResponse.json(
      { error: "Uncategorized has no scripts" },
      { status: 400 }
    );
  }

  let session: Session | undefined;
  if (sessionId) {
    session = queries.getSession(getDb()).get(sessionId) as Session | undefined;
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
  }

  await seedInitialTrust();
  const read = await readProjectConfig(project.working_directory);
  const script = read.effective.scripts?.find((s) => s.id === scriptId);
  if (!script) {
    return NextResponse.json({ error: "Script not found" }, { status: 404 });
  }
  if (!isConfigTrusted(id, read)) {
    const untrusted: UntrustedConfigError = {
      error: "untrusted",
      hash: read.hash,
    };
    return NextResponse.json(untrusted, { status: 409 });
  }

  let cwd = expandHome(
    session?.worktree_path ||
      session?.working_directory ||
      project.working_directory
  );
  // A native --worktree session (Claude) keeps the project root as its
  // folder; its scripts belong in the worktree the CLI made, never the
  // main checkout
  if (
    session &&
    !session.worktree_path &&
    session.branch_name &&
    getProviderDefinition(session.agent_type).worktreeFlag
  ) {
    const created = Date.parse(`${session.created_at.replace(" ", "T")}Z`);
    const found = await findNativeWorktree(
      session.working_directory,
      session.branch_name,
      Number.isNaN(created) ? Date.now() : created - 5000
    );
    if (!found) {
      return NextResponse.json(
        {
          error:
            "This session's worktree isn't there yet, so the script would run in the main checkout. Try again once the session has started.",
        },
        { status: 409 }
      );
    }
    cwd = found;
  }
  try {
    return NextResponse.json(
      await startScriptRun({ projectId: id, cwd, script, sessionId })
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
