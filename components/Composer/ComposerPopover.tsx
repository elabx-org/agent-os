"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HistorySheet } from "./HistorySheet";
import { PasteChip } from "./PasteChip";
import { SessionSuggestions } from "./SessionSuggestions";
import { SuggestionPopover } from "./SuggestionPopover";
import type { ComposerEngine } from "./useComposer";
import { usePopoverPlacement } from "./usePopoverPlacement";

/** A Sessions row, and the tabs plus caption around the list (px) */
const SESSION_ROW = 56;
const SESSIONS_CHROME = 96;

/**
 * What floats over the composer: the history search, a pill's preview, or
 * the "/" and "@" suggestions. Place it in a relative wrapper around the box.
 */
export function ComposerPopover({ composer }: { composer: ComposerEngine }) {
  const { setHistoryOpen, recall, textareaRef } = composer;
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    textareaRef.current?.focus();
  }, [setHistoryOpen, textareaRef]);
  const chooseHistory = useCallback(
    (text: string) => {
      setHistoryOpen(false);
      recall(text);
    },
    [setHistoryOpen, recall]
  );

  const open =
    !!(composer.historyOpen && composer.cwd) ||
    composer.previewChip?.kind === "paste" ||
    !!composer.picker;
  const anchorRef = useRef<HTMLDivElement>(null);
  const { below, maxHeight } = usePopoverPlacement(anchorRef, open);
  // The panels cap themselves at 320px; only a tighter side (the deck, a
  // landscape keyboard) scrolls the whole panel and clips its shadow
  const tight = maxHeight !== undefined && maxHeight < 360;
  // There the Sessions list alone shrinks: the tabs and caption stay
  const listMax = tight
    ? Math.max(SESSION_ROW * 1.5, maxHeight - SESSIONS_CHROME)
    : undefined;

  let panel: ReactNode = null;
  if (composer.historyOpen && composer.cwd)
    panel = (
      <HistorySheet
        cwd={composer.cwd}
        onChoose={chooseHistory}
        onClose={closeHistory}
      />
    );
  // An image's preview is the full-screen viewer (ComposerInput)
  else if (composer.previewChip?.kind === "paste")
    panel = (
      <PasteChip
        chip={composer.previewChip}
        onUnfold={composer.unfoldChip}
        onRemove={composer.removeChip}
        onClose={composer.closePreview}
      />
    );
  else if (composer.picker)
    panel = (
      <SuggestionPopover
        id={composer.listboxId}
        kind={composer.picker}
        items={composer.suggestions}
        selected={composer.selected}
        onHover={composer.setSelected}
        onChoose={composer.choose}
        tab={composer.atTab}
        // Editing a queued message: files only
        onTab={composer.sessionsOff ? undefined : composer.setAtTab}
        sessions={
          <SessionSuggestions
            id={composer.listboxId}
            sessions={composer.attachable}
            attachedIds={composer.attached.map((a) => a.sessionId)}
            selected={composer.selected}
            onHover={composer.setSelected}
            onToggle={composer.attachSession}
            loading={composer.attachableLoading}
            maxHeight={listMax}
          />
        }
      />
    );

  return (
    <div
      ref={anchorRef}
      className={cn(
        "absolute inset-x-0 z-50",
        below ? "top-full mt-2" : "bottom-full mb-2",
        tight && "overflow-y-auto overscroll-contain"
      )}
      style={tight ? { maxHeight } : undefined}
    >
      {panel}
    </div>
  );
}
