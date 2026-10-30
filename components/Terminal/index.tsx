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
  History,
  Undo2,
  KeyboardOff,
  ChevronDown,
  ArrowUpToLine,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SearchBar } from "./SearchBar";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { TerminalToolbar, type RowAction } from "./TerminalToolbar";
import type { ComposerTools } from "./ComposerPlusMenu";
import {
  type KeysContext,
  keysSettingsStore,
  rowIdFor,
  savedContextRow,
  useToolbarPreferences,
} from "./toolbar-config";
import { KeybarToggleButton } from "./KeybarToggleButton";
import { Composer } from "./Composer";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import {
  type ClaudeBox,
  fromHistory,
  hasQueued,
  isClaudeBusy,
  readClaudeBox,
  readClaudeInput,
  readClaudePrompt,
  screen as screenRows,
  showsQueued,
  squash,
} from "./queued-messages";
import type { ClaudeKey } from "@/components/Composer/ClaudeStateBar";
import { DeckActions, DeckAnswers } from "@/components/DeckActions";
import { NeedsYouCard } from "@/components/Chat/NeedsYouCard";
import { DeckStateLine } from "@/components/DeckStateLine";
import { useSessionPrompt } from "@/data/prompts/queries";
import { useQueue } from "@/hooks/useQueue";
import { useNarrowScreen } from "@/hooks/useNarrowScreen";
import { usePortrait } from "@/hooks/usePortrait";
import {
  adaptiveIds,
  barSpecs,
  type AdaptiveState,
} from "@/lib/adaptive-keys";
import type { Session } from "@/lib/db";
import { useFoldDeck } from "@/hooks/useFoldDeck";
import {
  useSpreadFold,
  useSpreadPages,
} from "@/components/views/SessionSpread";
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
import { addQuote } from "@/stores/replyQuotes";
import { KeyboardDebugOverlay, useKeyboardDebug } from "./KeyboardDebugOverlay";
import { useFileDrop } from "@/hooks/useFileDrop";
import { uploadFilesToTemp } from "@/lib/file-upload";
import { ImagePicker } from "@/components/ImagePicker";
import { ImageViewer } from "@/components/ImageViewer";
import { useFileEvents, useImageEvents } from "@/lib/client/image-view";
import { fileOpenActions } from "@/stores/fileOpen";
import { takeVideos } from "@/stores/videoUploads";
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
  /** A file's path from elsewhere (the share sheet): into the composer as
      its own pill, or typed with a space after */
  attachPath: (path: string) => void;
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
  /** Shown (its tab and the terminal view); a hidden one stops polling */
  active?: boolean;
  /** That session, for the fold deck's state line and answer */
  session?: Session;
  /** Told when the fold deck starts or stops: its state line replaces the strip */
  onDeck?: (on: boolean) => void;
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
      active = true,
      session,
      onDeck,
    },
    ref
  ) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { isMobile, isTouch } = useViewport();
    const { theme: currentTheme, resolvedTheme } = useTheme();
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    // The app's File key: counted so each press opens the sheet
    const [snippetsRequest, setSnippetsRequest] = useState(0);
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
    // A draft another device saved, while the composer still shows it: not
    // this device's copy of Claude's box, nor its edit
    const remoteRef = useRef<string | null>(null);
    const [composerText, setComposerText] = useSessionDraft(
      draftId,
      (text) => (remoteRef.current = text)
    );
    // The composer mirrors Claude's own box: what Claude holds there (↑ ↓
    // recalled history, Esc put back, typed on another device) shows in the
    // composer, and the composer's send replaces it. mirrorRef is the text
    // last copied from Claude's box, null while that box is empty
    const composerTextRef = useRef(composerText);
    composerTextRef.current = composerText;
    const mirrorRef = useRef<string | null>(null);
    const checkMirrorRef = useRef<() => void>(() => {});
    // Emptied in the composer by the user (not a draft from another device):
    // Claude's box empties too
    const emptiedRef = useRef(false);
    // Another session's box is another mirror
    useEffect(() => {
      mirrorRef.current = null;
      emptiedRef.current = false;
    }, [draftId]);
    const onComposerChange = useCallback(
      (value: string) => {
        emptiedRef.current = !value && mirrorRef.current !== null;
        remoteRef.current = null;
        setComposerText(value);
      },
      [setComposerText]
    );

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

    // A picture path tapped in the terminal, full screen; it can go back
    // into the message from there
    const [viewingImage, setViewingImage] = useState<string | null>(null);
    useImageEvents(containerRef, setViewingImage);
    // A file path tapped in the terminal opens in Files, at its line; a
    // relative one is the session folder's
    const cwd = session?.working_directory;
    const openTappedFile = useCallback(
      ({ path, line }: { path: string; line?: number }) => {
        const full =
          path.startsWith("/") || path.startsWith("~") || !cwd
            ? path
            : `${cwd.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;
        fileOpenActions.requestOpen(full, line ?? 0);
      },
      [cwd]
    );
    useFileEvents(containerRef, openTappedFile);

    // Back to where the user's last message starts: tmux holds the
    // history, so the server finds it and scrolls copy mode there
    const sessionId = session?.id;
    const jumpToLastMessage = useCallback(async () => {
      if (!sessionId) return;
      try {
        const res = await fetch(`/api/sessions/${sessionId}/last-message`, {
          method: "POST",
        });
        const data = (await res.json()) as { found?: boolean };
        if (!data.found) toast("No message of yours in this terminal yet");
      } catch {
        toast.error("Couldn't scroll the terminal");
      }
    }, [sessionId]);

    // Handle file drop - upload them all, paths into the composer or terminal
    const handleFileDrop = useCallback(
      async (_file: File, files: File[]) => {
        // Videos become frames, beside the box
        const rest = takeVideos(files, draftId);
        if (!rest.length) return;
        setIsUploading(true);
        try {
          const paths = await uploadFilesToTemp(rest);
          if (paths.length) handleImageSelect(paths.join(" "));
        } finally {
          setIsUploading(false);
        }
      },
      [handleImageSelect, draftId]
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
      attachPath: (path: string) =>
        composerOnRef.current
          ? handleImageSelect(path)
          : sendInput(`${path} `),
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
    const { nativeKeyboard, statuses } = useSnapshot(mobileNavStore);
    // Split/floating keyboards cover the bottom without shrinking the viewport,
    // so move the keybar to the top where it stays reachable
    // Half open like a laptop: output above the fold, input on the deck below
    const deck = useFoldDeck(containerRef, keyboard.height, showKeybar);
    const keybarAtTop = keyboard.mode === "floating" && !deck;
    // Laptop pose while typing: the composer is the screen's last line, above
    // the fold, and the key rows fill the deck between the fold and the keyboard
    const laptopKeys = !!deck && nativeKeyboard;
    // Tabletop with the keyboard down: the base holds Stop / Changes /
    // Terminal, then the key row, then the composer nearest the thumbs
    const tabletopBase = !!deck && !nativeKeyboard && keyboard.height === 0;
    const onDeckFold = !!deck && !!session;
    useEffect(() => {
      if (!onDeck) return;
      onDeck(onDeckFold);
      return () => onDeck(false);
    }, [onDeck, onDeckFold]);
    // Waiting on a question: the base holds its answer, as in Chat
    const deckStatus = draftId ? statuses[draftId]?.status : undefined;
    const { data: deckPrompt } = useSessionPrompt(draftId ?? "", {
      enabled: tabletopBase && !!draftId && deckStatus === "waiting",
    });
    const deckAnswer =
      tabletopBase && !!session && deckStatus === "waiting" && !!deckPrompt;

    // The key row follows what runs here: Claude Code or a shell (a tab
    // with no session, a shell session, the other agents' CLIs)
    const agentType = draftId ? (sessionAgentType ?? "claude") : "shell";
    const keysContext: KeysContext =
      agentType === "claude" ? "claude" : "shell";
    // The adaptive row (narrow screens) follows what Claude is doing: a
    // question on screen gets a number key per option
    const sessionStatus = draftId ? statuses[draftId]?.status : undefined;
    const { data: askPrompt } = useSessionPrompt(draftId ?? "", {
      enabled: keysContext === "claude" && sessionStatus === "waiting",
    });
    const promptOptions =
      sessionStatus === "waiting" ? (askPrompt?.options.length ?? 0) : 0;
    const adaptiveState: AdaptiveState =
      keysContext === "shell"
        ? "shell"
        : sessionStatus === "running"
          ? "working"
          : promptOptions > 0
            ? "asks"
            : "idle";
    const keyboardUp = keyboard.height > 0 || nativeKeyboard;
    // Slide, don't resize: with the keyboard up the terminal keeps its rows
    // (no refit, so tmux doesn't redraw) and slides up so the line in use sits
    // just above the composer. On the deck the keyboard covers the deck instead.
    const keepRows = keyboardUp && !deck;
    useEffect(() => {
      const host = terminalRef.current;
      const term = xtermRef.current;
      const el = term?.element;
      const screen = el?.querySelector<HTMLElement>(".xterm-screen");
      if (!keepRows || !host || !term || !el || !screen) return;
      let offset = 0;
      let frame = 0;
      const slide = () => {
        frame = 0;
        const buffer = term.buffer.active;
        // The lowest line in use: the cursor's, or output below it
        let last = buffer.cursorY;
        for (let y = term.rows - 1; y > last; y--) {
          const line = buffer.getLine(buffer.viewportY + y);
          if (line?.translateToString(true).trim()) {
            last = y;
            break;
          }
        }
        const rowHeight = screen.offsetHeight / term.rows;
        const top = screen.getBoundingClientRect().top + offset;
        const bottom = top + (last + 1) * rowHeight;
        const hostRect = host.getBoundingClientRect();
        // Never past the cursor's line: output drawn below it (a tmux
        // status line) mustn't push the line being typed off the top
        const cursorTop = top + buffer.cursorY * rowHeight;
        const next = Math.max(
          0,
          Math.min(
            Math.ceil(bottom - hostRect.bottom),
            Math.floor(cursorTop - hostRect.top)
          )
        );
        if (next === offset) return;
        offset = next;
        el.style.transform = next ? `translateY(${-next}px)` : "";
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(slide);
      };
      slide();
      const rendered = term.onRender(schedule);
      const observer = new ResizeObserver(schedule);
      observer.observe(host);
      return () => {
        cancelAnimationFrame(frame);
        rendered.dispose();
        observer.disconnect();
        el.style.transform = "";
      };
    }, [keepRows, connectionState, xtermRef]);
    // The app's keyboard bar shows the same row; told whenever this
    // terminal takes focus and when the row changes while it has it
    const nativeKeys =
      keyboardUp && keysContext === "claude" ? "claude-up" : keysContext;
    // ...in the order set in Settings → Keys. Only a row the user changed:
    // the bar's own defaults keep the system Paste control. The bar only
    // shows with the keyboard up, so "claude" (sent while it comes up)
    // already gets the typing row
    const { preferences: keyPrefs } = useToolbarPreferences();
    const nativeRow = rowIdFor(keysContext, true);
    // On a narrow screen the bar shows the adaptive row too, after the
    // tools the page row leads with (Paste, File, Photo)
    const narrow = useNarrowScreen();
    // An app whose bar takes key specs gets the builder's rows, closed and
    // open, with each key's flick and hold
    const nativeIds =
      keyPrefs.adaptive !== false &&
      typeof window !== "undefined" &&
      window.agentosNative?.keySpecs
        ? barSpecs(adaptiveState, promptOptions).join()
        : narrow && keyPrefs.adaptive !== false
        ? ["paste", "snippets", "image"]
            .concat(adaptiveIds(adaptiveState, promptOptions))
            .join()
        : keyPrefs.contextRows?.[nativeRow] || keyPrefs.pinCtrlC === false
          ? savedContextRow(nativeRow, keyPrefs).join()
          : "";
    useEffect(() => {
      const el = containerRef.current;
      if (!el || !isNative()) return;
      const ids = nativeIds ? nativeIds.split(",") : undefined;
      const post = () =>
        postToNative({ type: "keys", context: nativeKeys, ids });
      if (el.contains(document.activeElement)) post();
      el.addEventListener("focusin", post);
      return () => el.removeEventListener("focusin", post);
    }, [nativeKeys, nativeIds]);

    const toggleToolbar = () => {
      const next = !toolbarVisible;
      setToolbarVisible(next);
      localStorage.setItem("terminalToolbarVisible", String(next));
    };

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

    // What the composer sent while Claude was busy: Claude queues it. Not
    // with the server queue on: the composer never types into a busy Claude
    const queuedRef = useRef<string[]>([]);
    // Hidden tabs don't poll: the composer only sends from the active one
    const serverQueue = useQueue(draftId ?? "", {
      enabled: !!draftId && active,
    }).enabled;
    // The composer's own edits to Claude's box run one at a time, and the
    // mirror stays off while one does
    const movingRef = useRef(false);
    const clearingRef = useRef<Promise<boolean> | null>(null);
    // What was just sent, squashed, while it goes through Claude's box
    const sentRef = useRef<{ text: string; at: number } | null>(null);
    // Counts the keys that went to Claude: a later re-Enter is dropped
    const keysRef = useRef(0);
    const [strayInput, setStrayInput] = useState<string | null>(null);

    // Claude's history for this folder (~/.claude/history.jsonl), newest
    // first: the exact text of a recalled prompt, which the screen can't
    // give (a word wrap and a line break look alike; a tall box shows a
    // window of its rows)
    // `tried`: box texts (squashed) looked up since history was last loaded
    const newHistory = () => ({
      entries: [] as string[],
      busy: false,
      again: false,
      tried: new Set<string>(),
    });
    const historyRef = useRef(newHistory());
    useEffect(() => {
      historyRef.current = newHistory();
    }, [cwd]);
    const loadHistory = useCallback(() => {
      const history = historyRef.current;
      // Asked mid-load: the prompt may be newer than that load
      if (history.busy) {
        history.again = true;
        return;
      }
      if (!cwd) return;
      history.busy = true;
      fetch(`/api/claude/history?project=${encodeURIComponent(cwd)}&limit=200`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { entries?: { text: string }[] } | null) => {
          if (data?.entries) history.entries = data.entries.map((e) => e.text);
        })
        .catch(() => {})
        .finally(() => {
          history.busy = false;
          if (history.again) {
            history.again = false;
            loadHistory();
          } else checkMirrorRef.current();
        });
    }, [cwd]);
    /** The text in Claude's box: from history when the screen can't say
        exactly. Undefined while that's being looked up; null when it can't
        be known (a tall box that isn't a prompt from history) */
    const boxText = useCallback(
      (box: ClaudeBox): string | null | undefined => {
        if (box.rows < 2 && !box.tall) return box.text;
        const history = historyRef.current;
        const exact = fromHistory(box, history.entries);
        if (exact !== null) return exact;
        // Not in history as loaded: load it once for this text (a prompt
        // sent since), then go by the screen
        const key = squash(box.text);
        if (!history.tried.has(key)) {
          if (history.tried.size > 50) history.tried.clear();
          history.tried.add(key);
          loadHistory();
          return undefined;
        }
        if (history.busy) return undefined;
        return box.tall ? null : box.text;
      },
      [loadHistory]
    );

    /** Empties Claude's box, wherever its cursor is: ⌦ takes what's after
        it and ⌫ what's before, one character each (a line break or an
        [Image #1] is one), until the box reads empty. `size`: the text's
        length if more than shows (a tall box). One at a time. */
    const clearClaudeInput = useCallback(
      (size = 0) => {
        const run = async () => {
          const term = xtermRef.current;
          if (!term) return false;
          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
          movingRef.current = true;
          try {
            for (let round = 0; round < 4; round++) {
              const box = readClaudeBox(term);
              // No box (a menu took it): nothing to clear safely
              if (!box) return false;
              if (!box.text) return true;
              const keys =
                Math.max(box.text.length * (box.tall ? 4 : 1), size) + 4;
              // A few at a time: a long burst could read as a paste
              for (let sent = 0; sent < keys; sent += 50) {
                sendInput("\x1b[3~\x7f".repeat(Math.min(50, keys - sent)));
                await wait(20);
              }
              for (let tries = 0; tries < 10; tries++) {
                await wait(50);
                if (readClaudeInput(term) === "") return true;
              }
            }
            return readClaudeInput(term) === "";
          } finally {
            movingRef.current = false;
          }
        };
        const next = (clearingRef.current ?? Promise.resolve(true)).then(
          run,
          run
        );
        clearingRef.current = next;
        void next.finally(() => {
          if (clearingRef.current === next) clearingRef.current = null;
        });
        return next;
      },
      [xtermRef, sendInput]
    );

    // Keys typed into the terminal itself count as keys to Claude: a
    // pending re-Enter is off, and the box isn't waited on as a send's.
    // xterm's own replies (focus, cursor position, device attributes) aren't
    // keys
    useEffect(() => {
      const term = xtermRef.current;
      if (!term || connectionState !== "connected") return;
      const sub = term.onData((data) => {
        if (/^\x1b\[(?:[IO]|\d+;\d+R|[?>=][\d;]*c)$/.test(data)) return;
        keysRef.current++;
        sentRef.current = null;
      });
      return () => sub.dispose();
    }, [xtermRef, connectionState]);

    // Claude Code treats input arriving with a newline as a paste, so Enter
    // goes separately after the text has been taken
    const claudeRef = useRef(false);
    claudeRef.current = keysContext === "claude";
    const sendFromComposer = useCallback(
      async (text: string) => {
        const term = xtermRef.current;
        const keys = ++keysRef.current;
        // A clear still running goes first, or it eats what's typed now
        if (clearingRef.current) await clearingRef.current;
        let box = term && text ? readClaudeBox(term) : null;
        // Another client's window size may hide the box, or part of it: a
        // focus report makes this client tmux's latest, so the window takes
        // this terminal's size and Claude redraws the box to fit
        if (term && text && claudeRef.current && (!box || box.tall)) {
          const before = box && `${box.rows}\n${box.text}`;
          sendInput("\x1b[I");
          for (let tries = 0; tries < 3; tries++) {
            await new Promise((r) => setTimeout(r, 100));
            box = readClaudeBox(term);
            if ((box && `${box.rows}\n${box.text}`) !== before) break;
          }
        }
        const mirrored = mirrorRef.current;
        const held = box ? squash(box.text) : "";
        const copy = mirrored !== null && text === mirrored;
        // The composer's copy, unchanged, but Claude's box changed since (more
        // typed there, another entry recalled): replacing it would lose that
        if (
          copy &&
          held &&
          held !== squash(text) &&
          !(box!.tall && squash(text).includes(held))
        ) {
          checkMirrorRef.current();
          throw new Error("Claude's box changed: not sent");
        }
        // Added to what's already waiting, if anything is
        if (text && term && !serverQueue)
          queuedRef.current = !isClaudeBusy(term)
            ? []
            : hasQueued(term)
              ? [...queuedRef.current, text]
              : [text];
        mirrorRef.current = null;
        emptiedRef.current = false;
        historyRef.current.tried.clear();
        setStrayInput(null);
        sentRef.current = { text: squash(text), at: Date.now() };
        // Nothing typed: Enter, as the terminal's own key
        if (!text) {
          sendInput("\r");
          return;
        }
        // Claude's box holds this text already (the composer's unchanged
        // copy, or a draft of its own the same as what's typed there):
        // Claude sends its own. Edited, even by a space, the composer's
        // replaces it.
        if (held && (copy || mirrored === null) && held === squash(text)) {
          sendInput("\r");
          return;
        }
        // A tall box shows a window of the copy
        if (held && copy) {
          sendInput("\r");
          return;
        }
        if (
          held &&
          !(await clearClaudeInput(text.length + (mirrored?.length ?? 0)))
        ) {
          sentRef.current = null;
          throw new Error("Couldn't clear Claude's box: not sent");
        }
        sentRef.current = { text: squash(text), at: Date.now() };
        if (text.includes("\n")) sendPaste(text);
        else sendInput(text);
        setTimeout(() => sendInput("\r"), 80);
        // A long paste (an image's in it) can still be arriving when the
        // Enter does, and Claude takes the Enter in with it: the text then
        // sits in Claude's box, unsent. Still there with Claude idle and
        // no key pressed since, Enter again
        if (!term) return;
        let tries = 0;
        const confirm = () => {
          if (keysRef.current !== keys) return;
          if (isClaudeBusy(term) || !readClaudeInput(term)) return;
          sentRef.current = { text: squash(text), at: Date.now() };
          sendInput("\r");
          if (++tries < 2) setTimeout(confirm, 900);
        };
        setTimeout(confirm, 900);
      },
      [sendInput, sendPaste, xtermRef, serverQueue, clearClaudeInput]
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
    const reclaimQueued = useCallback((drop = false) => {
      const term = xtermRef.current;
      const queued = queuedRef.current;
      if (!term || !queued.length) return;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // Another key since (↑ ↓ on through the box): what the box shows isn't
      // the queue any more, and the mirror follows it instead
      const keys = keysRef.current;
      const moved = () => keysRef.current !== keys;
      void (async () => {
        let back = false;
        for (let tries = 0; tries < 8 && !back; tries++) {
          await wait(150);
          if (moved()) return;
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
        movingRef.current = true;
        try {
          for (let step = 0; step < steps && !cleared; step++) {
            if (moved()) return;
            sendInput(step % 2 ? "\x7f" : "\x15");
            await wait(50);
            cleared = await gone();
          }
        } finally {
          movingRef.current = false;
        }
        if (!cleared) return;
        queuedRef.current = [];
        if (drop) return;
        // A copy the mirror took of the box meanwhile is what was cleared
        const copy = mirrorRef.current;
        mirrorRef.current = null;
        setComposerText((current) =>
          [...queued, current === copy ? "" : current]
            .filter(Boolean)
            .join("\n")
        );
      })();
    }, [xtermRef, sendInput]);

    // Text left in Claude's own box (history recalled there, messages Esc
    // put back, typing from another device) that the composer hides: shown
    // above the composer, to move into it or clear. Not while Claude works,
    // nor while a send goes through the box
    const watchStray =
      composerOn && active && keysContext === "claude" && !!draftId;
    const watchStrayRef = useRef(watchStray);
    watchStrayRef.current = watchStray;
    // Reconnecting, the screen is blank or half replayed: not Claude's box
    const connectedRef = useRef(false);
    connectedRef.current = connectionState === "connected";
    useEffect(() => {
      if (!watchStray) {
        setStrayInput(null);
        return;
      }
      // The box as last read: a change counts once read twice, so half a
      // redraw (or a reconnect's replay) isn't taken for the box
      let last: string | null | undefined;
      let again: ReturnType<typeof setTimeout> | undefined;
      // Claude redrew: read soon after, not at the next poll (typing on
      // another device, a key in the terminal itself)
      let soon: ReturnType<typeof setTimeout> | undefined;
      let watched: { term: unknown; dispose: () => void } | null = null;
      const check = () => {
        const term = xtermRef.current;
        if (!term) return;
        if (watched?.term !== term) {
          watched?.dispose();
          const sub = term.onWriteParsed(() => {
            soon ??= setTimeout(() => {
              soon = undefined;
              check();
            }, 80);
          });
          watched = { term, dispose: () => sub.dispose() };
        }
        const busy = isClaudeBusy(term);
        // Claude took what it held (a mid-turn message) and is done
        if (queuedRef.current.length && !busy && !hasQueued(term))
          queuedRef.current = [];
        if (movingRef.current || !connectedRef.current) return;
        const box = readClaudeBox(term);
        // Just sent: the text is on its way through Claude's box (as typed,
        // or as a [Pasted text] placeholder) until Claude takes it
        const sent = sentRef.current;
        if (sent) {
          const age = Date.now() - sent.at;
          const held = box ? squash(box.text) : "";
          const going =
            age < 300 || (!!held && (age < 1500 || held === sent.text));
          if (going && age < 5000) return;
          sentRef.current = null;
        }
        const read = box && `${box.rows}\n${box.text}`;
        if (read !== last) {
          last = read;
          clearTimeout(again);
          again = setTimeout(check, 120);
          return;
        }
        const current = composerTextRef.current;
        const mirrored = mirrorRef.current;
        /** The copy no longer shows what Claude holds: out of the composer
            (it's in Claude's box, or sent) */
        const dropCopy = () => {
          if (mirrored !== null && current === mirrored) setComposerText("");
          mirrorRef.current = null;
          emptiedRef.current = false;
          setStrayInput(null);
        };
        // Claude holds messages sent meanwhile: the composer doesn't take
        // its box then, but a copy Claude took (Enter pressed in the
        // terminal, or on another device) isn't left to send again. While
        // it only works, ↑ still recalls a prompt into the box: that shows
        const queued =
          queuedRef.current.length > 0 || (busy && hasQueued(term));
        if (queued) {
          if (
            mirrored !== null &&
            current === mirrored &&
            (!box || squash(box.text) !== squash(mirrored))
          )
            dropCopy();
          return;
        }
        // A menu, search or dialog in the box's place
        if (!box) return dropCopy();
        const text = boxText(box);
        if (text === undefined) return;
        // Not all of it shows (another client's bigger window, a box taller
        // than Claude draws) and it's no prompt from history: not mirrored,
        // and a copy of it from before (still being typed) would be cut
        if (text === null) return dropCopy();
        // Typing in the terminal itself: follow it, never type into it
        const typing =
          document.activeElement?.closest(".xterm") &&
          document.activeElement.getAttribute("inputmode") !== "none";
        if (text) {
          // A draft another device saved: the composer's own, unless it's
          // what Claude holds
          const remote =
            !!current && current !== mirrored && current === remoteRef.current;
          const same =
            !remote && mirrored !== null && squash(text) === squash(mirrored);
          if (same) {
            // Emptied in the composer: Claude's empties too
            if (!current && emptiedRef.current && !typing) {
              mirrorRef.current = null;
              emptiedRef.current = false;
              void clearClaudeInput(mirrored.length);
            } else if (current === mirrored && text !== mirrored) {
              // History had the exact text (line breaks) since
              mirrorRef.current = text;
              setComposerText(text);
            }
            setStrayInput(null);
            return;
          }
          // The composer shows it already (back after a reload, from the
          // other device): that's the copy
          if (current && squash(current) === squash(text)) {
            mirrorRef.current = current;
            setStrayInput(null);
            return;
          }
          // Claude's box changed and the composer is empty or still showing
          // the last copy: the composer follows it
          if (!current || (!remote && current === mirrored)) {
            mirrorRef.current = text;
            emptiedRef.current = false;
            setComposerText(text);
            setStrayInput(null);
            return;
          }
          // The composer has a draft of its own: offer Claude's text
          mirrorRef.current = null;
          setStrayInput(text);
          return;
        }
        // Claude's box emptied (sent from the keys, cleared): so does a
        // composer still showing its copy. A prompt sent is in history now
        historyRef.current.tried.clear();
        dropCopy();
      };
      checkMirrorRef.current = check;
      check();
      const timer = setInterval(check, 600);
      return () => {
        clearInterval(timer);
        clearTimeout(again);
        clearTimeout(soon);
        watched?.dispose();
        checkMirrorRef.current = () => {};
      };
    }, [watchStray, xtermRef, setComposerText, boxText, clearClaudeInput]);

    const moveStray = useCallback(() => {
      const term = xtermRef.current;
      const box = term ? readClaudeBox(term) : null;
      const text = box?.text ? (boxText(box) ?? box.text) : null;
      if (!text) return;
      setStrayInput(null);
      void clearClaudeInput(text.length).then((cleared) => {
        if (!cleared) return;
        setComposerText((current) =>
          [text, current].filter(Boolean).join("\n")
        );
      });
    }, [xtermRef, boxText, clearClaudeInput, setComposerText]);
    const clearStray = useCallback(() => {
      setStrayInput(null);
      void clearClaudeInput();
    }, [clearClaudeInput]);

    /** A key went to Claude: what it does to the box shows soon, not at the
        next poll, and a pending re-Enter is off */
    const afterKey = useCallback(() => {
      keysRef.current++;
      sentRef.current = null;
      [100, 250, 500].forEach((ms) =>
        setTimeout(() => checkMirrorRef.current(), ms)
      );
    }, []);

    // The keybar's newline key adds a line to the composer while it has focus
    const keybarKeyPress = useCallback(
      (key: string) => {
        if (isTextKey(key) && insertInComposer(key)) return;
        const term = xtermRef.current;
        // ↑ ↓ step through Claude's history in its box, which the composer
        // mirrors; with a draft of the composer's own they move its caret
        const arrow = key === "\x1b[A" || key === "\x1b[B";
        const draft = composerTextRef.current;
        if (
          arrow &&
          composerOnRef.current &&
          term &&
          !isClaudeBusy(term) &&
          !!draft &&
          draft !== mirrorRef.current
        ) {
          const box = keybarRef.current?.querySelector<HTMLTextAreaElement>(
            "textarea[data-composer]"
          );
          const keyEvent = new KeyboardEvent("keydown", {
            key: key === "\x1b[A" ? "ArrowUp" : "ArrowDown",
            bubbles: true,
            cancelable: true,
          });
          box?.dispatchEvent(keyEvent);
          if (keyEvent.defaultPrevented) return;
        }
        const queued =
          (key === "\x1b[A" || key === "\x1b") &&
          composerOnRef.current &&
          queuedRef.current.length > 0 &&
          !!term &&
          hasQueued(term);
        sendInput(key);
        afterKey();
        if (queued) reclaimQueued();
      },
      [sendInput, insertInComposer, reclaimQueued, xtermRef, afterKey]
    );
    /** ↑ ↓ in the composer (a hardware keyboard): Claude's history, as the
        keybar's, unless the composer holds a draft of its own */
    const composerArrow = useCallback(
      (up: boolean) => {
        // Only Claude's box is mirrored: in a shell ↑ would put a command on
        // its line that the composer doesn't show
        if (!watchStrayRef.current) return false;
        const draft = composerTextRef.current;
        if (draft && draft !== mirrorRef.current) return false;
        const key = up ? "\x1b[A" : "\x1b[B";
        // The composer's caret is on the copy's first (last) line, but
        // Claude's cursor may be rows below (above) it, and its ↑ (↓) moves
        // that a row first: as many more as take it to the edge
        const term = xtermRef.current;
        const box = draft && term ? readClaudeBox(term) : null;
        const moves =
          box && !box.tall && box.cursor !== undefined
            ? up
              ? box.cursor
              : box.rows - 1 - box.cursor
            : 0;
        if (!moves) {
          keybarKeyPress(key);
          return true;
        }
        for (let i = 0; i < moves; i++)
          setTimeout(() => sendInput(key), i * 40);
        setTimeout(() => keybarKeyPress(key), moves * 40);
        return true;
      },
      [keybarKeyPress, xtermRef, sendInput]
    );

    // Claude's state under the composer, read from the rows it draws, and
    // the keys that change it
    const readScreen = useCallback(() => {
      const term = xtermRef.current;
      return term ? screenRows(term) : null;
    }, [xtermRef]);
    const sendClaudeKey = useCallback(
      (key: ClaudeKey, times = 1) => {
        if (key === "esc") return keybarKeyPress("\x1b");
        if (key === "shift-tab") {
          sendInput("\x1b[Z");
          return afterKey();
        }
        // Apart: two Escs in one chunk read as Alt+Esc
        const keys =
          key === "esc-esc"
            ? ["\x1b", "\x1b"]
            : Array<string>(times).fill("\x1b[A");
        keys.forEach((k, i) =>
          setTimeout(() => {
            sendInput(k);
            afterKey();
          }, i * 80)
        );
      },
      [keybarKeyPress, sendInput, afterKey]
    );
    const getQueued = useCallback(() => queuedRef.current, []);
    const editQueued = useCallback(
      () => keybarKeyPress("\x1b[A"),
      [keybarKeyPress]
    );
    const cancelQueued = useCallback(() => {
      sendInput("\x1b[A");
      reclaimQueued(true);
    }, [sendInput, reclaimQueued]);

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
          else if (
            event.type === "image" ||
            event.type === "select" ||
            event.type === "snippets"
          ) {
            // Sheets and selecting the keyboard would cover
            (document.activeElement as HTMLElement | null)?.blur();
            if (event.type === "image") setShowImagePicker(true);
            else if (event.type === "select") setSelectMode(true);
            else setSnippetsRequest((n) => n + 1);
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

    // This pane across both pages of the open Duo: the composer on one page
    // and the keys on the other (Split, Mirrored), or each row split either
    // side of the gutter (Two rows), as set in Settings → Keys. Two rows
    // splits the context row only; a custom row takes the split instead.
    const spreadFold = useSpreadFold();
    const duoPages = useSpreadPages(
      keybarRef,
      showKeybar && !deck ? spreadFold : null
    );
    const savedLayout = !duoPages
      ? null
      : keyPrefs.duoLayout === "two-rows" && keyPrefs.mode !== "context"
        ? "split"
        : (keyPrefs.duoLayout ?? "split");
    // Settings → Keys takes the right page: the keys move left meanwhile,
    // so the row shows each change beside the list
    const { open: keysOpen } = useSnapshot(keysSettingsStore);
    const duoLayout =
      keysOpen && savedLayout === "split" ? "mirrored" : savedLayout;
    const sideBySide = duoLayout === "split" || duoLayout === "mirrored";
    const leftSlot = duoPages
      ? { width: duoPages.left, flexShrink: 0 }
      : undefined;
    const rightSlot = { flex: "1 1 0", minWidth: 0 };
    const twoRowPages = duoLayout === "two-rows" ? duoPages : null;

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

    // Select mode's "Reply to this": the copy view's selection, quoted over
    // the composer. Taken on press too, as the tap can clear the selection.
    const [selectedText, setSelectedText] = useState("");
    const pickedRef = useRef("");
    useEffect(() => {
      if (!selectMode) return setSelectedText("");
      const onChange = () => {
        const sel = window.getSelection();
        const inView =
          !!sel &&
          !sel.isCollapsed &&
          !!selectTextRef.current?.contains(sel.anchorNode);
        setSelectedText(inView ? sel.toString().trim() : "");
      };
      document.addEventListener("selectionchange", onChange);
      return () => document.removeEventListener("selectionchange", onChange);
    }, [selectMode]);
    const replyToSelection = useCallback(() => {
      const text = pickedRef.current || selectedText;
      pickedRef.current = "";
      if (!draftId || !text) return;
      addQuote(draftId, text);
      window.getSelection()?.removeAllRanges();
      // Within the tap, so iOS raises the keyboard
      keybarRef.current
        ?.querySelector<HTMLTextAreaElement>("textarea[data-composer]")
        ?.focus();
      setSelectMode(false);
    }, [draftId, selectedText]);

    // A narrow screen in portrait (the closed Duo, phones): one key row
    // above the composer, leading with the tools. The composer's + folds
    // into the row's ⋯. With the keyboard up the row rides on it, or in the
    // app the app's keyboard bar takes its place, in the band on the keyboard.
    const rowAbove =
      composerOn &&
      narrow &&
      keyPrefs.adaptive !== false &&
      toolbarVisible &&
      !deck &&
      !sideBySide;

    // Upright, the rows sit above the composer too, away from the bottom
    // edge (the open Duo turned upright: its rows hide with the keyboard up,
    // for the app's bar)
    const portrait = usePortrait();
    const keysAbove =
      rowAbove ||
      (composerOn && portrait && !deck && !sideBySide && !keyboardUp);

    // On the deck the page's key rows replace the app's keyboard bar
    const nativeBarHidden = !!deck && isNative();
    useEffect(() => {
      if (!nativeBarHidden) return;
      postToNative({ type: "keybar", hidden: true });
      return () => postToNative({ type: "keybar", hidden: false });
    }, [nativeBarHidden]);

    // The clipboard key copies while text is selected: in the copy view,
    // or dragged in the terminal. Kept from the last change, as the tap on
    // the key can clear the selection before its click.
    const [termSelected, setTermSelected] = useState(false);
    useEffect(() => {
      const term = xtermRef.current;
      if (!term) return;
      const changed = term.onSelectionChange(() =>
        setTermSelected(term.hasSelection())
      );
      return () => changed.dispose();
    }, [xtermRef, connectionState]);
    const copyTextRef = useRef("");
    if (selectedText) copyTextRef.current = selectedText;
    if (!selectMode) copyTextRef.current = "";
    const copyForRow = useCallback(() => {
      const text = copyTextRef.current;
      if (!text) return copySelection();
      copyTextRef.current = "";
      void writeClipboard(text);
      window.getSelection()?.removeAllRanges();
      return true;
    }, [copySelection, writeClipboard]);
    const composerToolsRef = useRef<ComposerTools | null>(null);
    const rowTools = useMemo(
      () =>
        rowAbove
          ? {
              onPhoto: () => setShowImagePicker(true),
              onFile: () => composerToolsRef.current?.file(),
              canCopy: !!selectedText || termSelected,
              onSelectText: () => setSelectMode(true),
            }
          : null,
      [rowAbove, selectedText, termSelected]
    );
    // What the composer's + had, in the row's ⋯
    const rowActions = useMemo<RowAction[]>(
      () => [
        {
          icon: MousePointer2,
          label: "Select text",
          onSelect: () => setSelectMode(true),
        },
        ...(keysContext === "claude"
          ? [
              {
                icon: History,
                label: "Earlier prompts",
                onSelect: () => composerToolsRef.current?.history?.(),
              },
              {
                icon: Undo2,
                label: "Rewind",
                onSelect: () => composerToolsRef.current?.rewind?.(),
              },
              {
                icon: ArrowUpToLine,
                label: "Your last message",
                onSelect: () => void jumpToLastMessage(),
              },
            ]
          : []),
        {
          icon: TerminalSquare,
          label: "Type in terminal",
          onSelect: typeInTerminal,
        },
        { icon: KeyboardOff, label: "Hide keys", onSelect: toggleToolbar },
      ],
      [keysContext, typeInTerminal, toggleToolbar, jumpToLastMessage]
    );

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

        {/* On the fold deck the live state sits above the output */}
        {deck && session && (
          <DeckStateLine session={session} active={active} />
        )}

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
              // Read by the resize handlers: no refit while sliding
              data-keep-rows={keepRows || undefined}
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
            // The key row above the composer stays: its Paste turns into Copy
            style={rowAbove ? { bottom: keybarHeight } : undefined}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <div className="bg-primary text-primary-foreground flex items-center justify-between px-3 py-2 text-xs font-medium">
              <span>Hold to select and copy · tap a link to open it</span>
              {composerOn && draftId && (
                <button
                  onPointerDown={() => (pickedRef.current = selectedText)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={replyToSelection}
                  aria-disabled={!selectedText}
                  className={cn(
                    // A 44px touch, kept clear of Done
                    "bg-primary-foreground/20 relative ml-auto mr-4 rounded px-2.5 py-1.5 text-xs after:absolute after:-inset-x-1 after:-inset-y-2",
                    !selectedText && "opacity-50"
                  )}
                >
                  Reply to this
                </button>
              )}
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
            onVideos={
              draftId ? (files) => takeVideos(files, draftId) : undefined
            }
            onClose={() => setShowImagePicker(false)}
          />
        )}
        {viewingImage && (
          <ImageViewer
            path={viewingImage}
            onAdd={() => {
              setViewingImage(null);
              handleImageSelect(viewingImage);
            }}
            onClose={() => setViewingImage(null)}
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
              "bg-background shrink-0",
              // Laid out on both pages here, or kept right of the fold
              !duoLayout && "fold-controls",
              sideBySide && "flex items-end",
              keysAbove && "flex flex-col",
              laptopKeys ? "contents" : deck && "flex flex-col"
            )}
            style={
              laptopKeys
                ? undefined
                : {
                    height: deck?.deck,
                    order: keybarAtTop ? -1 : undefined,
                    // The pages are measured from this edge
                    paddingLeft: duoLayout ? 0 : "env(safe-area-inset-left)",
                    paddingRight:
                      "var(--safe-right, env(safe-area-inset-right))",
                  }
            }
          >
            {/* Fold-Terminal: the answers (else Stop, Changes, Chat), the
                key grid under them, the room left above the composer */}
            {deckAnswer && draftId && session ? (
              <DeckAnswers
                sessionId={draftId}
                className="px-5 pt-2"
                permission={
                  <div className="min-h-0 shrink overflow-y-auto px-5 pt-2">
                    <NeedsYouCard
                      session={session}
                      variant="inline"
                      onOpenTerminal={scrollToBottom}
                    />
                  </div>
                }
                fallback={
                  <DeckActions
                    sessionId={draftId}
                    status={deckStatus}
                    view="terminal"
                    className="px-5 pt-2"
                  />
                }
              />
            ) : (
              tabletopBase &&
              draftId && (
                <DeckActions
                  sessionId={draftId}
                  status={deckStatus}
                  view="terminal"
                  className="px-5 pt-2"
                />
              )
            )}
            {tabletopBase && (
              <div className="min-h-0 flex-1" style={{ order: 3 }} />
            )}
            {/* Ordered rather than moved, so the composer never remounts */}
            <div
              className="bg-background shrink-0"
              style={
                sideBySide
                  ? duoLayout === "split"
                    ? { order: 1, ...leftSlot }
                    : { order: 3, ...rightSlot }
                  : {
                      // Above the composer: the key row goes first
                      order:
                        laptopKeys || keysAbove
                          ? 1
                          : tabletopBase
                            ? 3
                            : undefined,
                    }
              }
            >
              {composerOn && (
                <Composer
                  value={composerText}
                  onChange={onComposerChange}
                  sessionId={draftId}
                  onSend={sendFromComposer}
                  onArrow={composerArrow}
                  onTypeInTerminal={typeInTerminal}
                  onLastMessage={jumpToLastMessage}
                  onPhoto={() => setShowImagePicker(true)}
                  onSelectText={() => setSelectMode(true)}
                  readScreen={readScreen}
                  active={active}
                  onClaudeKey={sendClaudeKey}
                  getQueued={getQueued}
                  onEditQueued={editQueued}
                  onCancelQueued={cancelQueued}
                  stray={strayInput}
                  onMoveStray={moveStray}
                  onClearStray={clearStray}
                  pages={twoRowPages}
                  growUp={sideBySide}
                  noPlus={rowAbove}
                  toolsRef={composerToolsRef}
                  extra={
                    rowAbove ? (
                      // No app bar (a browser): the keyboard's way down is
                      // beside Send while it's up
                      keyboardUp &&
                      !isNative() && (
                        <button
                          type="button"
                          aria-label="Hide keyboard"
                          title="Hide keyboard"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() =>
                            (document.activeElement as HTMLElement | null)?.blur()
                          }
                          className="bg-secondary text-muted-foreground active:bg-muted flex h-[44px] w-[44px] flex-shrink-0 touch-manipulation items-center justify-center rounded-full"
                        >
                          <ChevronDown className="h-5 w-5" />
                        </button>
                      )
                    ) : (
                      !deck && (
                        <KeybarToggleButton
                          inline
                          isVisible={toolbarVisible}
                          onToggle={toggleToolbar}
                        />
                      )
                    )
                  }
                />
              )}
            </div>
            {/* Nothing in the fold */}
            {sideBySide && duoPages && (
              <div
                aria-hidden="true"
                className="shrink-0"
                style={{ order: 2, width: duoPages.gutter }}
              />
            )}
            <div
              className={cn(laptopKeys && "keybar-fill bg-background min-h-0")}
              style={
                laptopKeys
                  ? { order: 3, height: deck.deck }
                  : // Under the composer: on the deck, and the row from
                    // above the composer onto the keyboard while it's up
                    tabletopBase || (rowAbove && keyboardUp)
                    ? { order: 2 }
                    : sideBySide
                      ? {
                          ...(duoLayout === "split"
                            ? { order: 3, ...rightSlot }
                            : { order: 1, ...leftSlot }),
                          // Level with the middle of the box beside it
                          paddingBottom: 9,
                        }
                      : undefined
              }
            >
              <TerminalToolbar
                onKeyPress={keybarKeyPress}
                onPaste={sendPaste}
                onImagePicker={() => setShowImagePicker(true)}
                onCopy={rowAbove ? copyForRow : copySelection}
                selectMode={selectMode}
                onSelectModeChange={setSelectMode}
                snippetsRequest={snippetsRequest}
                adaptiveState={adaptiveState}
                promptOptions={promptOptions}
                tools={rowTools}
                actions={rowAbove ? rowActions : undefined}
                // The deck has no keybar toggle, so its row always shows
                visible={
                  (toolbarVisible || tabletopBase) &&
                  (!nativeKeyboard || laptopKeys)
                }
                keepRows={laptopKeys}
                context={keysContext}
                keyboardUp={keyboardUp}
                singleRow={tabletopBase}
                pages={twoRowPages}
                overflow={sideBySide}
              />
            </div>
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
