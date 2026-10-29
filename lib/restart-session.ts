"use client";

import { toast } from "sonner";
import { confirmAction } from "@/components/ui/confirm";
import type { Session } from "@/lib/db";

/**
 * Restart a Claude session with its conversation resumed, so it picks up
 * what it reads at start (the project note, a pending permission mode).
 * The page re-attaches it. `whenIdle` refuses while Claude is mid-turn.
 */
export async function restartSession(
  session: Session,
  { whenIdle = false, message }: { whenIdle?: boolean; message?: string } = {}
): Promise<void> {
  const ok = await confirmAction({
    title: `Restart ${session.name}?`,
    message:
      message ??
      "Claude stops what it is doing and starts again with the same conversation, picking up the other sessions in its project.",
    confirmLabel: "Restart",
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/sessions/${session.id}/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whenIdle }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Restart failed");
    window.dispatchEvent(
      new CustomEvent("agentos-session-restarted", {
        detail: { session: data.session },
      })
    );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Restart failed");
  }
}
