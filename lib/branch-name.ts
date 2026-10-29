/**
 * The Own worktree branch New suggests from the task (E-New, D-New):
 * "Make the half-folded state line open the live activity" →
 * "fix/deck-live-activity"-shaped `<kind>/<three or four words>`. Client
 * safe (lib/git.ts runs git, so it can't be imported by the form). M1b
 * U1b.3 implements it.
 */

/** The branch kinds a task can read as; "feat" when nothing says otherwise */
export type BranchKind = "fix" | "feat" | "chore" | "docs" | "refactor";

/** A branch name for the task, or "" when the task is empty */
export function branchFromTask(task: string): string {
  void task;
  return "";
}
