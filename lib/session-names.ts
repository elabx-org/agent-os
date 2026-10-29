/**
 * Names AgentOS made up ("Session 24", "Session 24 (fork)"), which a
 * transcript title may replace. Anything else the person chose, so it wins.
 * Shared by the titles route and the client, so no node imports here.
 */
export function isAutoSessionName(name: string): boolean {
  return /^Session \d+( \(fork\))*$/.test(name);
}
