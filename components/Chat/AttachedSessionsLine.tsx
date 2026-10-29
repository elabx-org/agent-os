"use client";

import { AtSign } from "lucide-react";
import { useSessionsQuery } from "@/data/sessions/queries";
import type { SessionAttachmentRef } from "@/lib/session-attach-types";
import { cn } from "@/lib/utils";

/** N-Attach's chip, small: it only shows, so not a 44pt target */
const PILL =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border px-2 text-xs " +
  "border-[#7C3AED]/30 bg-[rgba(124,58,237,.10)] text-[#6D28D9] " +
  "dark:border-[rgba(167,139,250,.35)] dark:bg-[rgba(124,58,237,.18)] dark:text-[#DDD6FE]";

/** "@ Name (summary)": a session that went with a message */
export function AttachedSessionPill({
  name,
  summary = true,
  listItem = true,
}: {
  name: string;
  /** In a role="list" (not inside a button, whose label covers it) */
  listItem?: boolean;
  /** Add "(summary)": the agent got a summary, not the transcript */
  summary?: boolean;
}) {
  return (
    <span className={PILL} role={listItem ? "listitem" : undefined}>
      <AtSign className="h-3 w-3 flex-none" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {name}
        {summary && " (summary)"}
      </span>
    </span>
  );
}

/**
 * The sessions attached to a message the user sent, from its block
 * (splitAttachmentBlock): above the bubble, right-aligned
 */
export function AttachedSessionsLine({
  names,
  className,
}: {
  names: readonly string[];
  className?: string;
}) {
  if (!names.length) return null;
  return (
    <div
      role="list"
      aria-label="Attached sessions, as summaries"
      className={cn("flex max-w-full flex-wrap justify-end gap-1", className)}
    >
      {names.map((name, i) => (
        <AttachedSessionPill key={`${i}-${name}`} name={name} />
      ))}
    </div>
  );
}

/**
 * A queued (or failed) message's attached sessions, by name from the
 * sessions list; one that is gone shows as "a session"
 */
export function QueuedSessionPills({
  refs,
}: {
  refs: readonly SessionAttachmentRef[];
}) {
  const { data } = useSessionsQuery();
  if (!refs.length) return null;
  const names = new Map(data?.sessions.map((s) => [s.id, s.name]) ?? []);
  return (
    // Inside the row's Edit button: shown, the button's label says what it does
    <span className="flex max-w-full flex-wrap gap-1 pt-0.5">
      {refs.map((ref, i) => (
        <AttachedSessionPill
          key={`${i}-${ref.sessionId}`}
          name={names.get(ref.sessionId) || "a session"}
          summary={false}
          listItem={false}
        />
      ))}
    </span>
  );
}
