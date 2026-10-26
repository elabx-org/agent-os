"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ComposerPlusMenu } from "./ComposerPlusMenu";

const MAX_ROWS = 5;

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the text to send; empty text means "press Enter" */
  onSend: (text: string) => void;
  /** Hand the keyboard to the terminal (Claude Code's / and @ pickers) */
  onTypeInTerminal: () => void;
  onPhoto: () => void;
  onSelectText: () => void;
  /** A control beside the send button (the keybar toggle) */
  extra?: React.ReactNode;
}

/**
 * Multi-line text box pinned above the keybar on touch devices. Native iOS
 * editing (selection, autocorrect, dictation) and the text stays visible above
 * the keyboard, instead of typing blind into xterm's hidden textarea.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onTypeInTerminal,
  onPhoto,
  onSelectText,
  extra,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Once the text needs a second line, the buttons move under it and the
  // text gets the whole width. It stays that way until the box is empty, so
  // the wider box fitting the text on one line again doesn't flip it back.
  const [stacked, setStacked] = useState(false);

  // Grow with content up to MAX_ROWS, then scroll
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const paddingY =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    if (!value) setStacked(false);
    else if (!stacked && el.scrollHeight > lineHeight * 1.5 + paddingY)
      setStacked(true);
    const padding = el.offsetHeight - el.clientHeight + 16;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS + padding)}px`;
  }, [value, stacked]);

  // A snippet, file path or dictation joins what's typed, a space apart.
  // Read through a ref: dictation can deliver twice before a re-render.
  const valueRef = useRef(value);
  valueRef.current = value;
  const insert = (text: string) => {
    if (!text) return;
    const current = valueRef.current;
    const next =
      (current && !/\s$/.test(current) ? `${current} ` : current) + text;
    valueRef.current = next;
    onChange(next);
  };

  const send = () => {
    onSend(value);
    onChange("");
  };

  return (
    <div
      className={cn(
        "border-border flex items-end gap-1.5 border-t px-2 py-1.5",
        stacked && "flex-wrap"
      )}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <ComposerPlusMenu
        onPhoto={onPhoto}
        onInsert={insert}
        onSelectText={onSelectText}
        onTypeInTerminal={onTypeInTerminal}
      />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Return sends, Shift+Return adds a line. On the on-screen keyboard
          // the keybar's newline key adds a line instead.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        data-composer=""
        enterKeyHint="send"
        rows={1}
        placeholder="Type into the terminal"
        autoCapitalize="sentences"
        className={cn(
          "bg-secondary text-foreground placeholder:text-muted-foreground min-h-[44px] flex-1 resize-none rounded-2xl px-3.5 py-2.5 text-base leading-6 focus:outline-none",
          stacked && "order-first basis-full"
        )}
      />
      {stacked && <span className="flex-1" aria-hidden="true" />}
      {extra}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={send}
        // The one accent control on screen, also when it just presses Enter
        className="bg-primary text-primary-foreground flex h-[44px] w-[44px] flex-shrink-0 touch-manipulation items-center justify-center rounded-full active:opacity-80"
        aria-label={value ? "Send" : "Press Enter"}
        title={value ? "Send" : "Press Enter"}
      >
        <ArrowUp className="h-5 w-5" />
      </button>
    </div>
  );
}
