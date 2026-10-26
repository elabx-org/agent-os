"use client";

import { History, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { RAINBOW } from "@/lib/magic-words";
import type { ComposerEngine } from "./useComposer";

const CHIP =
  "bg-secondary text-muted-foreground inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[11px] whitespace-nowrap";

interface ComposerChipsProps {
  composer: ComposerEngine;
  /** Offer the history search while the box is empty (no + menu to hold it) */
  historyChip?: boolean;
  className?: string;
}

/**
 * The line of chips above the box: what Claude Code will do with what's
 * typed (bash, memory, magic words) and where a recalled prompt came from.
 * Nothing shows for plain text.
 */
export function ComposerChips({
  composer,
  historyChip,
  className,
}: ComposerChipsProps) {
  const { mode, magic, recalled, historyCount, claude, cwd, display, focused } =
    composer;
  const offerHistory =
    historyChip && claude && !!cwd && focused && display === "";
  if (!mode && !magic.length && recalled < 0 && !offerHistory) return null;

  const openHistory = () => composer.setHistoryOpen(true);

  return (
    <div
      className={cn("flex flex-wrap gap-1.5 px-2 pb-1.5", className)}
      onMouseDown={(e) => e.preventDefault()}
    >
      {mode === "bash" && (
        <span className={cn(CHIP, "bg-[#FD5DB1]/12 text-[#FD5DB1]")}>
          <b className="font-semibold">!</b> Bash · runs in the shell, output
          goes to Claude
        </span>
      )}
      {mode === "memory" && (
        <span className={CHIP}>
          <b className="text-foreground font-semibold">#</b> Memory · adds to
          CLAUDE.md
        </span>
      )}
      {magic.map((w) => (
        <span key={w.word} className={CHIP}>
          <b
            className="bg-clip-text font-semibold text-transparent"
            style={{ backgroundImage: RAINBOW, WebkitBackgroundClip: "text" }}
          >
            {w.word}
          </b>
          · {w.description}
        </span>
      ))}
      {recalled >= 0 && (
        <button type="button" onClick={openHistory} className={CHIP}>
          <History className="h-3 w-3" />
          <b className="text-foreground font-semibold">↑</b> {recalled + 1} of{" "}
          {historyCount} · this project
          <Search className="ml-0.5 h-3 w-3" aria-label="Search" />
        </button>
      )}
      {offerHistory && recalled < 0 && (
        <button type="button" onClick={openHistory} className={CHIP}>
          <History className="h-3 w-3" />
          Earlier prompts
        </button>
      )}
    </div>
  );
}
