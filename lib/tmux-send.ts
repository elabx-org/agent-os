/**
 * Types text into a session's tmux pane through a named paste buffer, using
 * the session's real tmux name (tmuxNameOf), not `${agent_type}-${id}`.
 */

import type { Session } from "./db";

// M2 contract: signature only; U2.1 implements it

export interface SendTextOptions {
  /** Press Enter after the paste (default true) */
  pressEnter?: boolean;
}

/** Rejects when the tmux session is gone or a tmux command fails */
export async function sendText(
  _session: Session,
  _text: string,
  _options: SendTextOptions = {}
): Promise<void> {
  throw new Error("Not implemented");
}
