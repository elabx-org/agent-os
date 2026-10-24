"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_ROWS = 5;

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the text to send; empty text means "press Enter" */
  onSend: (text: string) => void;
  /** Hand the keyboard to the terminal (Claude Code's / and @ pickers) */
  onTypeInTerminal: () => void;
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
  extra,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with content up to MAX_ROWS, then scroll
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const padding = el.offsetHeight - el.clientHeight + 16;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS + padding)}px`;
  }, [value]);

  const send = () => {
    onSend(value);
    onChange("");
  };

  return (
    <div
      className="border-border flex items-end gap-1.5 border-t px-2 py-1.5"
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onTypeInTerminal}
        className="bg-secondary text-muted-foreground active:bg-primary active:text-primary-foreground flex h-[44px] w-[44px] flex-shrink-0 touch-manipulation items-center justify-center rounded-full"
        aria-label="Type in terminal"
        title="Type in terminal (for / and @ suggestions)"
      >
        <TerminalSquare className="h-5 w-5" />
      </button>
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
        placeholder="Message"
        autoCapitalize="sentences"
        className="bg-secondary text-foreground placeholder:text-muted-foreground min-h-[44px] flex-1 resize-none rounded-2xl px-3.5 py-2.5 text-base leading-6 focus:outline-none"
      />
      {extra}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={send}
        className={cn(
          "flex h-[44px] w-[44px] flex-shrink-0 touch-manipulation items-center justify-center rounded-full",
          value
            ? "bg-primary text-primary-foreground active:opacity-80"
            : "bg-secondary text-muted-foreground active:bg-primary active:text-primary-foreground"
        )}
        aria-label={value ? "Send" : "Press Enter"}
        title={value ? "Send" : "Press Enter"}
      >
        <ArrowUp className="h-5 w-5" />
      </button>
    </div>
  );
}
