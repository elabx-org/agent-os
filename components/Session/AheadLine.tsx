"use client";

import { Laptop } from "lucide-react";
import type { Session } from "@/lib/db";
import { parseMovedFrom } from "@/lib/session-move-types";

/**
 * Above the composer of a session continued here from a linked machine's
 * copy, once that machine said it did more after the copy (lib/backup)
 */
export function AheadLine({ session }: { session: Session }) {
  const from = parseMovedFrom(session.moved_from);
  const ahead = from?.takeId ? from.ahead : undefined;
  if (!from || !ahead || !(ahead.conversation || ahead.code)) return null;
  const folder = ahead.folder?.replace(/^\/(Users|home)\/[^/]+/, "~");
  return (
    <p
      role="status"
      className="text-muted-foreground flex items-start gap-2 px-3 pb-1.5 text-[13px]"
    >
      <Laptop className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <span className="min-w-0 flex-1 break-words">
        {from.name} did more on this after the copy was made. That work is still
        on {from.name}
        {folder ? `, in ${folder}` : ""}.
      </span>
    </p>
  );
}
