"use client";

import { useCallback, useState, useMemo } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  type ToolbarButtonId,
  SPECIAL_KEYS,
  getButtonDef,
  useToolbarPreferences,
} from "./toolbar-config";
import { ToolbarSettings } from "./ToolbarSettings";

interface TerminalToolbarProps {
  onKeyPress: (key: string) => void;
  onPaste?: (text: string) => void;
  onImagePicker?: () => void;
  onCopy?: () => boolean; // Returns true if selection was copied
  selectMode?: boolean;
  onSelectModeChange?: (enabled: boolean) => void;
  visible?: boolean;
  onLayoutChange?: (layout: "single" | "double") => void;
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
function SnippetsModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
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
        "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
        "active:bg-primary active:text-primary-foreground",
        highlight
          ? "bg-red-500/20 text-red-500"
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
        "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
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
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
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
        "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
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
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
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
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
    >
      <FileText className="h-4 w-4" />
    </button>
  );
}

function ShiftButton({
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
        "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
      )}
    >
      {"\u21E7"}
    </button>
  );
}

function EnterButton({
  shiftActive,
  onPress,
}: {
  shiftActive: boolean;
  onPress: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onPress(shiftActive ? "\n" : "\r");
      }}
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
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
  const [cursorMoveMode, setCursorMoveMode] = useState<"left" | "right" | null>(null);
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
          const newMode = deltaX > 20 ? "right" : deltaX < -20 ? "left" : cursorMoveMode;

          setCursorMoveMode(newMode);
          onKeyPress(newMode === "right" ? SPECIAL_KEYS.RIGHT : SPECIAL_KEYS.LEFT);
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
        "flex-shrink-0 rounded-md px-3 py-1.5 text-xs font-medium",
        cursorMoveMode
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
      )}
      title="Tap: space | Hold: slide left/right to move cursor"
    >
      {cursorMoveMode ? (cursorMoveMode === "left" ? "\u25C4" : "\u25BA") : "\u2395"}
    </button>
  );
}

function BackspaceButton({
  onKeyPress,
}: {
  onKeyPress: (key: string) => void;
}) {
  const [longPressInterval, setLongPressInterval] = useState<NodeJS.Timeout | null>(null);

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
        (e.currentTarget as HTMLElement).dataset.timeout = String(timeout as unknown as number);
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
      className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
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
        "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
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
}: TerminalToolbarProps) {
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showSnippetsModal, setShowSnippetsModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const { preferences, updatePreferences: persistPreferences } = useToolbarPreferences();

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

  // Resolve visible buttons for each row, filtering out conditional buttons
  const resolvedRow1 = useMemo(
    () =>
      preferences.row1.filter((id) => {
        const def = getButtonDef(id);
        if (!def) return false;
        if (def.conditional === "mic" && !isMicSupported) return false;
        if (def.conditional === "image" && !onImagePicker) return false;
        if (def.conditional === "select-mode" && !onSelectModeChange)
          return false;
        return true;
      }),
    [preferences.row1, isMicSupported, onImagePicker, onSelectModeChange]
  );

  const resolvedRow2 = useMemo(
    () =>
      preferences.row2.filter((id) => {
        const def = getButtonDef(id);
        if (!def) return false;
        if (def.conditional === "mic" && !isMicSupported) return false;
        if (def.conditional === "image" && !onImagePicker) return false;
        if (def.conditional === "select-mode" && !onSelectModeChange)
          return false;
        return true;
      }),
    [preferences.row2, isMicSupported, onImagePicker, onSelectModeChange]
  );

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
        case "shift":
          return (
            <ShiftButton
              key={id}
              active={shiftActive}
              onToggle={() => setShiftActive((s) => !s)}
            />
          );
        case "enter":
          return (
            <EnterButton
              key={id}
              shiftActive={shiftActive}
              onPress={(k) => {
                onKeyPress(k);
                setShiftActive(false);
              }}
            />
          );
        case "cursor":
          return <CursorTrackpadButton key={id} onKeyPress={onKeyPress} />;
        case "backspace":
          return <BackspaceButton key={id} onKeyPress={onKeyPress} />;
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
      shiftActive,
      onKeyPress,
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

        // Insert divider between different groups
        if (lastGroup !== null && def.group !== lastGroup) {
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
    [renderButton, selectMode, onCopy, handleCopy, copyFeedback]
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
        className="bg-background/95 border-border scrollbar-none flex items-center gap-1 overflow-x-auto border-t px-2 py-1.5 backdrop-blur"
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {renderRow(resolvedRow1)}

        {/* Gear icon — always last, separated */}
        <div className="bg-border mx-1 h-6 w-px" />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setShowSettings(true);
          }}
          className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* Row 2 — only when double layout with buttons */}
      {preferences.layout === "double" && resolvedRow2.length > 0 && (
        <div
          className="bg-background/95 border-border scrollbar-none flex items-center gap-1 overflow-x-auto px-2 py-1.5 backdrop-blur"
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {renderRow(resolvedRow2)}
        </div>
      )}
    </>
  );
}
