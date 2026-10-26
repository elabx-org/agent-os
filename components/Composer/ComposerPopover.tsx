"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { HistorySheet } from "./HistorySheet";
import { PasteChip } from "./PasteChip";
import { SuggestionPopover } from "./SuggestionPopover";
import type { ComposerEngine } from "./useComposer";

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
        kind={composer.picker}
        items={composer.suggestions}
        selected={composer.selected}
        onHover={composer.setSelected}
        onChoose={composer.choose}
      />
    );

  // Above the composer, or below it when it sits high on the screen (the
  // terminal's keybar can be at the top)
  const anchorRef = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  const open = panel !== null;
  // Measured each render while open: the composer moves with the keyboard
  useLayoutEffect(() => {
    const box = anchorRef.current?.parentElement?.getBoundingClientRect();
    if (open && box) setBelow(box.top < window.innerHeight - box.bottom);
  });

  return (
    <div
      ref={anchorRef}
      className={cn(
        "absolute inset-x-0 z-50",
        below ? "top-full mt-2" : "bottom-full mb-2"
      )}
    >
      {panel}
    </div>
  );
}
