"use client";

import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { RAINBOW } from "@/lib/magic-words";
import type { ComposerEngine } from "./useComposer";

// The textarea and the layer behind it must lay text out identically
const TEXT = "px-3.5 py-2.5 text-base leading-6";

type NativeProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "onPaste" | "onSelect" | "className"
>;

interface ComposerInputProps extends NativeProps {
  composer: ComposerEngine;
  /** Layout of the box (flex-1, order...) */
  className?: string;
  /** Extra classes for the textarea itself (max height...) */
  inputClassName?: string;
  /** Grow with the text, up to the textarea's max height */
  autoGrow?: boolean;
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
  } = composer;
  const backdropRef = useRef<HTMLDivElement>(null);
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
    const back = backdropRef.current;
    if (!el || !back) return;
    const bar = el.offsetWidth - el.clientWidth;
    back.style.paddingRight = bar > 0 ? `calc(0.875rem + ${bar}px)` : "";
    back.scrollTop = el.scrollTop;
  });

  return (
    <div
      className={cn(
        "bg-secondary relative min-w-0 rounded-2xl",
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
          "placeholder:text-muted-foreground relative block min-h-[44px] w-full resize-none bg-transparent focus:outline-none",
          segments
            ? "text-transparent [caret-color:var(--color-foreground)] [-webkit-text-fill-color:transparent]"
            : "text-foreground",
          mode === "bash" && "font-mono",
          inputClassName
        )}
      />
    </div>
  );
}
