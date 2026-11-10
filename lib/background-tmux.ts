/**
 * A background agent opened in a terminal runs in a tmux session of its
 * own, so the tab can name it and attach it again after a reload, as it
 * does a session (otherwise the reload attached the session the tab had
 * before)
 */

const PREFIX = "bg-";
const AGENT_ID = /^\w[\w-]*$/;

export function backgroundTmuxName(agentId: string): string {
  return `${PREFIX}${agentId}`;
}

/** The background agent a tab's tmux shows, or null */
export function backgroundAgentOfTmux(
  tmuxName: string | null | undefined
): string | null {
  if (!tmuxName?.startsWith(PREFIX)) return null;
  const id = tmuxName.slice(PREFIX.length);
  return AGENT_ID.test(id) ? id : null;
}

/**
 * Attach its tmux, or start one running `claude attach` (it ends when
 * that does). PATH goes in: tmux's server may not have ~/.local/bin
 */
export function attachBackgroundCommand(agentId: string): string {
  if (!AGENT_ID.test(agentId)) throw new Error("Not an agent id");
  const name = backgroundTmuxName(agentId);
  return `tmux attach -t ${name} 2>/dev/null || tmux new -s ${name} "export PATH='$PATH'; exec claude attach ${agentId}"`;
}

/**
 * A tab showing a background agent belongs to no session. Tabs from before
 * agents had tabs of their own kept the session they replaced, so the
 * composer sent to that session's queue instead of the agent
 */
export function clearBackgroundSession<
  T extends { sessionId: string | null; attachedTmux: string | null },
>(tab: T): T {
  if (!tab.sessionId || !backgroundAgentOfTmux(tab.attachedTmux)) return tab;
  return { ...tab, sessionId: null };
}
