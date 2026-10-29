"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  Clipboard,
  X,
  Send,
  Mic,
  MicOff,
  ImagePlus,
  FileText,
  Plus,
  Trash2,
  MousePointer2,
  Copy,
  Settings,
  Upload,
  Ellipsis,
  Space,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useLongPress } from "@/hooks/useLongPress";
import {
  type KeysContext,
  type ToolbarButtonId,
  DEFAULT_ROW1,
  SPECIAL_KEYS,
  contextRow,
  getButtonDef,
  keysSettingsStore,
  pinnedRow,
  rowIdFor,
  splitOverflow,
  useToolbarPreferences,
} from "./toolbar-config";
import { FOLD_CLEAR } from "@/hooks/useHinge";
import { ToolbarSettings } from "./ToolbarSettings";
import { KeyLongPressMenu, type MenuKey } from "./KeyLongPressMenu";
import { AdaptiveKey } from "./AdaptiveKey";
import { useNarrowScreen } from "@/hooks/useNarrowScreen";
import { adaptiveRow, type AdaptiveState } from "@/lib/adaptive-keys";
import { SheetGrab } from "@/components/ui/sheet-grab";

interface TerminalToolbarProps {
  onKeyPress: (key: string) => void;
  onPaste?: (text: string) => void;
  onImagePicker?: () => void;
  onCopy?: () => boolean; // Returns true if selection was copied
  selectMode?: boolean;
  onSelectModeChange?: (enabled: boolean) => void;
  visible?: boolean;
  onLayoutChange?: (layout: "single" | "double") => void;
  /** Rows fill a deck of their own (laptop pose): keep both, however short the screen */
  keepRows?: boolean;
  /** What the terminal runs, for the context row */
  context?: KeysContext;
  /** The on-screen keyboard is up (Claude Code's context row changes) */
  keyboardUp?: boolean;
  /** The tabletop base: the one context row, whatever the saved layout */
  singleRow?: boolean;
  /** Across both pages of the open Duo (Two rows): the context row's keys
      either side of the gutter, every one shown */
  pages?: { left: number; gutter: number } | null;
  /** One row at full size with ⋯ for the rest, fixed rows too (a page of
      the open Duo, Split or Mirrored) */
  overflow?: boolean;
  /** Counts the app's File key presses; each opens the snippets sheet */
  snippetsRequest?: number;
  /** What the session is doing, for the adaptive row on narrow screens;
      null where it doesn't apply */
  adaptiveState?: AdaptiveState | null;
  /** The options of the prompt Claude shows, for its number keys */
  promptOptions?: number;
  /** The adaptive row sits above the composer and leads with the tools:
      Photo, Paste (Copy while text is selected) and File */
  tools?: RowTools | null;
  /** What ⋯ offers besides the keys (the composer's +, which hides) */
  actions?: RowAction[];
}

export interface RowTools {
  onPhoto: () => void;
  onFile: () => void;
  /** Text is selected: the clipboard key copies it */
  canCopy: boolean;
  /** Pick text to copy (held Paste) */
  onSelectText: () => void;
}

export interface RowAction {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

// ⋯ already has these as the tools
const TOOL_KEYS = new Set<ToolbarButtonId>([
  "paste",
  "select",
  "image",
  "snippets",
]);

interface Snippet {
  id: string;
  name: string;
  content: string;
}

const SNIPPETS_STORAGE_KEY = "terminal-snippets";

const DEFAULT_SNIPPETS: Snippet[] = [
  // Git shortcuts
  { id: "default-1", name: "Git status", content: "git status" },
  { id: "default-2", name: "Git diff", content: "git diff" },
  { id: "default-3", name: "Git add all", content: "git add -A" },
  { id: "default-4", name: "Git commit", content: 'git commit -m ""' },
  { id: "default-5", name: "Git push", content: "git push" },
  { id: "default-6", name: "Git pull", content: "git pull" },
  // Claude Code prompts
  { id: "default-7", name: "Continue", content: "continue" },
  { id: "default-8", name: "Yes", content: "yes" },
  { id: "default-9", name: "No", content: "no" },
  {
    id: "default-10",
    name: "Explain this",
    content: "explain what this code does",
  },
  { id: "default-11", name: "Fix errors", content: "fix the errors" },
  {
    id: "default-12",
    name: "Run tests",
    content: "run the tests and fix any failures",
  },
  {
    id: "default-13",
    name: "Commit changes",
    content: "commit these changes with a descriptive message",
  },
  // Common commands
  { id: "default-14", name: "List files", content: "ls -la" },
  { id: "default-15", name: "NPM dev", content: "npm run dev" },
  { id: "default-16", name: "NPM install", content: "npm install" },
];

function getStoredSnippets(): Snippet[] {
  if (typeof window === "undefined") return DEFAULT_SNIPPETS;
  try {
    const stored = localStorage.getItem(SNIPPETS_STORAGE_KEY);
    if (!stored) {
      // First time - save defaults
      saveSnippets(DEFAULT_SNIPPETS);
      return DEFAULT_SNIPPETS;
    }
    return JSON.parse(stored);
  } catch {
    return DEFAULT_SNIPPETS;
  }
}

function saveSnippets(snippets: Snippet[]) {
  localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
}

// Snippets modal for saving/inserting common commands
export function SnippetsModal({
  open,
  onClose,
  onInsert,
  onPickFile,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
  /** Adds an "Upload a file" row (the composer's "File or snippet") */
  onPickFile?: () => void;
}) {
  const [snippets, setSnippets] = useState<Snippet[]>(() =>
    getStoredSnippets()
  );
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");

  const handleAdd = () => {
    if (newName.trim() && newContent.trim()) {
      const newSnippet: Snippet = {
        id: Date.now().toString(),
        name: newName.trim(),
        content: newContent.trim(),
      };
      const updated = [...snippets, newSnippet];
      setSnippets(updated);
      saveSnippets(updated);
      setNewName("");
      setNewContent("");
      setIsAdding(false);
    }
  };

  const handleDelete = (id: string) => {
    const updated = snippets.filter((s) => s.id !== id);
    setSnippets(updated);
    saveSnippets(updated);
  };

  const handleInsert = (content: string) => {
    onInsert(content);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background flex max-h-[70vh] w-full flex-col rounded-t-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <SheetGrab onClose={onClose} className="mx-0 mb-0 h-6" />
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 pb-3">
          <span className="text-sm font-medium">Snippets</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAdding(!isAdding)}
              className="hover:bg-muted rounded-md p-1.5"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="hover:bg-muted rounded-md p-1.5"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Add new snippet form */}
        {isAdding && (
          <div className="border-border bg-muted/50 border-b px-4 py-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Snippet name..."
              className="bg-background focus:ring-primary mb-2 w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Command or text..."
              className="bg-background focus:ring-primary h-20 w-full resize-none rounded-lg px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || !newContent.trim()}
              className="bg-primary text-primary-foreground mt-2 w-full rounded-lg py-2 font-medium disabled:opacity-50"
            >
              Save Snippet
            </button>
          </div>
        )}

        {/* Snippets list */}
        <div className="flex-1 overflow-y-auto">
          {onPickFile && (
            <button
              onClick={onPickFile}
              className="border-border active:bg-muted flex w-full items-center gap-3 border-b px-4 py-3 text-left"
            >
              <Upload className="text-muted-foreground h-4 w-4" />
              <span className="text-sm font-medium">Upload a file</span>
            </button>
          )}
          {snippets.length === 0 ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">
              No snippets yet. Tap + to add one.
            </div>
          ) : (
            snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="border-border active:bg-muted flex items-center gap-2 border-b px-4 py-3"
              >
                <button
                  onClick={() => handleInsert(snippet.content)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium">
                    {snippet.name}
                  </div>
                  <div className="text-muted-foreground truncate font-mono text-xs">
                    {snippet.content}
                  </div>
                </button>
                <button
                  onClick={() => handleDelete(snippet.id)}
                  className="hover:bg-destructive/20 text-muted-foreground hover:text-destructive rounded-md p-2"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Paste modal for when clipboard API isn't available
function PasteModal({
  open,
  onClose,
  onPaste,
}: {
  open: boolean;
  onClose: () => void;
  onPaste: (text: string) => void;
}) {
  const [text, setText] = useState("");

  const handleSend = () => {
    if (text) {
      onPaste(text);
      setText("");
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background w-[90%] max-w-md rounded-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">Paste text</span>
          <button onClick={onClose} className="hover:bg-muted rounded-md p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData?.getData("text");
            if (pasted) {
              e.preventDefault();
              setText((prev) => prev + pasted);
            }
          }}
          placeholder="Tap here, then long-press to paste..."
          autoFocus
          className="bg-muted focus:ring-primary h-24 w-full resize-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <button
          onClick={handleSend}
          disabled={!text}
          className="bg-primary text-primary-foreground mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 font-medium disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          Send to Terminal
        </button>
      </div>
    </div>
  );
}

// --- Sub-components for custom buttons ---

function SimpleKeyButton({
  displayLabel,
  keyCode,
  highlight,
  onKeyPress,
}: {
  displayLabel: string;
  keyCode: string;
  highlight?: boolean;
  onKeyPress: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onKeyPress(keyCode);
      }}
      className={cn(
        "tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium",
        "active:bg-primary active:text-primary-foreground active:bg-none",
        highlight && "danger mx-1",
        keyCode === "\x1b" && "esc"
      )}
    >
      {displayLabel}
    </button>
  );
}

function MicButton({
  isListening,
  onToggle,
}: {
  isListening: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium",
        isListening
          ? "animate-pulse bg-red-500 bg-none text-white"
          : "active:bg-primary active:text-primary-foreground active:bg-none"
      )}
    >
      {isListening ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}

function PasteButton({ onPaste }: { onPaste: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onPaste();
      }}
      className="active:bg-primary active:text-primary-foreground tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium active:bg-none"
    >
      <Clipboard className="h-4 w-4" />
    </button>
  );
}

function SelectModeButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium",
        active
          ? "bg-primary text-primary-foreground bg-none"
          : "active:bg-primary active:text-primary-foreground active:bg-none"
      )}
    >
      <MousePointer2 className="h-4 w-4" />
    </button>
  );
}

function ImagePickerButton({ onPick }: { onPick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      className="active:bg-primary active:text-primary-foreground tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium active:bg-none"
    >
      <ImagePlus className="h-4 w-4" />
    </button>
  );
}

function SnippetsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="active:bg-primary active:text-primary-foreground tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium active:bg-none"
    >
      <FileText className="h-4 w-4" />
    </button>
  );
}

// Tap: return. Hold: a new line without sending (Claude Code's ⇧↵)
function EnterButton({
  onPress,
  className = "tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium",
}: {
  onPress: (key: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLongPress(ref, () => onPress("\n"));
  return (
    <button
      ref={ref}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onPress("\r");
      }}
      className={cn(
        "active:bg-primary active:text-primary-foreground active:bg-none",
        className
      )}
      title="Tap: return | Hold: new line"
    >
      {"\u21B5"}
    </button>
  );
}

function CursorTrackpadButton({
  onKeyPress,
}: {
  onKeyPress: (key: string) => void;
}) {
  const [cursorMoveMode, setCursorMoveMode] = useState<"left" | "right" | null>(
    null
  );
  const [lastCursorMove, setLastCursorMove] = useState(0);
  const [cursorStartX, setCursorStartX] = useState(0);

  return (
    <button
      type="button"
      style={{ touchAction: "none" }}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const touch = e.touches[0];
        setCursorStartX(touch.clientX);
        onKeyPress(" ");
        setLastCursorMove(Date.now());
        setTimeout(() => {
          if (e.touches.length > 0) {
            setCursorMoveMode("left");
          }
        }, 700);
      }}
      onTouchMove={(e) => {
        if (cursorMoveMode) {
          e.preventDefault();
          e.stopPropagation();
          const now = Date.now();
          if (now - lastCursorMove < 100) return;

          const touch = e.touches[0];
          const deltaX = touch.clientX - cursorStartX;
          const newMode =
            deltaX > 20 ? "right" : deltaX < -20 ? "left" : cursorMoveMode;

          setCursorMoveMode(newMode);
          onKeyPress(
            newMode === "right" ? SPECIAL_KEYS.RIGHT : SPECIAL_KEYS.LEFT
          );
          setLastCursorMove(now);
        }
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setCursorMoveMode(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!cursorMoveMode) {
          onKeyPress(" ");
        }
      }}
      className={cn(
        "tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium",
        cursorMoveMode
          ? "bg-primary text-primary-foreground bg-none"
          : "active:bg-primary active:text-primary-foreground active:bg-none"
      )}
      title="Tap: space | Hold: slide left/right to move cursor"
    >
      {cursorMoveMode ? (
        cursorMoveMode === "left" ? (
          "\u25C4"
        ) : (
          "\u25BA"
        )
      ) : (
        <Space className="h-4 w-4" aria-label="Space" />
      )}
    </button>
  );
}

function BackspaceButton({
  onKeyPress,
}: {
  onKeyPress: (key: string) => void;
}) {
  const [longPressInterval, setLongPressInterval] =
    useState<NodeJS.Timeout | null>(null);

  const stopLongPress = useCallback(() => {
    if (longPressInterval) {
      clearInterval(longPressInterval);
      setLongPressInterval(null);
    }
  }, [longPressInterval]);

  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onKeyPress("\x7f");
        const timeout = setTimeout(() => {
          const id = setInterval(() => onKeyPress("\x7f"), 80);
          setLongPressInterval(id);
        }, 400);
        (e.currentTarget as HTMLElement).dataset.timeout = String(
          timeout as unknown as number
        );
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        const timeout = (e.currentTarget as HTMLElement).dataset.timeout;
        if (timeout) clearTimeout(Number(timeout));
        stopLongPress();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onKeyPress("\x7f");
      }}
      className="active:bg-primary active:text-primary-foreground tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium active:bg-none"
      title="Tap: delete | Hold: rapid delete"
    >
      {"\u232B"}
    </button>
  );
}

function CopyButton({
  onCopy,
  copyFeedback,
}: {
  onCopy: () => void;
  copyFeedback: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onCopy();
      }}
      className={cn(
        "tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium",
        copyFeedback
          ? "bg-green-500 bg-none text-white"
          : "active:bg-primary active:text-primary-foreground active:bg-none"
      )}
    >
      <Copy className="h-4 w-4" />
    </button>
  );
}

/**
 * Paste, or Copy while text is selected (filled with the accent so the
 * change shows). Held, it does the other one: Paste while Copy shows, and
 * picking text to copy while Paste does.
 */
function ClipboardKey({
  canCopy,
  copied,
  onCopy,
  onPaste,
  onSelectText,
}: {
  canCopy: boolean;
  copied: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onSelectText: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLongPress(ref, canCopy ? onPaste : onSelectText);
  const Icon = canCopy || copied ? Copy : Clipboard;
  const label = canCopy ? "Copy" : "Paste";
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (canCopy) onCopy();
        else onPaste();
      }}
      className={cn(
        KEY_CLASS,
        copied
          ? "bg-green-500 bg-none text-white"
          : canCopy
            ? "bg-primary text-primary-foreground ring-primary/40 bg-none ring-2"
            : "active:bg-primary active:text-primary-foreground active:bg-none"
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ToolKey({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        // The sheet it opens would sit under the keyboard
        (document.activeElement as HTMLElement | null)?.blur();
        onPress();
      }}
      className={cn(
        KEY_CLASS,
        "active:bg-primary active:text-primary-foreground active:bg-none"
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// --- Main component ---

export function TerminalToolbar({
  onKeyPress,
  onPaste,
  onImagePicker,
  onCopy,
  selectMode = false,
  onSelectModeChange,
  visible = true,
  onLayoutChange,
  keepRows = false,
  context = "claude",
  keyboardUp = false,
  singleRow = false,
  pages = null,
  overflow = false,
  snippetsRequest = 0,
  adaptiveState = null,
  promptOptions = 0,
  tools = null,
  actions,
}: TerminalToolbarProps) {
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showSnippetsModal, setShowSnippetsModal] = useState(false);
  useEffect(() => {
    if (snippetsRequest) setShowSnippetsModal(true);
  }, [snippetsRequest]);
  const [showSettings, setShowSettings] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const { preferences, updatePreferences: persistPreferences } =
    useToolbarPreferences();

  // Send text character-by-character to terminal
  const sendText = useCallback(
    (text: string) => {
      for (const char of text) {
        onKeyPress(char);
      }
    },
    [onKeyPress]
  );

  const {
    isListening,
    isSupported: isMicSupported,
    toggle: toggleMic,
  } = useSpeechRecognition(sendText);

  // Handle paste - try clipboard API first, fall back to modal
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text) {
        if (onPaste) {
          onPaste(text);
        } else {
          sendText(text);
        }
        return;
      }
    } catch {
      // Clipboard API failed or unavailable
    }
    setShowPasteModal(true);
  }, [sendText, onPaste]);

  // Handle copy with visual feedback
  const handleCopy = useCallback(() => {
    if (onCopy?.()) {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1000);
    }
  }, [onCopy]);

  // Update preferences and persist to DB
  const updatePreferences = useCallback(
    (next: typeof preferences) => {
      persistPreferences(next);
      onLayoutChange?.(next.layout);
    },
    [persistPreferences, onLayoutChange]
  );

  // The context preset: one row chosen by what's running, never two
  const contextMode = preferences.mode === "context" || singleRow;
  const sourceRow1 = contextMode
    ? contextRow(context, keyboardUp, preferences)
    : preferences.row1;
  const sourceRow2 = contextMode ? NO_KEYS : preferences.row2;

  // Resolve visible buttons for each row, filtering out conditional buttons
  const offered = useCallback(
    (id: ToolbarButtonId) => {
      const def = getButtonDef(id);
      if (!def) return false;
      if (def.conditional === "mic" && !isMicSupported) return false;
      if (def.conditional === "image" && !onImagePicker) return false;
      if (def.conditional === "select-mode" && !onSelectModeChange)
        return false;
      return true;
    },
    [isMicSupported, onImagePicker, onSelectModeChange]
  );
  const resolvedRow1 = useMemo(
    () => sourceRow1.filter(offered),
    [sourceRow1, offered]
  );

  // Narrow screens: one row that follows Claude, every key in its ⋯
  const narrow = useNarrowScreen();
  const adaptive =
    preferences.adaptive !== false &&
    narrow &&
    !!adaptiveState &&
    !pages &&
    !overflow &&
    !singleRow &&
    !keepRows;
  const adaptiveKeys = useMemo(
    () => (adaptiveState ? adaptiveRow(adaptiveState, promptOptions) : []),
    [adaptiveState, promptOptions]
  );
  const allKeys = useMemo(
    () =>
      DEFAULT_ROW1.filter((id) => offered(id) && !(tools && TOOL_KEYS.has(id))),
    [offered, tools]
  );

  const resolvedRow2 = useMemo(
    () =>
      sourceRow2.filter((id) => {
        const def = getButtonDef(id);
        if (!def) return false;
        if (def.conditional === "mic" && !isMicSupported) return false;
        if (def.conditional === "image" && !onImagePicker) return false;
        if (def.conditional === "select-mode" && !onSelectModeChange)
          return false;
        return true;
      }),
    [sourceRow2, isMicSupported, onImagePicker, onSelectModeChange]
  );

  // Short landscape screens (iPhone Duo inner display, phones on their side)
  // can't spare height for a second row, so it joins the first one, which scrolls
  const shortLandscape = useShortLandscape();
  const twoRowLayout = preferences.layout === "double" && !contextMode;
  const mergeRows =
    twoRowLayout && resolvedRow2.length > 0 && shortLandscape && !keepRows;
  // A narrow screen (the closed phone) can't fit a long first row: its last
  // keys move to the start of the second row, so none hide past the edge.
  // A row that still doesn't fit scrolls, with a fade at the end as a hint.
  const [row1El, row1Ref] = useState<HTMLDivElement | null>(null);
  const [row2El, row2Ref] = useState<HTMLDivElement | null>(null);
  const rowWidth = useRowWidth(row1El);
  // A page of the open Duo: Settings → Keys previews at this width
  useEffect(() => {
    if (overflow && rowWidth) keysSettingsStore.rowWidth = rowWidth;
  }, [overflow, rowWidth]);
  const twoRows = twoRowLayout && resolvedRow2.length > 0 && !mergeRows;
  // What measuring found for these keys at this width: keys to move down
  // (dividers take room too) and which rows still scroll
  const fitKey = [
    rowWidth,
    twoRows,
    mergeRows,
    resolvedRow1.join(),
    resolvedRow2.join(),
    pages?.left,
    overflow,
  ].join("|");
  const [fitAt, setFitAt] = useState({
    key: "",
    trim: 0,
    scrolls1: false,
    scrolls2: false,
  });
  const fit =
    fitAt.key === fitKey
      ? fitAt
      : { key: fitKey, trim: 0, scrolls1: false, scrolls2: false };
  const { row1Ids, row2Ids, trimmable } = useMemo(() => {
    if (mergeRows)
      return {
        row1Ids: Array.from(new Set([...resolvedRow1, ...resolvedRow2])),
        row2Ids: [],
        trimmable: false,
      };
    // Room for this many keys at their narrowest, less one for the gear
    const fits = rowWidth
      ? Math.floor((rowWidth - ROW_INSET_PX) / KEY_STEP_PX) - 1 - fit.trim
      : Infinity;
    // Moving another key down still leaves one: past that the row scrolls
    // (a row narrower than a key, mid-fold, would otherwise trim forever)
    const trimmable = twoRows && fits > 1;
    if (!twoRows || resolvedRow1.length <= fits || fits < 1)
      return { row1Ids: resolvedRow1, row2Ids: resolvedRow2, trimmable };
    return {
      row1Ids: resolvedRow1.slice(0, fits),
      row2Ids: [...resolvedRow1.slice(fits), ...resolvedRow2],
      trimmable,
    };
  }, [mergeRows, twoRows, rowWidth, fit.trim, resolvedRow1, resolvedRow2]);

  // The context row keeps its keys at full size: those past the row's width
  // go into ⋯, in order, with a pinned ^C still last. Across both pages (Two
  // rows) they split either side of the gutter instead, every one shown.
  const pinCtrlC = preferences.pinCtrlC ?? true;
  // Fixed rows on a page of the open Duo: one row too, never shrunk or
  // scrolling (their keys in order, the second row's after the first's)
  const fullRow = useMemo(
    () =>
      contextMode
        ? resolvedRow1
        : overflow && !twoRows
          ? pinnedRow(row1Ids, pinCtrlC)
          : null,
    [contextMode, resolvedRow1, overflow, twoRows, row1Ids, pinCtrlC]
  );
  const contextKeys = useMemo(() => {
    if (!fullRow || !rowWidth) return null;
    const pinned = pinCtrlC && fullRow[fullRow.length - 1] === "ctrl-c";
    const tail: ToolbarButtonId[] = pinned ? ["ctrl-c"] : [];
    if (pages) {
      const [fits] = splitOverflow(fullRow, pages.left, { pinCtrlC });
      const left = fits.slice(0, fits.length - tail.length);
      return {
        head: left,
        more: NO_KEYS,
        tail: fullRow.slice(left.length),
        gear: true,
      };
    }
    const [shown, over] = splitOverflow(fullRow, rowWidth, { pinCtrlC });
    let head = shown.slice(0, shown.length - tail.length);
    let more = over;
    // Measuring found the row still too long: one more key goes
    if (fit.trim) {
      const cut = Math.max(0, head.length - fit.trim);
      more = [...head.slice(cut), ...more];
      head = head.slice(0, cut);
    }
    // The quiet gear only when it fits too (held ^C and ⋯ offer it)
    const gear =
      !more.length &&
      !splitOverflow(fullRow, rowWidth, { pinCtrlC, reserve: GEAR_PX })[1]
        .length;
    return { head, more, tail, gear };
  }, [fullRow, rowWidth, pinCtrlC, pages, fit.trim]);

  useLayoutEffect(() => {
    if (!row1El || !rowWidth) return;
    const over = (el: HTMLDivElement | null) =>
      !!el && el.scrollWidth > el.clientWidth + 1;
    if (contextKeys && !pages) {
      if (!over(row1El) || fit.scrolls1) return;
      if (contextKeys.head.length > 0) setFitAt({ ...fit, trim: fit.trim + 1 });
      else setFitAt({ ...fit, scrolls1: true });
      return;
    }
    if (over(row1El) && !fit.scrolls1) {
      if (trimmable && row1Ids.length > 1)
        setFitAt({ ...fit, trim: fit.trim + 1 });
      else setFitAt({ ...fit, scrolls1: true });
    } else if (over(row2El) && !fit.scrolls2) {
      setFitAt({ ...fit, scrolls2: true });
    }
  });

  // Render a single button by ID
  const renderButton = useCallback(
    (id: ToolbarButtonId) => {
      switch (id) {
        case "mic":
          return (
            <MicButton
              key={id}
              isListening={isListening}
              onToggle={toggleMic}
            />
          );
        case "paste":
          return <PasteButton key={id} onPaste={handlePaste} />;
        case "select":
          return (
            <SelectModeButton
              key={id}
              active={selectMode}
              onToggle={() => onSelectModeChange?.(!selectMode)}
            />
          );
        case "image":
          return (
            <ImagePickerButton key={id} onPick={() => onImagePicker?.()} />
          );
        case "snippets":
          return (
            <SnippetsButton
              key={id}
              onOpen={() => setShowSnippetsModal(true)}
            />
          );
        case "enter":
          return <EnterButton key={id} onPress={onKeyPress} />;
        case "cursor":
          return <CursorTrackpadButton key={id} onKeyPress={onKeyPress} />;
        case "backspace":
          return <BackspaceButton key={id} onKeyPress={onKeyPress} />;
        case "ctrl-c":
          return (
            <KeyLongPressMenu
              key={id}
              label="^C"
              keyCode={SPECIAL_KEYS.CTRL_C}
              menu={CTRL_C_MENU}
              onKeyPress={onKeyPress}
              className={cn(
                KEY_CLASS,
                "danger active:bg-primary active:text-primary-foreground active:bg-none",
                // Set apart at the end of the context row
                contextMode ? "ml-auto" : "mx-1"
              )}
              // A shortcut to the gear at the context row's end
              extra={
                contextMode
                  ? (close) => (
                      <button
                        type="button"
                        aria-label="Toolbar settings"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          close();
                          setShowSettings(true);
                        }}
                        className="text-muted-foreground active:bg-primary active:text-primary-foreground flex h-[40px] min-w-[40px] items-center justify-center rounded-lg active:bg-none"
                      >
                        <Settings className="h-4 w-4" />
                      </button>
                    )
                  : undefined
              }
            />
          );
        case "char-slash":
          return (
            <KeyLongPressMenu
              key={id}
              label="/"
              keyCode="/"
              menu={SLASH_MENU}
              onKeyPress={onKeyPress}
              className={cn(
                KEY_CLASS,
                "active:bg-primary active:text-primary-foreground active:bg-none"
              )}
            />
          );
        default: {
          const def = getButtonDef(id);
          if (!def || !def.key) return null;
          return (
            <SimpleKeyButton
              key={id}
              displayLabel={def.displayLabel}
              keyCode={def.key}
              highlight={def.highlight}
              onKeyPress={onKeyPress}
            />
          );
        }
      }
    },
    [
      isListening,
      toggleMic,
      handlePaste,
      selectMode,
      onSelectModeChange,
      onImagePicker,
      onKeyPress,
      contextMode,
    ]
  );

  // Render a row of buttons with auto-dividers between groups
  const renderRow = useCallback(
    (buttonIds: ToolbarButtonId[]) => {
      const elements: React.ReactNode[] = [];
      let lastGroup: string | null = null;

      for (const id of buttonIds) {
        const def = getButtonDef(id);
        if (!def) continue;

        // Insert divider between different groups (the context row is
        // short enough to read without them)
        if (!contextMode && lastGroup !== null && def.group !== lastGroup) {
          elements.push(
            <div
              key={`div-${lastGroup}-${def.group}`}
              className="bg-border mx-1 h-6 w-px"
            />
          );
        }
        lastGroup = def.group;

        elements.push(renderButton(id));

        // Insert copy button right after select when in select mode
        if (id === "select" && selectMode && onCopy) {
          elements.push(
            <CopyButton
              key="copy"
              onCopy={handleCopy}
              copyFeedback={copyFeedback}
            />
          );
        }
      }

      return elements;
    },
    [renderButton, selectMode, onCopy, handleCopy, copyFeedback, contextMode]
  );

  const gearButton = (
    <button
      type="button"
      aria-label="Key settings"
      title="Key settings"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        setShowSettings(true);
      }}
      className={cn(
        "active:bg-primary active:text-primary-foreground flex h-[42px] flex-shrink-0 items-center justify-center rounded-xl text-[13px] font-medium active:bg-none",
        contextMode
          ? "text-muted-foreground min-w-[32px] px-1.5"
          : "tkey h-[42px] min-w-[40px] px-3"
      )}
    >
      <Settings className="h-4 w-4" />
    </button>
  );

  if (!visible) return null;

  const settings = (
    <ToolbarSettings
      open={showSettings}
      onClose={() => setShowSettings(false)}
      preferences={preferences}
      onUpdate={updatePreferences}
      row={rowIdFor(context, keyboardUp)}
    />
  );

  // The tabletop base (Fold-Terminal): Claude's keys as a 5-column grid of
  // big keys, the tools on its last row, every other key in ⋯
  if (singleRow && context === "claude")
    return (
      <>
        <PasteModal
          open={showPasteModal}
          onClose={() => setShowPasteModal(false)}
          onPaste={onPaste || sendText}
        />
        <SnippetsModal
          open={showSnippetsModal}
          onClose={() => setShowSnippetsModal(false)}
          onInsert={onPaste || sendText}
        />
        {settings}
        <div
          role="toolbar"
          aria-label="Terminal keys"
          className="bg-background grid grid-cols-5 gap-2 px-5 py-2 font-mono"
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {DECK_KEYS.map(({ label, key, name, tone }) =>
            key === SPECIAL_KEYS.CTRL_C || key === "/" ? (
              <KeyLongPressMenu
                key={key}
                label={label}
                keyCode={key}
                menu={key === "/" ? SLASH_MENU : CTRL_C_MENU}
                onKeyPress={onKeyPress}
                className={cn(BIG_KEY, tone)}
              />
            ) : key === "\r" ? (
              <EnterButton key={key} onPress={onKeyPress} className={BIG_KEY} />
            ) : (
              <button
                key={key}
                type="button"
                aria-label={name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  onKeyPress(key);
                }}
                className={cn(BIG_KEY, tone)}
              >
                {label}
              </button>
            )
          )}
          <BigToolKey
            icon={ImageIcon}
            label="Photo"
            onPress={() => onImagePicker?.()}
          />
          <BigToolKey icon={Clipboard} label="Paste" onPress={handlePaste} />
          <BigToolKey
            icon={FileText}
            label="File or snippet"
            onPress={() => setShowSnippetsModal(true)}
          />
          <BigToolKey
            icon={MousePointer2}
            label="Select text"
            pressed={selectMode}
            onPress={() => onSelectModeChange?.(!selectMode)}
          />
          <MoreKey
            label="All keys"
            keys={allKeys}
            renderKey={renderButton}
            onSettings={() => setShowSettings(true)}
            actions={actions}
            className={BIG_KEY}
          />
        </div>
      </>
    );

  if (adaptive)
    return (
      <>
        <PasteModal
          open={showPasteModal}
          onClose={() => setShowPasteModal(false)}
          onPaste={onPaste || sendText}
        />
        <SnippetsModal
          open={showSnippetsModal}
          onClose={() => setShowSnippetsModal(false)}
          onInsert={onPaste || sendText}
        />
        {settings}
        <div
          className={cn(
            "keybar-row keybar-adaptive bg-background/95 border-border flex items-center gap-1 border-t px-2 py-1.5 backdrop-blur",
            tools && "keybar-tools"
          )}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {tools && (
            <>
              <ToolKey icon={ImagePlus} label="Photo" onPress={tools.onPhoto} />
              <ClipboardKey
                canCopy={tools.canCopy}
                copied={copyFeedback}
                onCopy={handleCopy}
                onPaste={handlePaste}
                onSelectText={tools.onSelectText}
              />
              <ToolKey
                icon={FileText}
                label="File or snippet"
                onPress={tools.onFile}
              />
              <div className="bg-border mx-0.5 h-6 w-px shrink-0" />
            </>
          )}
          {adaptiveKeys.map((k) => (
            <AdaptiveKey key={k.id} k={k} onKeyPress={onKeyPress} />
          ))}
          <MoreKey
            label="All keys"
            keys={allKeys}
            renderKey={renderButton}
            onSettings={() => setShowSettings(true)}
            actions={actions}
          />
        </div>
      </>
    );

  return (
    <>
      <PasteModal
        open={showPasteModal}
        onClose={() => setShowPasteModal(false)}
        onPaste={onPaste || sendText}
      />
      <SnippetsModal
        open={showSnippetsModal}
        onClose={() => setShowSnippetsModal(false)}
        onInsert={onPaste || sendText}
      />
      {settings}

      {/* Row 1 — always visible */}
      <div
        ref={row1Ref}
        className={cn(
          "keybar-row bg-background/95 border-border scrollbar-none flex items-center gap-1 overflow-x-auto border-t px-2 py-1.5 backdrop-blur",
          contextKeys && !pages && "keybar-full",
          pages && contextKeys && "px-0",
          fit.scrolls1 && "keybar-scrolls"
        )}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {contextKeys && pages ? (
          // Two rows: the keys that fit the left page there, the rest on
          // the right one, nothing in the gutter
          <>
            <div
              className="keybar-group flex shrink-0 items-center gap-1 pl-2"
              style={{ width: pages.left }}
            >
              {renderRow(contextKeys.head)}
            </div>
            <div
              aria-hidden="true"
              className="shrink-0"
              style={{ width: pages.gutter }}
            />
            <div className="keybar-group flex min-w-0 flex-1 items-center gap-1 pr-2">
              {renderRow(contextKeys.tail)}
              {gearButton}
            </div>
          </>
        ) : contextKeys ? (
          <>
            {renderRow(contextKeys.head)}
            {contextKeys.more.length > 0 && (
              <MoreKey
                keys={contextKeys.more}
                renderKey={renderButton}
                onSettings={() => setShowSettings(true)}
              />
            )}
            {renderRow(contextKeys.tail)}
            {contextKeys.gear && gearButton}
          </>
        ) : (
          <>
            {renderRow(row1Ids)}
            {/* Gear icon — always last, separated; a quiet one after ^C on
                the context row (held ^C offers it too) */}
            {!contextMode && <div className="bg-border mx-1 h-6 w-px" />}
            {gearButton}
          </>
        )}
      </div>

      {/* Row 2 — only when double layout with buttons */}
      {twoRows && (
        <div
          ref={row2Ref}
          className={cn(
            "keybar-row bg-background/95 border-border scrollbar-none kb-compact-hide flex items-center gap-1 overflow-x-auto px-2 py-1.5 backdrop-blur",
            fit.scrolls2 && "keybar-scrolls"
          )}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {renderRow(row2Ids)}
        </div>
      )}
    </>
  );
}

const KEY_CLASS =
  "tkey h-[42px] min-w-[40px] flex-shrink-0 rounded-xl px-3 text-[13px] font-medium";

// Fold-Terminal's grid keys: 56px, sharing the row
const BIG_KEY =
  "tkey big active:bg-none active:bg-primary active:text-primary-foreground";

/** The grid's first two rows; the tools and ⋯ make the third */
const DECK_KEYS: {
  label: string;
  key: string;
  name?: string;
  tone?: string;
}[] = [
  { label: "Esc", key: SPECIAL_KEYS.ESC, tone: "esc" },
  { label: "\u21E7Tab", key: SPECIAL_KEYS.SHIFT_TAB, name: "Shift Tab" },
  { label: "Tab", key: SPECIAL_KEYS.TAB },
  { label: "/", key: "/" },
  { label: "^C", key: SPECIAL_KEYS.CTRL_C, tone: "danger" },
  { label: "\u2190", key: SPECIAL_KEYS.LEFT, name: "Left" },
  { label: "\u2191", key: SPECIAL_KEYS.UP, name: "Up" },
  { label: "\u2193", key: SPECIAL_KEYS.DOWN, name: "Down" },
  { label: "\u2192", key: SPECIAL_KEYS.RIGHT, name: "Right" },
  { label: "\u23CE", key: "\r", name: "Enter" },
];

/** A tool on the grid's last row: an icon, pressed while its mode is on */
function BigToolKey({
  icon: Icon,
  label,
  pressed,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
      className={cn(
        BIG_KEY,
        pressed && "bg-primary text-primary-foreground bg-none"
      )}
    >
      <Icon aria-hidden className="h-5 w-5" />
    </button>
  );
}

const NO_KEYS: ToolbarButtonId[] = [];

// The quiet gear on the context row and the gap before it
const GEAR_PX = 36;

// Keys tapped again and again: ⋯ stays open for them
const REPEAT_KEYS = new Set<string>([
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "arrow-down",
  "backspace",
  "cursor",
]);

/** Where the page holding `x` starts: right of the open Duo's fold, or 0 */
function pageStart(x: number): number {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const fold =
    root.dataset.hinge !== undefined
      ? parseFloat(style.getPropertyValue("--hinge-x")) + FOLD_CLEAR
      : root.dataset.fold === "vertical"
        ? parseFloat(style.getPropertyValue("--fold-end"))
        : NaN;
  return Number.isFinite(fold) && x >= fold ? fold : 0;
}

/**
 * ⋯: the context row's keys that don't fit, in order, in a panel above it
 * that opens leftward from the key, so it stays on the key's own page.
 * A key taps through and closes it (the arrows and the like keep it open
 * for the next tap); the key settings come last.
 */
function MoreKey({
  label = "More keys",
  keys,
  renderKey,
  onSettings,
  actions,
  className = KEY_CLASS,
}: {
  label?: string;
  keys: ToolbarButtonId[];
  renderKey: (id: ToolbarButtonId) => React.ReactNode;
  onSettings: () => void;
  /** Listed under the keys, each closing the panel */
  actions?: RowAction[];
  className?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  // A touch outside, Esc, a scroll or a resize puts it away
  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      )
        close();
    };
    // Before xterm or the composer sees it (focus stays there), so Esc
    // closes the panel without also interrupting Claude
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [anchor, close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={!!anchor}
        title={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor((open) =>
            open ? null : (buttonRef.current?.getBoundingClientRect() ?? null)
          );
        }}
        className={cn(
          className,
          anchor
            ? "bg-primary text-primary-foreground bg-none"
            : "active:bg-primary active:text-primary-foreground active:bg-none"
        )}
      >
        <Ellipsis className="h-4 w-4" />
      </button>
      {anchor &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            className="bg-popover border-border fixed z-50 flex flex-wrap justify-end gap-1 rounded-xl border p-1.5 shadow-lg"
            style={{
              bottom: innerHeight - anchor.top + 6,
              right: Math.max(4, innerWidth - anchor.right),
              maxWidth: Math.min(
                320,
                anchor.right - pageStart(anchor.left) - 8
              ),
            }}
            // Keys stop their clicks, so this hears them on the way down
            onClickCapture={(e) => {
              const id = (e.target as HTMLElement).closest<HTMLElement>(
                "[data-more-key]"
              )?.dataset.moreKey;
              if (!id || !REPEAT_KEYS.has(id)) setTimeout(close);
            }}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {keys.map((id) => (
              <div key={id} data-more-key={id} className="contents">
                {renderKey(id)}
              </div>
            ))}
            <button
              type="button"
              aria-label="Key settings"
              title="Key settings"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onSettings();
              }}
              className="text-muted-foreground active:bg-primary active:text-primary-foreground flex h-[40px] min-w-[40px] items-center justify-center rounded-xl active:bg-none"
            >
              <Settings className="h-4 w-4" />
            </button>
            {actions && actions.length > 0 && (
              <div className="border-border mt-1 grid w-full grid-cols-2 gap-0.5 border-t pt-1.5">
                {actions.map(({ icon: Icon, label, onSelect }) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      close();
                      onSelect();
                    }}
                    className="text-foreground active:bg-muted flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-[13px]"
                  >
                    <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

// Held ^C and / give the rarer keys
const CTRL_C_MENU: MenuKey[] = [
  { label: "^D", key: SPECIAL_KEYS.CTRL_D },
  { label: "^Z", key: SPECIAL_KEYS.CTRL_Z },
  { label: "^L", key: SPECIAL_KEYS.CTRL_L },
];
const SLASH_MENU: MenuKey[] = ["~", "|", ">", "-", "_"].map((c) => ({
  label: c,
  key: c,
}));

// A key at its narrowest (globals.css) plus the gap after it, and the
// row's padding and the divider before the gear, less the last key's gap
const KEY_STEP_PX = 32;
const ROW_INSET_PX = 21;

/** The row's width inside its border (padding included, so a row that
    switches to scrolling doesn't change it) */
function useRowWidth(el: HTMLDivElement | null) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

const SHORT_LANDSCAPE = "(orientation: landscape) and (max-height: 719px)";

function useShortLandscape() {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(SHORT_LANDSCAPE);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return matches;
}
