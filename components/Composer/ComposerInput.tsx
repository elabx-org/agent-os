"use client";

import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { RAINBOW } from "@/lib/magic-words";
import { ImageViewer } from "@/components/ImageViewer";
import { ImagePill, ImagePillTarget } from "./ImagePill";
import { imageName } from "./text";
import type { ComposerEngine } from "./useComposer";

// The textarea and the layers on it must lay text out identically; lines
// grow with an image pill so its thumbnail fits
const TEXT = "px-3.5 py-2.5 text-base";

type NativeProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "onPaste" | "onSelect" | "className"
>;

export interface ComposerInputProps extends NativeProps {
  composer: ComposerEngine;
  /** Layout of the box (flex-1, order...) */
  className?: string;
  /** Extra classes for the textarea itself (max height...) */
  inputClassName?: string;
  /** Grow with the text, up to the textarea's max height */
  autoGrow?: boolean;
  /** No fill of its own: it sits on the composer's glass (ComposerCard) */
  plain?: boolean;
}

/**
 * The composer's text box: a native textarea (iOS autocorrect, selection and
 * dictation keep working) over a layer that draws the same text with Claude
 * Code's touches: rainbow magic words and pills. The textarea's own text goes
 * transparent only while there's something to draw.
 */
export function ComposerInput({
  composer,
  className,
  inputClassName,
  onKeyDown,
  onKeyUp,
  onFocus,
  onBlur,
  onClick,
  onScroll,
  autoCapitalize,
  autoGrow,
  plain,
  ...props
}: ComposerInputProps) {
  const {
    textareaRef,
    display,
    segments,
    mode,
    onTextChange,
    onPaste,
    onSelect,
    onTap,
    setFocused,
    picker,
    listboxId,
    selected,
    chips,
  } = composer;
  const backdropRef = useRef<HTMLDivElement>(null);
  const targetsRef = useRef<HTMLDivElement>(null);
  const images = chips.some((c) => c.kind === "image");
  const lines = images ? "leading-8" : "leading-6";
  const viewing =
    composer.previewChip?.kind === "image" ? composer.previewChip : null;
  // The "/" and "@" lists are driven from the box, which keeps focus: a
  // combobox, so screen readers hear them open and the option in play.
  // ComposerPopover shows history or a pill's preview over them.
  const listShown =
    !!picker &&
    !composer.previewChip &&
    !(composer.historyOpen && composer.cwd);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || !autoGrow) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [autoGrow, display, textareaRef]);

  // Same scroll, and room for a scrollbar the textarea may show
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const bar = el.offsetWidth - el.clientWidth;
    for (const layer of [backdropRef.current, targetsRef.current]) {
      if (!layer) continue;
      layer.style.paddingRight = bar > 0 ? `calc(0.875rem + ${bar}px)` : "";
      layer.scrollTop = el.scrollTop;
    }
  });

  return (
    <div
      className={cn(
        "relative min-w-0 rounded-2xl",
        !plain && "bg-secondary",
        // Claude Code's bash pink, and memory's grey, on the left edge
        mode === "bash" &&
          "rounded-l-xl shadow-[inset_3px_0_0_#C2187A] dark:shadow-[inset_3px_0_0_#FD5DB1]",
        mode === "memory" && "rounded-l-xl shadow-[inset_3px_0_0_#8E96A2]",
        className
      )}
    >
      {segments && (
        <div
          ref={backdropRef}
          aria-hidden="true"
          className={cn(
            TEXT,
            lines,
            "text-foreground pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap",
            mode === "bash" && "font-mono"
          )}
        >
          {segments.map((s, i) =>
            s.kind === "plain" ? (
              <span key={i}>{s.text}</span>
            ) : s.kind === "magic" ? (
              <span
                key={i}
                className="bg-clip-text font-normal text-transparent"
                style={{
                  backgroundImage: RAINBOW,
                  WebkitBackgroundClip: "text",
                }}
              >
                {s.text}
              </span>
            ) : s.chip?.kind === "image" ? (
              <ImagePill key={i} chip={s.chip} />
            ) : (
              // A pill, drawn without padding so the text stays in step
              <span
                key={i}
                className="bg-foreground/15 rounded-[4px] shadow-[0_0_0_2px_hsl(var(--foreground)/0.15)]"
              >
                {s.text}
              </span>
            )
          )}
          {/* A last empty line still has height */}
          {"​"}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={display}
        onChange={(e) =>
          onTextChange(e.target.value, e.target.selectionStart ?? 0)
        }
        onPaste={onPaste}
        onSelect={onSelect}
        onClick={(e) => {
          onTap();
          onClick?.(e);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (composer.onKeyDown(e)) return;
          onKeyDown?.(e);
        }}
        onKeyUp={(e) => {
          composer.onKeyUp();
          onKeyUp?.(e);
        }}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        onScroll={(e) => {
          if (backdropRef.current)
            backdropRef.current.scrollTop = e.currentTarget.scrollTop;
          if (targetsRef.current)
            targetsRef.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.(e);
        }}
        rows={1}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listShown}
        aria-controls={listShown ? listboxId : undefined}
        aria-activedescendant={
          listShown ? `${listboxId}-${selected}` : undefined
        }
        {...props}
        // Commands aren't prose
        spellCheck={mode === "bash" ? false : props.spellCheck}
        autoCorrect={mode === "bash" ? "off" : props.autoCorrect}
        autoCapitalize={mode === "bash" ? "off" : autoCapitalize}
        className={cn(
          TEXT,
          lines,
          "placeholder:text-muted-foreground relative block min-h-[44px] w-full resize-none bg-transparent focus:outline-none",
          segments
            ? "text-transparent [caret-color:var(--color-foreground)] [-webkit-text-fill-color:transparent]"
            : "text-foreground",
          mode === "bash" && "font-mono",
          inputClassName
        )}
      />
      {/* Over the box, the image pills again, there to be touched: the pill
          opens the viewer, its × takes it out. Clear everywhere else, so
          the box's caret and selection work around them */}
      {segments && images && (
        <div
          ref={targetsRef}
          className={cn(
            TEXT,
            lines,
            "pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap text-transparent",
            mode === "bash" && "font-mono"
          )}
        >
          {segments.map((s, i) =>
            s.chip?.kind === "image" ? (
              <ImagePillTarget
                key={i}
                chip={s.chip}
                name={imageName(s.chip.text)}
                onOpen={(chip) => {
                  // Full screen: the keyboard goes down for it
                  textareaRef.current?.blur();
                  composer.openChip(chip);
                }}
                onRemove={composer.removeChip}
              />
            ) : (
              <span key={i}>{s.text}</span>
            )
          )}
        </div>
      )}
      {composer.uploading > 0 && (
        <span
          role="status"
          className="bg-secondary text-muted-foreground absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          {composer.uploading > 1
            ? `Uploading ${composer.uploading} images`
            : "Uploading image"}
        </span>
      )}
      {viewing && (
        <ImageViewer
          path={viewing.text}
          size={composer.imageSize(viewing.text)}
          onRemove={() => composer.removeChip(viewing)}
          onClose={composer.closePreview}
        />
      )}
    </div>
  );
}
