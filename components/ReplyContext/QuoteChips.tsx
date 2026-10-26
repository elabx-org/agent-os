"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { stripMarkdown } from "@/lib/reply-context";
import { removeQuote, useQuotes } from "@/stores/replyQuotes";

const NOTE_SEEN_KEY = "agentos-quote-note-seen";

/** A quote as it reads (it's sent as Markdown): a code block keeps its code */
function chipText(text: string): string {
  const plain = stripMarkdown(text).join(" ");
  return (
    plain ||
    text
      .replace(/^`{3,}.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function noteSeen(): boolean {
  try {
    return localStorage.getItem(NOTE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The passages picked with "Reply to this", each removable, above the box.
 * The first time, a line says how they go out.
 */
export function QuoteChips({
  sessionId,
  className,
}: {
  sessionId: string | null | undefined;
  className?: string;
}) {
  const quotes = useQuotes(sessionId);
  const [showNote, setShowNote] = useState(false);
  useEffect(() => setShowNote(!noteSeen()), []);
  // Seen once the first quotes have gone (sent or removed)
  const had = useRef(false);
  useEffect(() => {
    if (quotes.length) had.current = true;
    else if (had.current && showNote) {
      setShowNote(false);
      try {
        localStorage.setItem(NOTE_SEEN_KEY, "1");
      } catch {}
    }
  }, [quotes.length, showNote]);

  if (!sessionId || !quotes.length) return null;

  return (
    <div
      className={cn("flex flex-col gap-1 px-1 pb-1.5", className)}
      // Keeps the box focused, so the keyboard stays up
      onMouseDown={(e) => e.preventDefault()}
    >
      {quotes.map((quote) => (
        <div
          key={quote.id}
          className="bg-secondary text-muted-foreground animate-in fade-in flex h-8 min-w-0 items-center gap-2 rounded-full pr-1 pl-3 text-[12px] duration-150"
        >
          <span aria-hidden="true" className="shrink-0 text-[13px]">
            ❝
          </span>
          <span className="min-w-0 flex-1 truncate">
            {chipText(quote.text)}
          </span>
          <button
            type="button"
            onClick={() => removeQuote(sessionId, quote.id)}
            aria-label="Remove this quote"
            className="hover:text-foreground relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full after:absolute after:-inset-2.5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {showNote && (
        <p className="text-muted-foreground px-2 text-[11px]">
          Sends as &ldquo;&gt; quoted text&rdquo;, then your reply
        </p>
      )}
    </div>
  );
}
