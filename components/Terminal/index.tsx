"use client";

import {
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
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
import type { KeysContext } from "./toolbar-config";
import { KeybarToggleButton } from "./KeybarToggleButton";
import { Composer } from "./Composer";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import {
  hasQueued,
  isClaudeBusy,
  readClaudePrompt,
  showsQueued,
} from "./queued-messages";
import { DeckPad } from "./DeckPad";
import { useFoldDeck } from "@/hooks/useFoldDeck";
import { COMPOSER_EVENT, getComposerEnabled } from "./typing-assist";
import { useTerminalConnection, useTerminalSearch } from "./hooks";
import type { TerminalScrollState } from "./hooks";
import { useViewport } from "@/hooks/useViewport";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useSnapshot } from "valtio";
import {
  isNative,
  isTextKey,
  onNativeEvent,
  postToNative,
} from "@/lib/native-bridge";
import { mobileNavStore } from "@/stores/mobileNav";
import { KeyboardDebugOverlay, useKeyboardDebug } from "./KeyboardDebugOverlay";
import { useFileDrop } from "@/hooks/useFileDrop";
import { uploadFileToTemp } from "@/lib/file-upload";
import { ImagePicker } from "@/components/ImagePicker";
import { joinWrappedUrls, linkify } from "./linkify";
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
  sendPaste: (data: string) => void;
  focus: () => void;
  getScrollState: () => TerminalScrollState | null;
  restoreScrollState: (state: TerminalScrollState) => void;
}

interface TerminalProps {
  onConnected?: (info: { replacedPty: boolean }) => void;
  onDisconnected?: () => void;
  onBeforeUnmount?: (scrollState: TerminalScrollState) => void;
  initialScrollState?: TerminalScrollState;
  /** Show image picker button (default: true) */
  showImageButton?: boolean;
  /** The session whose unsent composer text is synced (none: not kept) */
  draftId?: string | null;
  /** What runs in that session, from the pane's session list */
  agentType?: string;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  function Terminal(
    {
      onConnected,
      onDisconnected,
      onBeforeUnmount,
      initialScrollState,
      showImageButton = true,
      draftId,
      agentType: sessionAgentType,
    },
    ref
  ) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { isMobile, isTouch } = useViewport();
    const { theme: currentTheme, resolvedTheme } = useTheme();
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [copiedFlash, setCopiedFlash] = useState(false);
    const [toolbarVisible, setToolbarVisible] = useState(() => {
      if (typeof window === "undefined") return true;
      const stored = localStorage.getItem("terminalToolbarVisible");
      return stored === null ? true : stored === "true";
    });
    const keyboardDebug = useKeyboardDebug();
    const [composerEnabled, setComposerEnabled] = useState(() =>
      typeof window === "undefined" ? true : getComposerEnabled()
    );
    const [composerText, setComposerText] = useSessionDraft(draftId);

    useEffect(() => {
      const onChange = (e: Event) =>
        setComposerEnabled((e as CustomEvent<boolean>).detail);
      window.addEventListener(COMPOSER_EVENT, onChange);
      return () => window.removeEventListener(COMPOSER_EVENT, onChange);
    }, []);

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
      sendPaste,
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
      onLongPress: () => setSelectMode(true),
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

    // Handle image selection - add file path to the composer, or paste into terminal
    const composerOnRef = useRef(false);
    const handleImageSelect = useCallback(
      (filePath: string) => {
        setShowImagePicker(false);
        if (composerOnRef.current) {
          setComposerText(
            (t) => (t && !t.endsWith(" ") ? `${t} ` : t) + filePath
          );
          return;
        }
        sendInput(filePath);
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
      sendPaste,
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
          sendPaste(text);
        }
      } catch {
        // Clipboard API not available in non-secure contexts — user can paste via Cmd+V
      }
    }, [sendPaste]);

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

    // Keybar follows touch input, not width: the iPhone Duo inner display
    // is wider than the mobile breakpoint but still uses the on-screen keyboard
    const showKeybar = isMobile || isTouch;
    // The iOS app sizes the page above the keyboard itself
    const keyboard = useKeyboardInset(showKeybar && !isNative());
    // ...and shows the keys on the keyboard, so the keybar steps aside
    const { nativeKeyboard } = useSnapshot(mobileNavStore);
    // Split/floating keyboards cover the bottom without shrinking the viewport,
    // so move the keybar to the top where it stays reachable
    // Half open like a laptop: output above the fold, input on the deck below
    const deck = useFoldDeck(containerRef, keyboard.height, showKeybar);
    const keybarAtTop = keyboard.mode === "floating" && !deck;
    // Laptop pose while typing: the composer is the screen's last line, above
    // the fold, and the key rows fill the deck between the fold and the keyboard
    const laptopKeys = !!deck && nativeKeyboard;

    // The key row follows what runs here: Claude Code or a shell (a tab
    // with no session, a shell session, the other agents' CLIs)
    const agentType = draftId ? (sessionAgentType ?? "claude") : "shell";
    const keysContext: KeysContext =
      agentType === "claude" ? "claude" : "shell";
    const keyboardUp = keyboard.height > 0 || nativeKeyboard;
    // The app's keyboard bar shows the same row; told whenever this
    // terminal takes focus and when the row changes while it has it
    const nativeKeys =
      keyboardUp && keysContext === "claude" ? "claude-up" : keysContext;
    useEffect(() => {
      const el = containerRef.current;
      if (!el || !isNative()) return;
      const post = () => postToNative({ type: "keys", context: nativeKeys });
      if (el.contains(document.activeElement)) post();
      el.addEventListener("focusin", post);
      return () => el.removeEventListener("focusin", post);
    }, [nativeKeys]);

    const toggleToolbar = () => {
      const next = !toolbarVisible;
      setToolbarVisible(next);
      localStorage.setItem("terminalToolbarVisible", String(next));
    };

    // On the deck the page's key rows replace the app's keyboard bar
    const nativeBarHidden = !!deck && isNative();
    useEffect(() => {
      if (!nativeBarHidden) return;
      postToNative({ type: "keybar", hidden: true });
      return () => postToNative({ type: "keybar", hidden: false });
    }, [nativeBarHidden]);

    const composerOn = showKeybar && composerEnabled;
    composerOnRef.current = composerOn;

    // With the composer on, tapping the terminal (scroll, select) shouldn't
    // open the keyboard: xterm's textarea gets inputmode="none"
    useEffect(() => {
      const apply = () => {
        const textarea = terminalRef.current?.querySelector(".xterm textarea");
        if (!textarea) return;
        if (composerOn) textarea.setAttribute("inputmode", "none");
        else textarea.removeAttribute("inputmode");
      };
      apply();
      // xterm creates its textarea after connecting
      const timer = setTimeout(apply, 500);
      return () => clearTimeout(timer);
    }, [composerOn, connectionState]);

    // On iOS that focused inputmode="none" textarea swallows taps elsewhere on
    // the page: they end without a click. A touch outside the terminal lets go
    // of its focus first, as a tap would with the keyboard up.
    useEffect(() => {
      if (!composerOn) return;
      const onTouch = (e: TouchEvent) => {
        const active = document.activeElement;
        if (!(active instanceof HTMLTextAreaElement)) return;
        if (active.getAttribute("inputmode") !== "none") return;
        if (!terminalRef.current?.contains(active)) return;
        if (containerRef.current?.contains(e.target as Node)) return;
        active.blur();
      };
      document.addEventListener("touchstart", onTouch, true);
      return () => document.removeEventListener("touchstart", onTouch, true);
    }, [composerOn]);

    // Claude Code treats input arriving with a newline as a paste, so Enter
    // goes separately after the text has been taken
    // What the composer sent while Claude was busy: Claude queues it
    const queuedRef = useRef<string[]>([]);
    const sendFromComposer = useCallback(
      (text: string) => {
        const term = xtermRef.current;
        // Added to what's already waiting, if anything is
        if (text && term)
          queuedRef.current = !isClaudeBusy(term)
            ? []
            : hasQueued(term)
              ? [...queuedRef.current, text]
              : [text];
        if (text.includes("\n")) sendPaste(text);
        else if (text) sendInput(text);
        setTimeout(() => sendInput("\r"), text ? 80 : 0);
      },
      [sendInput, sendPaste, xtermRef]
    );

    // With the composer on, xterm's keyboard is off, so a tap on the terminal
    // (Claude's old prompt line included) goes to the composer instead.
    // Scrolls, drags and select mode are left alone.
    useEffect(() => {
      const el = terminalRef.current;
      if (!el || !composerOn || selectMode) return;
      let start: { x: number; y: number; t: number } | null = null;
      const onStart = (e: TouchEvent) => {
        const t = e.touches[0];
        start =
          e.touches.length === 1
            ? { x: t.clientX, y: t.clientY, t: Date.now() }
            : null;
      };
      const onEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0];
        if (!start || !t) return;
        const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y);
        const quick = Date.now() - start.t < 400;
        start = null;
        if (moved > 10 || !quick) return;
        const box = keybarRef.current?.querySelector<HTMLTextAreaElement>(
          "textarea[data-composer]"
        );
        if (box && document.activeElement !== box) {
          e.preventDefault();
          box.focus();
        }
      };
      el.addEventListener("touchstart", onStart, { passive: true });
      el.addEventListener("touchend", onEnd);
      return () => {
        el.removeEventListener("touchstart", onStart);
        el.removeEventListener("touchend", onEnd);
      };
    }, [composerOn, selectMode]);

    /** Puts text in the composer at the caret, if the composer has focus */
    const insertInComposer = useCallback((text: string) => {
      const el = document.activeElement;
      if (
        !(el instanceof HTMLTextAreaElement) ||
        el.dataset.composer === undefined
      )
        return false;
      const { selectionStart: from, selectionEnd: to, value } = el;
      setComposerText(value.slice(0, from) + text + value.slice(to));
      const at = from + text.length;
      requestAnimationFrame(() => el.setSelectionRange(at, at));
      return true;
    }, []);

    // Up (or Esc) puts the messages Claude is holding back in its own prompt,
    // which the composer hides. If they came from the composer, move them
    // back there. ^U clears a line of the prompt without interrupting Claude
    // (^C would), and a backspace joins the line above.
    const reclaimQueued = useCallback(() => {
      const term = xtermRef.current;
      const queued = queuedRef.current;
      if (!term || !queued.length) return;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      void (async () => {
        let back = false;
        for (let tries = 0; tries < 8 && !back; tries++) {
          await wait(150);
          back = showsQueued(readClaudePrompt(term), queued);
        }
        if (!back) return;
        const steps = 2 * Math.ceil(queued.join("\n").length / 20) + 10;
        // Gone twice in a row: a short terminal can show just the emptied line
        const gone = async () => {
          if (showsQueued(readClaudePrompt(term), queued)) return false;
          await wait(150);
          return !showsQueued(readClaudePrompt(term), queued);
        };
        let cleared = false;
        for (let step = 0; step < steps && !cleared; step++) {
          sendInput(step % 2 ? "\x7f" : "\x15");
          await wait(50);
          cleared = await gone();
        }
        if (!cleared) return;
        queuedRef.current = [];
        setComposerText((current) =>
          [...queued, current].filter(Boolean).join("\n")
        );
      })();
    }, [xtermRef, sendInput]);

    // The keybar's newline key adds a line to the composer while it has focus
    const keybarKeyPress = useCallback(
      (key: string) => {
        if (isTextKey(key) && insertInComposer(key)) return;
        const term = xtermRef.current;
        const queued =
          (key === "\x1b[A" || key === "\x1b") &&
          composerOnRef.current &&
          queuedRef.current.length > 0 &&
          !!term &&
          hasQueued(term);
        sendInput(key);
        if (queued) reclaimQueued();
      },
      [sendInput, insertInComposer, reclaimQueued, xtermRef]
    );

    // Keys and pastes from the iOS app's keyboard bar go to the terminal being
    // typed in; a paste into the terminal is bracketed, so Claude Code takes it
    // as one block
    useEffect(
      () =>
        onNativeEvent((event) => {
          if (!containerRef.current?.contains(document.activeElement)) return;
          if (event.type === "key") keybarKeyPress(event.key);
          else if (event.type === "paste" && !insertInComposer(event.text))
            xtermRef.current?.paste(event.text);
          else if (event.type === "image") {
            // The picker is a sheet the keyboard would cover
            (document.activeElement as HTMLElement | null)?.blur();
            setShowImagePicker(true);
          }
        }),
      [keybarKeyPress, insertInComposer, xtermRef]
    );

    // Direct typing for Claude Code's / and @ pickers; back to the composer on blur
    const typeInTerminal = useCallback(() => {
      const textarea = terminalRef.current?.querySelector(".xterm textarea");
      if (!textarea) return;
      textarea.setAttribute("inputmode", "text");
      textarea.addEventListener(
        "blur",
        () => {
          if (composerOnRef.current) textarea.setAttribute("inputmode", "none");
        },
        { once: true }
      );
      focus();
    }, [focus]);

    // Keybar height changes with layout, compact mode and safe areas
    const keybarRef = useRef<HTMLDivElement>(null);
    const [keybarHeight, setKeybarHeight] = useState(0);
    useEffect(() => {
      const el = keybarRef.current;
      if (!el) return;
      const observer = new ResizeObserver(() =>
        setKeybarHeight(el.offsetHeight)
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, [showKeybar]);

    // Extract terminal text for select mode overlay
    // Select mode: capture full scrollback via tmux capture-pane
    const [terminalText, setTerminalText] = useState("");
    const selectTextRef = useRef<HTMLPreElement>(null);
    const selectScrolledRef = useRef(0);

    // Open the copy view where you were reading, not at the top of history
    useLayoutEffect(() => {
      const pre = selectTextRef.current;
      if (!pre || !terminalText) return;
      const lines = terminalText.split("\n").length;
      const bottomLine = Math.max(0, lines - selectScrolledRef.current);
      pre.scrollTop =
        (bottomLine / lines) * pre.scrollHeight - pre.clientHeight;
    }, [terminalText]);

    useEffect(() => {
      if (!selectMode) {
        setTerminalText("");
        return;
      }

      // Try to get the full tmux scrollback first: -J keeps lines tmux
      // wrapped whole, and the first line says how far up you had scrolled.
      // The pane is this terminal's (the server sets AGENT_OS_TTY).
      const fetchTmuxBuffer = async () => {
        const output = await execViaWs(
          "P=$(tmux list-clients -F '#{client_tty} #{pane_id}' 2>/dev/null | awk -v t=\"$AGENT_OS_TTY\" '$1 == t { print $2 }'); " +
            "tmux display ${P:+-t $P} -p 'scrolled:#{scroll_position}' 2>/dev/null; " +
            "tmux capture-pane ${P:+-t $P} -pJ -S -50000 2>/dev/null"
        );
        const scrolled = output.match(/^scrolled:(\d*)\n/);
        const text = scrolled ? output.slice(scrolled[0].length) : output;
        if (text.trim().length > 0) {
          selectScrolledRef.current = Number(scrolled?.[1]) || 0;
          setTerminalText(
            joinWrappedUrls(
              text.replace(/\n+$/, ""),
              xtermRef.current?.cols ?? 80
            )
          );
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
          paddingBottom: keyboard.height > 0 ? keyboard.height : undefined,
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
          {/* On touch a long press opens select mode instead */}
          <ContextMenuTrigger asChild disabled={isMobile}>
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
              <span>Hold to select and copy · tap a link to open it</span>
              <button
                onClick={() => setSelectMode(false)}
                className="bg-primary-foreground/20 rounded px-2 py-0.5 text-xs"
              >
                Done
              </button>
            </div>
            <pre
              ref={selectTextRef}
              className="flex-1 overflow-auto p-3 font-mono text-xs break-all whitespace-pre-wrap select-text"
              style={{
                userSelect: "text",
                WebkitUserSelect: "text",
              }}
            >
              {linkify(terminalText)}
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

        {/* Image picker button — visible on all screen sizes for agent terminals */}
        {/* Touch devices use the keybar's image button; this one covers terminal output */}
        {showImageButton && !showKeybar && (
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

        {/* Mobile: Keyboard toggle button (not on the deck: it would sit in the
            fold; with the composer it sits in the composer's row instead) */}
        {showKeybar && !deck && !composerOn && (
          <KeybarToggleButton
            isVisible={toolbarVisible}
            keybarAtTop={keybarAtTop}
            keybarHeight={keybarHeight}
            onToggle={toggleToolbar}
          />
        )}

        {/* Nothing in the fold */}
        {showKeybar && deck && (
          <div
            aria-hidden="true"
            className="shrink-0"
            style={{ height: deck.gap, order: laptopKeys ? 2 : undefined }}
          />
        )}

        {/* Mobile: Toolbar with special keys (native keyboard handles text) */}
        {showKeybar && (
          // Laptop typing: `contents`, so the composer and the rows can sit
          // either side of the fold without remounting (the composer keeps focus)
          <div
            ref={keybarRef}
            className={cn(
              "fold-controls bg-background shrink-0",
              laptopKeys ? "contents" : deck && "flex flex-col"
            )}
            style={
              laptopKeys
                ? undefined
                : {
                    height: deck?.deck,
                    order: keybarAtTop ? -1 : undefined,
                    paddingLeft: "env(safe-area-inset-left)",
                    paddingRight:
                      "var(--safe-right, env(safe-area-inset-right))",
                  }
            }
          >
            <div
              className="bg-background shrink-0"
              style={{ order: laptopKeys ? 1 : undefined }}
            >
              {composerOn && (
                <Composer
                  value={composerText}
                  onChange={setComposerText}
                  onSend={sendFromComposer}
                  onTypeInTerminal={typeInTerminal}
                  onPhoto={() => setShowImagePicker(true)}
                  onSelectText={() => setSelectMode(true)}
                  extra={
                    !deck && (
                      <KeybarToggleButton
                        inline
                        isVisible={toolbarVisible}
                        onToggle={toggleToolbar}
                      />
                    )
                  }
                />
              )}
            </div>
            <div
              className={cn(laptopKeys && "keybar-fill bg-background min-h-0")}
              style={laptopKeys ? { order: 3, height: deck.deck } : undefined}
            >
              <TerminalToolbar
                onKeyPress={keybarKeyPress}
                onPaste={sendPaste}
                onImagePicker={() => setShowImagePicker(true)}
                onCopy={copySelection}
                selectMode={selectMode}
                onSelectModeChange={setSelectMode}
                visible={toolbarVisible && (!nativeKeyboard || laptopKeys)}
                keepRows={laptopKeys}
                context={keysContext}
                keyboardUp={keyboardUp}
              />
            </div>
            {deck && !nativeKeyboard && keyboard.height === 0 && (
              <DeckPad onKeyPress={keybarKeyPress} />
            )}
          </div>
        )}

        {keyboardDebug && (
          <KeyboardDebugOverlay
            keyboard={keyboard}
            isMobile={isMobile}
            isTouch={isTouch}
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
