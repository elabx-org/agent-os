"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  ImagePlus,
  Loader2,
  Mic,
  MicOff,
  MousePointer2,
  Plus,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { uploadFileToTemp } from "@/lib/file-upload";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { SnippetsModal } from "./TerminalToolbar";

interface ComposerPlusMenuProps {
  onPhoto: () => void;
  /** Text for the composer: a snippet, an uploaded file's path, dictation */
  onInsert: (text: string) => void;
  onSelectText: () => void;
  /** Hand the keyboard to the terminal (Claude Code's / and @ pickers) */
  onTypeInTerminal: () => void;
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
}: ComposerPlusMenuProps) {
  const [open, setOpen] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [uploading, setUploading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // A touch outside puts it away
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const pickFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const path = await uploadFileToTemp(file);
      if (path) onInsertRef.current(path);
    } catch (err) {
      console.error("Failed to upload file:", err);
    } finally {
      setUploading(false);
    }
  }, []);

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
    {
      icon: TerminalSquare,
      label: "Type in terminal",
      onSelect: onTypeInTerminal,
    },
  ];

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // While dictating, the + is the way to stop
          if (isListening) toggleMic();
          else setOpen((o) => !o);
        }}
        className={cn(
          "flex h-[44px] w-[44px] touch-manipulation items-center justify-center rounded-full",
          isListening
            ? "animate-pulse bg-red-500 text-white"
            : open
              ? "bg-muted text-foreground"
              : "bg-secondary text-muted-foreground active:bg-muted"
        )}
        aria-label={isListening ? "Stop dictating" : "More"}
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
          role="menu"
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
              className="text-foreground active:bg-muted hover:bg-muted/60 flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-sm"
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
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) pickFile(file);
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
