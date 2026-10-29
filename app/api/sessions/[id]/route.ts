import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";
import { deleteWorktree, isAgentOSWorktree } from "@/lib/worktrees";
import { releasePort } from "@/lib/ports";
import { killWorker } from "@/lib/orchestration";
import { runInBackground } from "@/lib/async-operations";
import { clearQueue } from "@/lib/queue/store";
import { forgetSessionSummary } from "@/lib/session-summaries";
import { pruneSessionTurns } from "@/lib/turns";
import { reviewStore } from "@/lib/review-comments";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/sessions/[id] - Get single session
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error("Error fetching session:", error);
    return NextResponse.json(
      { error: "Failed to fetch session" },
      { status: 500 }
    );
  }
}

// PATCH /api/sessions/[id] - Update session
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const existing = queries.getSession(db).get(id) as Session | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: unknown[] = [];

    // A rename is only the label: the tmux session keeps its
    // <agent>-<id> name, which status, alerts and the Inbox look for, and
    // a worktree keeps its branch
    if (body.name !== undefined && body.name !== existing.name) {
      updates.push("name = ?");
      values.push(body.name);
    }
    if (body.status !== undefined) {
      updates.push("status = ?");
      values.push(body.status);
    }
    if (body.workingDirectory !== undefined) {
      updates.push("working_directory = ?");
      values.push(body.workingDirectory);
    }
    if (body.systemPrompt !== undefined) {
      updates.push("system_prompt = ?");
      values.push(body.systemPrompt);
    }
    if (body.groupPath !== undefined) {
      updates.push("group_path = ?");
      values.push(body.groupPath);
    }
    if (body.projectId !== undefined) {
      updates.push("project_id = ?");
      values.push(body.projectId);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);

      db.prepare(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`).run(
        ...values
      );
    }

    // Pinned last in its project; a pinned session moved to another project
    // goes to the end of that project's pins
    const projectChanged =
      body.projectId !== undefined && body.projectId !== existing.project_id;
    if (
      body.pinned === true ||
      (projectChanged &&
        existing.pinned_order !== null &&
        body.pinned !== false)
    ) {
      const projectId =
        body.projectId !== undefined ? body.projectId : existing.project_id;
      queries.pinSessionLast(db).run(projectId, id, id);
    } else if (body.pinned === false) {
      queries.unpinSession(db).run(id);
    }

    const session = queries.getSession(db).get(id) as Session;
    return NextResponse.json({ session });
  } catch (error) {
    console.error("Error updating session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}

/**
 * Its queued messages, review comments, turn rows and snapshot refs (in the
 * background)
 */
function dropSessionData(session: Session) {
  try {
    clearQueue(session.id);
  } catch (error) {
    console.error(`Failed to clear the queue of ${session.id}:`, error);
  }
  try {
    reviewStore().removeSession(session.id);
  } catch (error) {
    console.error(`Failed to drop the comments of ${session.id}:`, error);
  }
  try {
    forgetSessionSummary(session.id);
  } catch (error) {
    console.error(`Failed to drop the summary of ${session.id}:`, error);
  }
  pruneSessionTurns(session).catch((error) =>
    console.error(`Failed to prune the turns of ${session.id}:`, error)
  );
}

// DELETE /api/sessions/[id] - Delete session
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();

    const existing = queries.getSession(db).get(id) as Session | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // If this is a conductor, delete all its workers first
    const workers = queries.getWorkersByConductor(db).all(id) as Session[];
    for (const worker of workers) {
      try {
        await killWorker(worker.id, false); // false = don't cleanup worktree yet
      } catch (error) {
        console.error(`Failed to kill worker ${worker.id}:`, error);
      }
      queries.detachForks(db).run(worker.id);
      queries.deleteSession(db).run(worker.id);
      dropSessionData(worker);
    }

    // Release port if this session had one assigned
    if (existing.dev_server_port) {
      releasePort(id);
    }

    // Delete from database immediately for instant UI feedback
    queries.detachForks(db).run(id);
    queries.deleteSession(db).run(id);
    queries.deleteDraft(db).run(id);
    dropSessionData(existing);

    // Clean up worktree in background (non-blocking)
    if (existing.worktree_path && isAgentOSWorktree(existing.worktree_path)) {
      const worktreePath = existing.worktree_path; // Capture for closure
      runInBackground(async () => {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);

        const { stdout } = await execAsync(
          `git -C "${worktreePath}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo ""`,
          { timeout: 5000 }
        );
        const gitCommonDir = stdout.trim().replace(/\/.git$/, "");

        if (gitCommonDir) {
          await deleteWorktree(worktreePath, gitCommonDir, false);
        }
      }, `cleanup-worktree-${id}`);
    }

    // Also cleanup worker worktrees in background
    if (workers.length > 0) {
      for (const worker of workers) {
        if (worker.worktree_path && isAgentOSWorktree(worker.worktree_path)) {
          const worktreePath = worker.worktree_path; // Capture for closure
          const workerId = worker.id; // Capture ID for task name
          runInBackground(async () => {
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(exec);

            const { stdout } = await execAsync(
              `git -C "${worktreePath}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo ""`,
              { timeout: 5000 }
            );
            const gitCommonDir = stdout.trim().replace(/\/.git$/, "");

            if (gitCommonDir) {
              await deleteWorktree(worktreePath, gitCommonDir, false);
            }
          }, `cleanup-worker-worktree-${workerId}`);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting session:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
