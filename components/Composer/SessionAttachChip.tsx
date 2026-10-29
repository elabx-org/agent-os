"use client";

import { AtSign, X } from "lucide-react";
import type { AttachedSession } from "@/lib/session-attach-types";

/** N-Attach chip in the composer's attachments row: "@ Name (summary) ×" */
export interface SessionAttachChipProps {
  session: AttachedSession;
  onRemove: (sessionId: string) => void;
}

export function SessionAttachChip({
  session,
  onRemove,
}: SessionAttachChipProps) {
  return (
    <span
      data-session-chip={session.sessionId}
      className="inline-flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[rgba(124,58,237,0.3)] bg-[rgba(124,58,237,0.12)] pr-0.5 pl-2.5 text-[13px] text-[#6D28D9] dark:border-[rgba(167,139,250,0.35)] dark:bg-[rgba(124,58,237,0.18)] dark:text-[#DDD6FE]"
    >
      <AtSign className="h-3.5 w-3.5 flex-none" aria-hidden />
      <span className="min-w-0 truncate">{session.name} (summary)</span>
      <button
        type="button"
        // Keep the keyboard up
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onRemove(session.sessionId)}
        aria-label={`Remove ${session.name}`}
        className="relative flex h-8 w-8 flex-none items-center justify-center rounded-full after:absolute after:-inset-1.5 after:content-[''] active:bg-[rgba(124,58,237,0.2)]"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
