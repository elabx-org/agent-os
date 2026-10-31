import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Session } from "@/lib/db";
import { parseAskScreen } from "@/lib/ask-screen";
import { findTranscript, readTranscriptTail } from "@/lib/claude-transcript";
import { lastTurnContext, type ReplyContext } from "@/lib/reply-context";

// A small tail usually holds the whole last turn; a long one (big tool
// results) gets a second, larger read
const TAILS = [200_000, 1_500_000];
const MAX_CACHED = 50;

/** By transcript file: polled every 2s while typing, mostly unchanged */
const cache = new Map<
  string,
  { size: number; mtimeMs: number; context: ReplyContext | null }
>();

function readContext(file: string, cwd: string): ReplyContext | null {
  const { size, mtimeMs } = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.context;

  let context: ReplyContext | null = null;
  for (const bytes of TAILS) {
    const { items, whole } = readTranscriptTail(file, cwd, bytes);
    context = lastTurnContext(items);
    // Your last message is in it (or it's the whole file): the turn is whole
    if (whole || items.some((i) => i.kind === "user")) break;
  }
  cache.delete(file);
  cache.set(file, { size, mtimeMs, context });
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return context;
}

/** The context of a Claude session's last turn, from its transcript (null
 * for other agents or when there's no transcript); throws on a read error */
export async function sessionReplyContext(
  session: Session
): Promise<ReplyContext | null> {
  if (session.agent_type && session.agent_type !== "claude") return null;
  const found = await findTranscript(
    session.tmux_name || `claude-${session.id}`
  );
  if (!found?.file) return null;
  const context = readContext(found.file, found.cwd);
  if (context?.kind !== "ask" || !context.questions?.length) return context;
  // Whether Claude's question screen is up now: the answer card's cue
  return { ...context, onScreen: await askOnScreen(session) };
}

const execFileAsync = promisify(execFile);

async function askOnScreen(session: Session): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "capture-pane",
      "-p",
      "-t",
      session.tmux_name || `claude-${session.id}`,
    ]);
    return parseAskScreen(stdout.split("\n")) !== null;
  } catch {
    return false;
  }
}
