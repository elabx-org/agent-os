"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from "react";
import {
  FileText,
  History,
  ImagePlus,
  Loader2,
  Mic,
  MicOff,
  MousePointer2,
  Plus,
  TerminalSquare,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { uploadFilesToTemp } from "@/lib/file-upload";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { SnippetsModal } from "./TerminalToolbar";

interface ComposerPlusMenuProps {
  onPhoto: () => void;
  /** Text for the composer: a snippet, an uploaded file's path, dictation */
  onInsert: (text: string) => void;
  onSelectText: () => void;
  /** Hand the keyboard to the terminal (Claude Code's / and @ pickers) */
  onTypeInTerminal: () => void;
  /** Search this project's earlier prompts (Claude sessions) */
  onHistory?: () => void;
  /** Jump back to an earlier prompt, as Esc Esc (Claude sessions) */
  onRewind?: () => void;
  /** No + (the key row above the composer has the tools): the menu's
      actions are offered through `toolsRef` instead */
  hidden?: boolean;
  toolsRef?: MutableRefObject<ComposerTools | null>;
}

/** The +'s actions, for the key row's tools and its ⋯ */
export interface ComposerTools {
  /** File or snippet: the sheet, its pick going into the composer */
  file: () => void;
  history?: () => void;
  rewind?: () => void;
}

interface Item {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  /** Opens something the keyboard would cover */
  sheet?: boolean;
}

/**
 * The composer's +: the tools that used to fill the keybar (photo, file or
 * snippet, dictation, select text) in a small menu above the composer, so the
 * key row stays one row.
 */
export function ComposerPlusMenu({
  onPhoto,
  onInsert,
  onSelectText,
  onTypeInTerminal,
  onHistory,
  onRewind,
  hidden = false,
  toolsRef,
}: ComposerPlusMenuProps) {
  const [open, setOpen] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [uploading, setUploading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Opened from the keyboard: focus goes into the menu. A tap leaves it in
  // the composer so the on-screen keyboard stays up
  const [fromKeyboard, setFromKeyboard] = useState(false);

  // The hook rebuilds its recognizer when the callback changes, so keep it stable
  const onInsertRef = useRef(onInsert);
  onInsertRef.current = onInsert;
  const onTranscript = useCallback(
    (text: string) => onInsertRef.current(text.trim()),
    []
  );
  const {
    isListening,
    isSupported: micSupported,
    toggle: toggleMic,
  } = useSpeechRecognition(onTranscript);

  // A touch outside or Escape puts it away
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      if (menuRef.current?.contains(document.activeElement))
        triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && fromKeyboard)
      menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open, fromKeyboard]);

  // Arrows, Home and End move between the items; Tab leaves the menu
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    const all = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ??
        []),
    ];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown"
        ? (at + 1) % all.length
        : e.key === "ArrowUp"
          ? (at - 1 + all.length) % all.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? all.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    all[next]?.focus();
  };

  // Several files at once: uploaded together, their paths in one go
  const pickFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const paths = await uploadFilesToTemp(files);
      if (paths.length) onInsertRef.current(paths.join(" "));
    } finally {
      setUploading(false);
    }
  }, []);

  useEffect(() => {
    if (!toolsRef) return;
    toolsRef.current = {
      file: () => setShowSnippets(true),
      history: onHistory,
      rewind: onRewind,
    };
    return () => {
      toolsRef.current = null;
    };
  }, [toolsRef, onHistory, onRewind]);

  const items: Item[] = [
    { icon: ImagePlus, label: "Photo", onSelect: onPhoto, sheet: true },
    {
      icon: FileText,
      label: "File or snippet",
      onSelect: () => setShowSnippets(true),
      sheet: true,
    },
    ...(micSupported
      ? [
          {
            icon: isListening ? MicOff : Mic,
            label: isListening ? "Stop dictating" : "Dictate",
            onSelect: toggleMic,
          },
        ]
      : []),
    {
      icon: MousePointer2,
      label: "Select text",
      onSelect: onSelectText,
      sheet: true,
    },
    ...(onHistory
      ? [{ icon: History, label: "Earlier prompts", onSelect: onHistory }]
      : []),
    ...(onRewind ? [{ icon: Undo2, label: "Rewind", onSelect: onRewind }] : []),
    {
      icon: TerminalSquare,
      label: "Type in terminal",
      onSelect: onTypeInTerminal,
    },
  ];

  return (
    // Hidden, it takes no room (nor a gap) in the composer's row
    <div
      ref={rootRef}
      className={cn("relative flex-shrink-0", hidden && "contents")}
    >
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          // While dictating, the + is the way to stop
          if (isListening) toggleMic();
          else {
            // A click from Enter or Space has no pointer detail
            setFromKeyboard(e.detail === 0);
            setOpen((o) => !o);
          }
        }}
        className={cn(
          "flex h-[44px] w-[44px] touch-manipulation items-center justify-center rounded-full",
          hidden && "hidden",
          isListening
            ? "animate-pulse bg-red-500 text-white"
            : open
              ? "bg-muted text-foreground"
              : "bg-secondary text-muted-foreground active:bg-muted"
        )}
        aria-label={isListening ? "Stop dictating" : "Attach and tools"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isListening ? (
          <MicOff className="h-5 w-5" />
        ) : (
          <Plus
            className={cn("h-5 w-5 transition-transform", open && "rotate-45")}
          />
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Attach and tools"
          onKeyDown={onMenuKeyDown}
          // Glass-like, like the control column: translucent, a hairline and a highlight
          className="bg-background/70 border-border absolute bottom-full left-0 z-50 mb-2 grid w-52 gap-0.5 rounded-2xl border p-1.5 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08),0_12px_30px_rgb(0_0_0/0.35)] backdrop-blur-xl backdrop-saturate-150"
        >
          {items.map(({ icon: Icon, label, onSelect, sheet }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                haptic("light");
                setOpen(false);
                // Sheets and the select view would sit under the keyboard
                if (sheet)
                  (document.activeElement as HTMLElement | null)?.blur();
                onSelect();
              }}
              className="text-foreground active:bg-muted hover:bg-muted/60 focus-visible:bg-muted/60 flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-sm focus:outline-none"
            >
              <Icon className="text-muted-foreground h-[18px] w-[18px]" />
              {label}
            </button>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          pickFiles(files);
        }}
      />
      <SnippetsModal
        open={showSnippets}
        onClose={() => setShowSnippets(false)}
        onInsert={onInsert}
        onPickFile={() => {
          setShowSnippets(false);
          fileRef.current?.click();
        }}
      />
    </div>
  );
}
