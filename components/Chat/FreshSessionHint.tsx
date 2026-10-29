"use client";

import type { Session } from "@/lib/db";

/** An empty fresh session's chat: "Claude is ready in agent-os. Say what
    to do." (N-BgSend), in place of "No conversation found" */
export function FreshSessionHint(_props: { session: Session }) {
  return null;
}
