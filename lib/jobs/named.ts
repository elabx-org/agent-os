/**
 * Whether the user themselves named the machine: their last message in the
 * sending chat has "@" and the machine's name. Read from the chat's own
 * transcript, so a job's card never says "you named it" on the chat's
 * word alone. Server only.
 */

import { getDb, queries, type Session } from "../db";
import { findTranscript, readTranscriptTail } from "../claude-transcript";
import { findMachine } from "./hub";
import { namesMachine } from "./types";

// The user's message is usually near the end; a long turn gets a larger read
const TAILS = [200_000, 1_500_000];

export async function userNamedMachine(
  sessionId: string,
  machine: string
): Promise<boolean> {
  try {
    const session =
      (queries.getSession(getDb()).get(sessionId) as Session | undefined) ??
      null;
    const row = findMachine(machine);
    if (!session || !row) return false;
    const found = await findTranscript(
      session.tmux_name || `claude-${session.id}`
    );
    if (!found?.file) return false;
    for (const bytes of TAILS) {
      const { items, whole } = readTranscriptTail(found.file, found.cwd, bytes);
      const last = items.filter((i) => i.kind === "user").pop();
      if (last?.kind === "user") return namesMachine(last.text, row.name);
      if (whole) return false;
    }
    return false;
  } catch {
    return false;
  }
}
