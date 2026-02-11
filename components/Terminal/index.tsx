"use client";

import {
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useState,
  useMemo,
  useEffect,
} from "react";
import { useTheme } from "next-themes";
import "@xterm/xterm/css/xterm.css";
import {
  ImagePlus,
  WifiOff,
  Upload,
  Loader2,
  Copy,
  ClipboardPaste,
  MousePointer2,
  Eraser,
  TerminalSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SearchBar } from "./SearchBar";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { TerminalToolbar } from "./TerminalToolbar";
import { useTerminalConnection, useTerminalSearch } from "./hooks";
import type { TerminalScrollState } from "./hooks";
import { useViewport } from "@/hooks/useViewport";
import { useFileDrop } from "@/hooks/useFileDrop";
import { uploadFileToTemp } from "@/lib/file-upload";
import { ImagePicker } from "@/components/ImagePicker";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";

export type { TerminalScrollState };

export interface TerminalHandle {
  sendCommand: (command: string) => void;
  sendInput: (data: string) => void;
  focus: () => void;
  getScrollState: () => TerminalScrollState | null;
  restoreScrollState: (state: TerminalScrollState) => void;
}

interface TerminalProps {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onBeforeUnmount?: (scrollState: TerminalScrollState) => void;
  initialScrollState?: TerminalScrollState;
  /** Show image picker button (default: true) */
  showImageButton?: boolean;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  function Terminal(
    {
      onConnected,
      onDisconnected,
      onBeforeUnmount,
      initialScrollState,
      showImageButton = true,
    },
    ref
  ) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { isMobile } = useViewport();
    const { theme: currentTheme, resolvedTheme } = useTheme();
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [copiedFlash, setCopiedFlash] = useState(false);

    // Use the full theme string (e.g., "dark-purple") for terminal theming
    const terminalTheme = useMemo(() => {
      // For system theme, use the resolved theme
      if (currentTheme === "system") {
        return resolvedTheme || "dark";
      }
      return currentTheme || "dark";
    }, [currentTheme, resolvedTheme]);

    const {
      connectionState,
      isAtBottom,
      xtermRef,
      searchAddonRef,
      scrollToBottom,
      copySelection,
      sendInput,
      sendCommand,
      execViaWs,
      focus,
      getScrollState,
      restoreScrollState,
      reconnect,
    } = useTerminalConnection({
      terminalRef,
      onConnected,
      onDisconnected,
      onBeforeUnmount,
      initialScrollState,
      isMobile,
      theme: terminalTheme,
      selectMode,
    });

    const {
      searchVisible,
      searchQuery,
      setSearchQuery,
      searchInputRef,
      closeSearch,
      findNext,
      findPrevious,
    } = useTerminalSearch(searchAddonRef, xtermRef);

    // Handle image selection - paste file path into terminal
    const handleImageSelect = useCallback(
      (filePath: string) => {
        sendInput(filePath);
        setShowImagePicker(false);
        focus();
      },
      [sendInput, focus]
    );

    // Handle file drop - upload and insert path into terminal
    const handleFileDrop = useCallback(
      async (file: File) => {
        setIsUploading(true);
        try {
          const path = await uploadFileToTemp(file);
          if (path) {
            sendInput(path);
            focus();
          }
        } catch (err) {
          console.error("Failed to upload file:", err);
        } finally {
          setIsUploading(false);
        }
      },
      [sendInput, focus]
    );

    // Drag and drop for file uploads
    const { isDragging, dragHandlers } = useFileDrop(
      containerRef,
      handleFileDrop,
      { disabled: isUploading || showImagePicker }
    );

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
      sendCommand,
      sendInput,
      focus,
      getScrollState,
      restoreScrollState,
    }));

    // Copy text to clipboard with fallback for non-HTTPS contexts
    const writeClipboard = useCallback(async (text: string): Promise<boolean> => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // Clipboard API failed (e.g. HTTP context) — fall through to fallback
      }
      // Fallback: use execCommand('copy')
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        return true;
      } catch {
        return false;
      }
    }, []);

    // Fetch tmux paste buffer contents via WebSocket (bypasses reverse proxy 403)
    const getTmuxBuffer = useCallback(async (): Promise<string> => {
      return execViaWs("tmux save-buffer - 2>/dev/null");
    }, [execViaWs]);

    // Context menu actions
    const handleContextCopy = useCallback(async () => {
      // Try xterm selection first (from Shift+drag)
      const selection = xtermRef.current?.getSelection();
      if (selection) {
        await writeClipboard(selection);
        return;
      }
      // Fall back to tmux buffer (from mouse drag selection)
      const text = await getTmuxBuffer();
      if (text) {
        await writeClipboard(text);
      }
    }, [xtermRef, writeClipboard, getTmuxBuffer]);

    const handleContextPaste = useCallback(async () => {
      try {
        const text = await navigator.clipboard?.readText?.();
        if (text) {
          sendInput(text);
        }
      } catch {
        // Clipboard API not available in non-secure contexts — user can paste via Cmd+V
      }
    }, [sendInput]);

    const handleContextSelectAll = useCallback(() => {
      xtermRef.current?.selectAll();
    }, [xtermRef]);

    const handleContextClear = useCallback(() => {
      xtermRef.current?.clear();
    }, [xtermRef]);

    // Show tmux menu via prefix + m binding (configured in tmux setup)
    const handleShowTmuxMenu = useCallback(() => {
      sendInput("\x02m");
    }, [sendInput]);

    // Track visual viewport for iOS keyboard
    // We use explicit height instead of fixed positioning to stay in document flow
    const [keyboardHeight, setKeyboardHeight] = useState(0);

    useEffect(() => {
      if (!isMobile || typeof window === "undefined") return;

      const viewport = window.visualViewport;
      if (!viewport) return;

      // Track the initial full height to detect keyboard
      const fullHeight = window.innerHeight;

      const updateViewport = () => {
        // Calculate how much space the keyboard is taking
        const currentHeight = viewport.height;
        const kbHeight = Math.max(
          0,
          fullHeight - currentHeight - viewport.offsetTop
        );
        setKeyboardHeight(kbHeight);
      };

      // Initial measurement
      updateViewport();

      viewport.addEventListener("resize", updateViewport);
      viewport.addEventListener("scroll", updateViewport);

      return () => {
        viewport.removeEventListener("resize", updateViewport);
        viewport.removeEventListener("scroll", updateViewport);
      };
    }, [isMobile]);

    // Extract terminal text for select mode overlay
    // Select mode: capture full scrollback via tmux capture-pane
    const [terminalText, setTerminalText] = useState("");

    useEffect(() => {
      if (!selectMode) {
        setTerminalText("");
        return;
      }

      // Try to get the full tmux scrollback first
      const fetchTmuxBuffer = async () => {
        const output = await execViaWs("tmux capture-pane -p -S -50000 2>/dev/null");
        if (output.length > 0) {
          setTerminalText(output);
          return;
        }

        // Fallback: read from xterm buffer
        if (xtermRef.current) {
          const term = xtermRef.current;
          const buffer = term.buffer.active;
          const totalRows = buffer.baseY + term.rows;
          const lines: string[] = [];
          for (let i = 0; i < totalRows; i++) {
            const line = buffer.getLine(i);
            if (line) lines.push(line.translateToString(true));
          }
          while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
            lines.pop();
          }
          setTerminalText(lines.join("\n"));
        }
      };

      fetchTmuxBuffer();
    }, [selectMode, xtermRef]);

    // Auto-copy: when user drags to select text (tmux handles the selection),
    // grab tmux buffer on mouseup and copy to system clipboard
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
      const container = terminalRef.current;
      if (!container) return;

      // Use document-level listeners with capture phase to ensure we see
      // events even if xterm's canvas stops propagation
      const onMouseDown = (e: MouseEvent) => {
        if (e.button === 0 && container.contains(e.target as Node)) {
          dragStartRef.current = { x: e.clientX, y: e.clientY };
        }
      };

      const onMouseUp = async (e: MouseEvent) => {
        if (e.button !== 0 || !dragStartRef.current) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        dragStartRef.current = null;

        // Only auto-copy if it was a drag (>10px movement)
        if (distance < 10) return;

        // Wait for tmux to process the selection
        await new Promise((r) => setTimeout(r, 200));

        const text = await getTmuxBuffer();
        if (text) {
          const ok = await writeClipboard(text);
          if (ok) {
            setCopiedFlash(true);
            setTimeout(() => setCopiedFlash(false), 1500);
          }
        }
      };

      document.addEventListener("mousedown", onMouseDown, true);
      document.addEventListener("mouseup", onMouseUp, true);
      return () => {
        document.removeEventListener("mousedown", onMouseDown, true);
        document.removeEventListener("mouseup", onMouseUp, true);
      };
    }, [terminalRef, getTmuxBuffer, writeClipboard]);

    return (
      <div
        ref={containerRef}
        className="bg-background flex flex-col overflow-hidden"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          // On mobile, shrink container when keyboard is open
          paddingBottom:
            isMobile && keyboardHeight > 0 ? keyboardHeight : undefined,
        }}
        {...dragHandlers}
      >
        {/* Search Bar */}
        <SearchBar
          ref={searchInputRef}
          visible={searchVisible}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onFindNext={findNext}
          onFindPrevious={findPrevious}
          onClose={closeSearch}
        />

        {/* Terminal container - NO padding! FitAddon reads offsetHeight which includes padding */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={terminalRef}
              className={cn(
                "terminal-container min-h-0 w-full flex-1 overflow-hidden",
                selectMode && "ring-primary ring-2 ring-inset",
                isDragging && "ring-primary ring-2 ring-inset"
              )}
              onClick={focus}
              onTouchStart={
                selectMode
                  ? (e) => {
                      // Only stop if touch is on actual selected text
                      const selection = window.getSelection();
                      if (selection && selection.toString().length > 0) {
                        e.stopPropagation();
                      }
                    }
                  : undefined
              }
              onTouchEnd={
                selectMode
                  ? (e) => {
                      const selection = window.getSelection();
                      if (selection && selection.toString().length > 0) {
                        e.stopPropagation();
                      }
                    }
                  : undefined
              }
            />
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48" onCloseAutoFocus={(e) => {
              e.preventDefault();
              // Double-RAF: first waits for Radix portal removal, second ensures
              // the browser has fully settled focus before we steal it back to xterm
              requestAnimationFrame(() => requestAnimationFrame(() => focus()));
            }}>
            <ContextMenuItem onSelect={handleContextCopy}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
              <ContextMenuShortcut>⌘C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleContextPaste}>
              <ClipboardPaste className="mr-2 h-4 w-4" />
              Paste
              <ContextMenuShortcut>Right-click / ⌘V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={handleContextSelectAll}>
              <MousePointer2 className="mr-2 h-4 w-4" />
              Select All
              <ContextMenuShortcut>⌘A</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleContextClear}>
              <Eraser className="mr-2 h-4 w-4" />
              Clear
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={handleShowTmuxMenu}>
              <TerminalSquare className="mr-2 h-4 w-4" />
              Tmux Menu
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Copied to clipboard flash */}
        {copiedFlash && (
          <div className="animate-in fade-in absolute top-3 left-1/2 z-50 -translate-x-1/2 rounded-full bg-green-500 px-3 py-1 text-xs text-white shadow-lg">
            Copied to clipboard
          </div>
        )}

        {/* Select mode overlay - shows terminal text in a selectable format */}
        {selectMode && (
          <div
            className="bg-background absolute inset-0 z-40 flex flex-col"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <div className="bg-primary text-primary-foreground flex items-center justify-between px-3 py-2 text-xs font-medium">
              <span>Select text below, then tap Copy</span>
              <button
                onClick={() => setSelectMode(false)}
                className="bg-primary-foreground/20 rounded px-2 py-0.5 text-xs"
              >
                Done
              </button>
            </div>
            <pre
              className="flex-1 overflow-auto p-3 font-mono text-xs break-all whitespace-pre-wrap select-text"
              style={{
                userSelect: "text",
                WebkitUserSelect: "text",
              }}
            >
              {terminalText}
            </pre>
          </div>
        )}

        {/* Drag and drop overlay */}
        {isDragging && (
          <div className="bg-primary/10 pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <div className="border-primary bg-background/90 rounded-lg border px-6 py-4 text-center shadow-lg">
              <Upload className="text-primary mx-auto mb-2 h-8 w-8" />
              <p className="text-sm font-medium">Drop file to upload</p>
            </div>
          </div>
        )}

        {/* Upload in progress overlay */}
        {isUploading && (
          <div className="bg-background/50 pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <div className="bg-background rounded-lg border px-6 py-4 text-center shadow-lg">
              <Loader2 className="text-primary mx-auto mb-2 h-6 w-6 animate-spin" />
              <p className="text-sm">Uploading file...</p>
            </div>
          </div>
        )}

        {/* Image picker button - desktop only, for agent terminals */}
        {!isMobile && showImageButton && (
          <button
            onClick={() => setShowImagePicker(true)}
            className="bg-secondary hover:bg-accent absolute top-3 right-3 z-40 flex h-9 w-9 items-center justify-center rounded-full shadow-lg transition-all"
            title="Select image"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
        )}

        {/* Image picker modal */}
        {showImagePicker && (
          <ImagePicker
            initialPath="~"
            onSelect={handleImageSelect}
            onClose={() => setShowImagePicker(false)}
          />
        )}

        {/* Scroll to bottom button */}
        <ScrollToBottomButton visible={!isAtBottom} onClick={scrollToBottom} />

        {/* Mobile: Toolbar with special keys (native keyboard handles text) */}
        {isMobile && (
          <TerminalToolbar
            onKeyPress={sendInput}
            onImagePicker={() => setShowImagePicker(true)}
            onCopy={copySelection}
            selectMode={selectMode}
            onSelectModeChange={setSelectMode}
            visible={true}
          />
        )}

        {/* Connection status overlays */}
        {connectionState === "connecting" && (
          <div className="bg-background absolute inset-0 z-20 flex flex-col items-center justify-center gap-3">
            <div className="bg-primary h-2 w-2 animate-pulse rounded-full" />
            <span className="text-muted-foreground text-sm">Connecting...</span>
          </div>
        )}

        {connectionState === "reconnecting" && (
          <div className="absolute top-4 left-4 flex items-center gap-2 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-400">
            <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            Reconnecting...
          </div>
        )}

        {/* Disconnected overlay - shows tap to reconnect button */}
        {connectionState === "disconnected" && (
          <button
            onClick={reconnect}
            className="bg-background/80 active:bg-background/90 absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 backdrop-blur-sm transition-all"
          >
            <WifiOff className="text-muted-foreground h-8 w-8" />
            <span className="text-foreground text-sm font-medium">
              Connection lost
            </span>
            <span className="bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-medium">
              Tap to reconnect
            </span>
          </button>
        )}
      </div>
    );
  }
);
