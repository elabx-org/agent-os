/**
 * Requests from agents driving Agent-OS (the MCP server, scripts/agentos-mcp.mjs)
 * carry this header. Permission decisions stay with the user: agent-origin
 * requests can answer a question but not a permission request, and can't
 * start sessions that skip permission prompts.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { Session } from "@/lib/db";
import {
  parsePermissionPrompt,
  type PermissionPrompt,
} from "@/lib/permission-prompt";
import { isAnswerableQuestion } from "@/lib/permission-card";
import { mergePrompt, type ReplyContext } from "@/lib/reply-context";
import { sessionReplyContext } from "@/lib/session-reply-context";

const execFileAsync = promisify(execFile);

// One rule for the card and the guard
export { isAnswerableQuestion };

export const AGENT_ORIGIN_HEADER = "x-agentos-origin";

export const PERMISSION_USER_ONLY =
  "Permission requests can only be answered by the user in Agent-OS. Ask the user.";

/** The refusal a tab from before a deploy shows (no cookie from this boot) */
export const PERMISSION_RELOAD =
  "Agent-OS was updated. Reload it to answer this; permission requests are the user's.";

export function isAgentOrigin(request: Request): boolean {
  return request.headers.get(AGENT_ORIGIN_HEADER)?.toLowerCase() === "agent";
}

/** The selection prompt on a tmux pane, if any; throws if it isn't running */
export async function readScreenPrompt(
  target: string
): Promise<PermissionPrompt | null> {
  const [{ stdout: pane }, { stdout: width }] = await Promise.all([
    execFileAsync("tmux", ["capture-pane", "-t", target, "-p"]),
    execFileAsync("tmux", [
      "display-message",
      "-t",
      target,
      "-p",
      "#{pane_width}",
    ]),
  ]);
  return parsePermissionPrompt(pane.split("\n"), Number(width) || 80);
}

/** Whether an agent may answer this prompt in this session (fails closed) */
export async function agentMayAnswer(
  session: Session,
  prompt: PermissionPrompt
): Promise<boolean> {
  let context: ReplyContext | null = null;
  try {
    context = await sessionReplyContext(session);
  } catch {
    return false;
  }
  return isAnswerableQuestion(mergePrompt(context, prompt), prompt);
}
