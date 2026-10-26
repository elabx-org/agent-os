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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useLongPress } from "@/hooks/useLongPress";
import {
  type KeysContext,
  type ToolbarButtonId,
  SPECIAL_KEYS,
  contextRow,
  getButtonDef,
  useToolbarPreferences,
} from "./toolbar-config";
import { ToolbarSettings } from "./ToolbarSettings";
import { KeyLongPressMenu, type MenuKey } from "./KeyLongPressMenu";

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
}

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
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
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
        "flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium",
        "active:bg-primary active:text-primary-foreground",
        highlight
          ? "mx-1 border border-red-500/40 bg-red-500/15 text-red-400"
          : "bg-secondary text-secondary-foreground"
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
        "flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium",
        isListening
          ? "animate-pulse bg-red-500 text-white"
          : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
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
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium"
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
        "flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
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
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium"
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
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium"
    >
      <FileText className="h-4 w-4" />
    </button>
  );
}

// Tap: return. Hold: a new line without sending (Claude Code's ⇧↵)
function EnterButton({ onPress }: { onPress: (key: string) => void }) {
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
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium"
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
        "flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium",
        cursorMoveMode
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
      )}
      title="Tap: space | Hold: slide left/right to move cursor"
    >
      {cursorMoveMode
        ? cursorMoveMode === "left"
          ? "\u25C4"
          : "\u25BA"
        : "\u2395"}
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
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium"
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
        "flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium",
        copyFeedback
          ? "bg-green-500 text-white"
          : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
      )}
    >
      <Copy className="h-4 w-4" />
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
}: TerminalToolbarProps) {
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showSnippetsModal, setShowSnippetsModal] = useState(false);
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
  const contextMode = preferences.mode === "context";
  const sourceRow1 = contextMode
    ? contextRow(context, keyboardUp)
    : preferences.row1;
  const sourceRow2 = contextMode ? NO_KEYS : preferences.row2;

  // Resolve visible buttons for each row, filtering out conditional buttons
  const resolvedRow1 = useMemo(
    () =>
      sourceRow1.filter((id) => {
        const def = getButtonDef(id);
        if (!def) return false;
        if (def.conditional === "mic" && !isMicSupported) return false;
        if (def.conditional === "image" && !onImagePicker) return false;
        if (def.conditional === "select-mode" && !onSelectModeChange)
          return false;
        return true;
      }),
    [sourceRow1, isMicSupported, onImagePicker, onSelectModeChange]
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
  const twoRows = twoRowLayout && resolvedRow2.length > 0 && !mergeRows;
  // What measuring found for these keys at this width: keys to move down
  // (dividers take room too) and which rows still scroll
  const fitKey = [
    rowWidth,
    twoRows,
    mergeRows,
    resolvedRow1.join(),
    resolvedRow2.join(),
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
  const { row1Ids, row2Ids } = useMemo(() => {
    if (mergeRows)
      return {
        row1Ids: Array.from(new Set([...resolvedRow1, ...resolvedRow2])),
        row2Ids: [],
      };
    // Room for this many keys at their narrowest, less one for the gear
    const fits = rowWidth
      ? Math.floor((rowWidth - ROW_INSET_PX) / KEY_STEP_PX) - 1 - fit.trim
      : Infinity;
    if (!twoRows || resolvedRow1.length <= fits || fits < 1)
      return { row1Ids: resolvedRow1, row2Ids: resolvedRow2 };
    return {
      row1Ids: resolvedRow1.slice(0, fits),
      row2Ids: [...resolvedRow1.slice(fits), ...resolvedRow2],
    };
  }, [mergeRows, twoRows, rowWidth, fit.trim, resolvedRow1, resolvedRow2]);
  useLayoutEffect(() => {
    if (!row1El || !rowWidth) return;
    const over = (el: HTMLDivElement | null) =>
      !!el && el.scrollWidth > el.clientWidth + 1;
    if (over(row1El) && !fit.scrolls1) {
      if (twoRows && row1Ids.length > 1)
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
                "active:bg-primary active:text-primary-foreground border border-red-500/40 bg-red-500/15 text-red-400",
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
                        className="text-muted-foreground active:bg-primary active:text-primary-foreground flex h-[40px] min-w-[40px] items-center justify-center rounded-lg"
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
                "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
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

  if (!visible) return null;

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
      <ToolbarSettings
        open={showSettings}
        onClose={() => setShowSettings(false)}
        preferences={preferences}
        onUpdate={updatePreferences}
      />

      {/* Row 1 — always visible */}
      <div
        ref={row1Ref}
        className={cn(
          "keybar-row bg-background/95 border-border scrollbar-none flex items-center gap-1 overflow-x-auto border-t px-2 py-1.5 backdrop-blur",
          fit.scrolls1 && "keybar-scrolls"
        )}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {renderRow(row1Ids)}

        {/* Gear icon — always last, separated; a quiet one after ^C on the
            context row (held ^C offers it too) */}
        {!contextMode && <div className="bg-border mx-1 h-6 w-px" />}
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
            "active:bg-primary active:text-primary-foreground flex h-[40px] flex-shrink-0 items-center justify-center rounded-xl text-[13px] font-medium",
            contextMode
              ? "text-muted-foreground min-w-[32px] px-1.5"
              : "bg-secondary text-secondary-foreground min-w-[40px] px-3"
          )}
        >
          <Settings className="h-4 w-4" />
        </button>
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
  "flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-xl px-3 text-[13px] font-medium";

const NO_KEYS: ToolbarButtonId[] = [];

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
