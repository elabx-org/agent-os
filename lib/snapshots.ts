/**
 * Hidden git snapshots of a working tree: a private index under
 * $(git rev-parse --git-path agent-os), `add -A`, `write-tree`,
 * `commit-tree`, `update-ref refs/agent-os/<sessionId>/t<N>-pre|post`.
 * Never touches HEAD, the user's index, stash or branches.
 */

// M2 contract: signatures only; U2.2 implements them

export type SnapshotPoint = "pre" | "post";

/** The ref written, or null for a non-git folder or on failure/timeout */
export async function snapshot(
  _cwd: string,
  _sessionId: string,
  _turnNo: number,
  _point: SnapshotPoint,
  _options: { timeoutMs?: number } = {}
): Promise<string | null> {
  return null;
}
