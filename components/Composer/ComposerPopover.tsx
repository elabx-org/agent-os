"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HistorySheet } from "./HistorySheet";
import { PasteChip } from "./PasteChip";
import { SuggestionPopover } from "./SuggestionPopover";
import type { ComposerEngine } from "./useComposer";
import { usePopoverPlacement } from "./usePopoverPlacement";

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

  let panel: ReactNode = null;
  if (composer.historyOpen && composer.cwd)
    panel = (
      <HistorySheet
        cwd={composer.cwd}
        onChoose={chooseHistory}
        onClose={closeHistory}
      />
    );
  else if (composer.previewChip)
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
      />
    );

  const anchorRef = useRef<HTMLDivElement>(null);
  const { below, maxHeight } = usePopoverPlacement(anchorRef, panel !== null);
  // The panels cap themselves at 320px; only a tighter side (the deck, a
  // landscape keyboard) scrolls the whole panel and clips its shadow
  const tight = maxHeight !== undefined && maxHeight < 360;

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
