/**
 * Requests from agents driving Agent-OS (the MCP server, scripts/agentos-mcp.mjs)
 * carry this header. Permission decisions stay with the user: agent-origin
 * requests can answer a question but not a permission request, and can't
 * start sessions that skip permission prompts.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import type { NextRequest } from "next/server";
import type { Session } from "@/lib/db";
import {
  parsePermissionPrompt,
  type PermissionPrompt,
} from "@/lib/permission-prompt";
import { mergePrompt, type ReplyContext } from "@/lib/reply-context";
import { sessionReplyContext } from "@/lib/session-reply-context";

const execFileAsync = promisify(execFile);

export const AGENT_ORIGIN_HEADER = "x-agentos-origin";

export const PERMISSION_USER_ONLY =
  "Permission requests can only be answered by the user in Agent-OS. Ask the user.";

export function isAgentOrigin(request: NextRequest): boolean {
  return request.headers.get(AGENT_ORIGIN_HEADER)?.toLowerCase() === "agent";
}

/**
 * Whether the prompt on screen is a question an agent may answer: only a
 * pending AskUserQuestion, as the Needs you card classifies it (mergePrompt).
 * Anything else, or anything unclear, is treated as a permission request.
 */
export function isAnswerableQuestion(
  merged: ReplyContext | null,
  prompt: PermissionPrompt
): boolean {
  if (merged?.kind !== "ask" || merged.toolName !== "AskUserQuestion")
    return false;
  // Permission dialogs offer "Yes, and don't ask again"; a question doesn't
  return !prompt.options.some((o) => o.kind === "always");
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
