"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import {
  filterCommands,
  useClaudeCommands,
  useClaudeHistory,
  useFileSuggestions,
  type ClaudeCommand,
  type FileSuggestion,
} from "@/hooks/useComposerData";
import { useQueries } from "@tanstack/react-query";
import { uploadFilesToTemp, uploadedSize } from "@/lib/file-upload";
import { takeVideos } from "@/stores/videoUploads";
import { clearQuotes, formatWithQuotes, useQuotes } from "@/stores/replyQuotes";
import {
  MAGIC_WORDS,
  magicWordPattern,
  type MagicWord,
} from "@/lib/magic-words";
import {
  PASTE_LINES,
  collapse,
  expand,
  imagePaths,
  keepChipsWhole,
  lineCount,
  pasteToken,
  tokenAtCaret,
  type Chip,
  type Paste,
} from "./text";

export interface Suggestion {
  key: string;
  label: string;
  detail: string;
  hint?: string;
  /** Heading of the group this one starts, if it starts one */
  group?: string;
  insert: string;
  /** A folder: stay open to pick inside it */
  keepOpen?: boolean;
}

export type ComposerMode = "bash" | "memory" | null;

export interface Segment {
  text: string;
  kind: "plain" | "magic" | "chip";
  /** The pill it draws, for a chip */
  chip?: Chip;
}

interface UseComposerOptions {
  /** The synced draft: the full text that will be sent */
  value: string;
  onChange: (text: string) => void;
  /** Keeps paste pills across reloads on this device */
  sessionId?: string | null;
  /** The session's folder: project commands, @ files and history */
  cwd?: string | null;
  /** Claude Code runs in the session: pickers, modes and history */
  claude?: boolean;
}

const pastesKey = (id: string) => `agentos:pastes:${id}`;

function readPastes(id: string | null | undefined): Paste[] {
  if (!id) return [];
  try {
    const raw = localStorage.getItem(pastesKey(id));
    return raw ? (JSON.parse(raw) as Paste[]) : [];
  } catch {
    return [];
  }
}

function writePastes(id: string | null | undefined, pastes: Paste[]) {
  if (!id) return;
  try {
    if (pastes.length)
      localStorage.setItem(pastesKey(id), JSON.stringify(pastes));
    else localStorage.removeItem(pastesKey(id));
  } catch {
    // Private mode or full: the pills just show as text after a reload
  }
}

const SOURCE: Record<ClaudeCommand["source"], string> = {
  builtin: "built-in",
  skill: "skill",
  plugin: "plugin",
  user: "~/.claude",
  project: ".claude",
};

type CommandGroup = keyof ReturnType<typeof useClaudeCommands>["groups"];

// Typed nothing yet: the project's own on top, then the mock's built-in,
// skills and plugins, your commands
const GROUPS: [CommandGroup[], string][] = [
  [["project"], "Project"],
  [["builtin"], "Built-in"],
  [["skills", "plugins"], "Skills and plugins"],
  [["user"], "Your commands"],
];

const FILE_GROUPS: Record<FileSuggestion["kind"], string> = {
  changed: "Changed",
  recent: "Recent",
  match: "Files",
};

function fileStatus(code = ""): string {
  const c = code.trim();
  if (c === "??") return "untracked";
  if (c.includes("A")) return "added";
  if (c.includes("D")) return "deleted";
  if (c.includes("R")) return "renamed";
  return "modified";
}

const MAX_SUGGESTIONS = 60;

/**
 * Within each group, closer matches first: a path part starting with the
 * query, then the query anywhere, then the server's fuzzy matches
 */
function rankFiles(files: FileSuggestion[], query: string): FileSuggestion[] {
  const q = query.toLowerCase();
  if (!q) return files;
  const score = (path: string) => {
    const p = path.toLowerCase();
    if (p.split("/").some((part) => part.startsWith(q))) return 0;
    return p.includes(q) ? 1 : 2;
  };
  const order: FileSuggestion["kind"][] = ["changed", "recent", "match"];
  return files
    .map((f, i) => ({ f, i, s: score(f.path), k: order.indexOf(f.kind) }))
    .sort((a, b) => a.k - b.k || a.s - b.s || a.i - b.i)
    .map((x) => x.f);
}

/** The pill the caret landed inside, if any */
const chipAt = (chips: Chip[], at: number) =>
  chips.find((c) => c.start < at && at < c.end) ?? null;

/**
 * The engine behind both composers (the terminal's and the chat's): pills for
 * pastes and images, the "/" and "@" pickers, "!" and "#" modes, magic words
 * and ↑/↓ history. The textarea stays native for iOS editing; everything here
 * is display or insertion, and the text sent is the draft as typed.
 */
export function useComposer({
  value,
  onChange,
  sessionId,
  cwd,
  claude = true,
}: UseComposerOptions) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Long pastes, so they can show as pills; the draft holds their text
  const [pastes, setPastesState] = useState<Paste[]>([]);
  const pastesRef = useRef(pastes);
  const setPastes = useCallback(
    (next: Paste[]) => {
      pastesRef.current = next;
      setPastesState(next);
      writePastes(sessionId, next);
    },
    [sessionId]
  );
  useEffect(() => {
    const saved = readPastes(sessionId);
    pastesRef.current = saved;
    setPastesState(saved);
  }, [sessionId]);

  // Image pills show the file's size: known at once for this device's
  // uploads, looked up once otherwise
  const images = useMemo(() => imagePaths(value), [value]);
  const metas = useQueries({
    queries: images.map((path) => ({
      queryKey: ["image-meta", path],
      queryFn: async (): Promise<{ size: number } | null> => {
        const res = await fetch(
          `/api/files/image?meta=1&path=${encodeURIComponent(path)}`
        );
        return res.ok ? res.json() : null;
      },
      enabled: uploadedSize(path) === undefined,
      staleTime: Infinity,
      retry: false,
    })),
  });
  const sizes = images.map(
    (path, i) => uploadedSize(path) ?? metas[i]?.data?.size
  );
  const sizesKey = sizes.join(",");
  const { display, chips } = useMemo(
    () => collapse(value, pastes, (path) => sizes[images.indexOf(path)]),
    // sizes is new each render; its key says when it changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, pastes, images, sizesKey]
  );
  const displayRef = useRef(display);
  displayRef.current = display;
  const chipsRef = useRef(chips);
  chipsRef.current = chips;

  // The terminal's keybar and the app's keyboard bar insert into the box's
  // shown text and save that: put the pills' text back in the draft
  const shownChips = useRef<Chip[]>([]);
  useEffect(() => {
    const healed = expand(value, shownChips.current);
    if (healed !== value) {
      onChange(healed);
      return;
    }
    shownChips.current = chips;
    // Pills whose text is gone; an empty box may just not have loaded yet
    if (!value) return;
    const kept = pastesRef.current.filter((p) => value.includes(p.text));
    if (kept.length !== pastesRef.current.length) setPastes(kept);
  }, [value, chips, onChange, setPastes]);

  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);

  // Where the caret goes once the new text renders: dictation can deliver
  // twice before that, and the second part belongs after the first
  const pendingCaret = useRef<number | null>(null);
  const placeCaret = useCallback((at: number) => {
    setCaret(at);
    pendingCaret.current = at;
    requestAnimationFrame(() => {
      pendingCaret.current = null;
      const el = textareaRef.current;
      if (el && document.activeElement === el) el.setSelectionRange(at, at);
    });
  }, []);

  // A pill that grows (an image's size arriving) moves the text after it:
  // the caret keeps its place in the text instead of jumping to the end
  const caretRef = useRef(caret);
  caretRef.current = caret;
  const shown = useRef({ display, chips });
  useLayoutEffect(() => {
    const prev = shown.current;
    shown.current = { display, chips };
    if (prev.display === display || prev.chips.length !== chips.length) return;
    const el = textareaRef.current;
    if (!el || document.activeElement !== el) return;
    if (prev.chips.some((c, i) => c.text !== chips[i].text)) return;
    let at = caretRef.current;
    let shift = 0;
    for (const [i, c] of prev.chips.entries()) {
      if (c.end > at) break;
      shift += chips[i].token.length - c.token.length;
    }
    // Only pills changed, nothing typed
    const plain = (d: string, cs: Chip[]) =>
      cs.reduceRight((t, c) => t.slice(0, c.start) + t.slice(c.end), d);
    if (plain(prev.display, prev.chips) !== plain(display, chips)) return;
    at += shift;
    el.setSelectionRange(at, at);
    setCaret(at);
  }, [display, chips]);

  /** Replace the shown text; the draft gets it with the pills expanded */
  const setDisplay = useCallback(
    (next: string, at?: number, withChips = chipsRef.current) => {
      displayRef.current = next;
      onChange(expand(next, withChips));
      if (at !== undefined) placeCaret(at);
    },
    [onChange, placeCaret]
  );

  // ---- "/" and "@" pickers
  const [dismissed, setDismissed] = useState<string | null>(null);
  const token = claude && focused ? tokenAtCaret(display, caret) : null;
  const pickerToken = token && dismissed !== display ? token : null;
  const { groups } = useClaudeCommands(cwd, claude && focused);
  const { files } = useFileSuggestions(
    cwd,
    pickerToken?.kind === "at" ? pickerToken.query : "",
    pickerToken?.kind === "at"
  );

  // The picker's list, for the box's combobox semantics
  const listboxId = useId();

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!pickerToken) return [];
    if (pickerToken.kind === "slash") {
      const toItem = (c: ClaudeCommand, group?: string): Suggestion => ({
        key: `${c.source}:${c.name}`,
        label: `/${c.name}`,
        detail: c.description,
        hint: SOURCE[c.source],
        group,
        insert: `/${c.name} `,
      });
      // Typed nothing yet: grouped by where they come from
      if (!pickerToken.query)
        return GROUPS.flatMap(([keys, title]) =>
          keys
            .flatMap((g) => groups[g])
            .map((c, i) => toItem(c, i === 0 ? title : undefined))
        ).slice(0, MAX_SUGGESTIONS * 2);
      // A name that starts with what's typed beats a plugin's or skill's
      // second half ("co" → compact before commit-commands:commit), the
      // command part matching too beats a plugin whose name alone does
      // (commit before commit-commands:clean_gone); otherwise the groups'
      // order, so "/co" leads with code-review and commit as in the mock
      const q = pickerToken.query.toLowerCase();
      const head = (c: ClaudeCommand) =>
        c.name.toLowerCase().startsWith(q) ? 0 : 1;
      const command = (c: ClaudeCommand) =>
        c.name.toLowerCase().slice(c.name.lastIndexOf(":") + 1);
      const own = (c: ClaudeCommand) => (command(c).startsWith(q) ? 0 : 1);
      return filterCommands(groups, pickerToken.query)
        .map((c, i) => ({ c, i }))
        .sort(
          (a, b) => head(a.c) - head(b.c) || own(a.c) - own(b.c) || a.i - b.i
        )
        .map(({ c }) => c)
        .slice(0, MAX_SUGGESTIONS)
        .map((c) => toItem(c));
    }
    const ranked = rankFiles(files, pickerToken.query);
    return ranked.slice(0, MAX_SUGGESTIONS).map((f, i) => {
      const dir = f.path.endsWith("/");
      return {
        key: `${f.kind}:${f.path}`,
        label: f.path,
        detail:
          f.kind === "changed"
            ? fileStatus(f.status)
            : f.kind === "recent"
              ? "recent"
              : "",
        group:
          i === 0 || ranked[i - 1].kind !== f.kind
            ? FILE_GROUPS[f.kind]
            : undefined,
        insert: `@${f.path}${dir ? "" : " "}`,
        keepOpen: dir,
      };
    });
  }, [pickerToken?.kind, pickerToken?.query, groups, files]);

  const [selected, setSelected] = useState(0);
  const pickerKey = pickerToken
    ? `${pickerToken.kind}:${pickerToken.query}`
    : "";
  useEffect(() => setSelected(0), [pickerKey]);

  const choose = useCallback(
    (s: Suggestion) => {
      const t = tokenAtCaret(displayRef.current, caret);
      if (!t) return;
      const text = displayRef.current;
      const after = text.slice(t.end);
      const insert =
        s.insert.endsWith(" ") && /^\s/.test(after)
          ? s.insert.slice(0, -1)
          : s.insert;
      const next = text.slice(0, t.start) + insert + after;
      const at = t.start + insert.length + (insert === s.insert ? 0 : 1);
      setDisplay(next, at);
      if (!s.keepOpen) setDismissed(next);
      textareaRef.current?.focus();
    },
    [caret, setDisplay]
  );

  // ---- History: ↑ in an empty box, ↓ back; a search sheet (Ctrl-R)
  // Cached per project; also wanted unfocused, for the key row's ↑
  const { entries } = useClaudeHistory(claude ? cwd : null);
  const [hist, setHist] = useState(-1);
  const recalled = hist >= 0 && entries[hist]?.text === value ? hist : -1;
  const [historyOpen, setHistoryOpen] = useState(false);

  const recall = useCallback(
    (text: string, index = -1) => {
      setHist(index);
      onChange(text);
      // At the end, where Claude Code leaves it
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        setCaret(el.value.length);
      });
    },
    [onChange]
  );

  // ---- Pills: preview, expand, remove
  const [preview, setPreview] = useState<{
    kind: Chip["kind"];
    n: number;
  } | null>(null);
  const previewChip =
    (preview &&
      chips.find((c) => c.kind === preview.kind && c.n === preview.n)) ||
    null;

  const removeChip = useCallback(
    (chip: Chip) => {
      const text = displayRef.current;
      // The space it was set apart with goes too
      const end = text[chip.end] === " " ? chip.end + 1 : chip.end;
      setDisplay(text.slice(0, chip.start) + text.slice(end), chip.start);
      if (chip.kind === "paste")
        setPastes(pastesRef.current.filter((p) => p.n !== chip.n));
      setPreview(null);
    },
    [setDisplay, setPastes]
  );

  const unfoldChip = useCallback(
    (chip: Chip) => {
      setPastes(pastesRef.current.filter((p) => p.n !== chip.n));
      setPreview(null);
    },
    [setPastes]
  );

  /**
   * Put text at the caret (or after what's typed, if the box isn't focused).
   * Spaced: words (a snippet, a path, dictation) stand a space apart from
   * what's before them; keys go in as they are.
   */
  const insert = useCallback(
    (text: string, spaced = false) => {
      if (!text) return;
      const el = textareaRef.current;
      const current = displayRef.current;
      const focusedNow = !!el && document.activeElement === el;
      const from = focusedNow
        ? (pendingCaret.current ?? el.selectionStart)
        : current.length;
      const to = focusedNow
        ? (pendingCaret.current ?? el.selectionEnd)
        : current.length;
      const sep =
        (spaced || !focusedNow) &&
        from > 0 &&
        !/\s/.test(current[from - 1]) &&
        !/^\s/.test(text)
          ? " "
          : "";
      const added = sep + text;
      setDisplay(
        current.slice(0, from) + added + current.slice(to),
        from + added.length
      );
    },
    [setDisplay]
  );

  /** A long paste becomes a pill; its text is what's saved and sent */
  const pasteText = useCallback(
    (raw: string) => {
      const text = raw.replace(/\r\n?/g, "\n");
      if (lineCount(text) <= PASTE_LINES) {
        insert(text);
        return;
      }
      const n = Math.max(0, ...pastesRef.current.map((p) => p.n)) + 1;
      const token = pasteToken(n, text);
      const el = textareaRef.current;
      const current = displayRef.current;
      const focusedNow = el && document.activeElement === el;
      const from = focusedNow ? el.selectionStart : current.length;
      const to = focusedNow ? el.selectionEnd : current.length;
      const before =
        current.slice(0, from) +
        (from > 0 && !/\s$/.test(current.slice(0, from)) ? " " : "");
      const next = before + token + current.slice(to);
      const chip: Chip = {
        kind: "paste",
        n,
        text,
        token,
        start: before.length,
        end: before.length + token.length,
      };
      setPastes([...pastesRef.current, { n, text }]);
      setDisplay(next, chip.end, [...chipsRef.current, chip]);
    },
    [insert, setDisplay, setPastes]
  );

  // Images on their way up, for one progress state however many there are
  const [uploading, setUploading] = useState(0);
  /** Upload pictures together; each lands as its own pill */
  const attach = useCallback(
    async (files: File[]) => {
      // Videos become frames, beside the box
      const pictures = takeVideos(files, sessionId).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!pictures.length) return;
      setUploading((n) => n + pictures.length);
      try {
        const paths = await uploadFilesToTemp(pictures);
        if (paths.length) insert(`${paths.join(" ")} `, true);
      } finally {
        setUploading((n) => n - pictures.length);
      }
    },
    [insert, sessionId]
  );

  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = [...e.clipboardData.files];
      if (
        files.some(
          (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
        )
      ) {
        e.preventDefault();
        void attach(files);
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      if (lineCount(text.replace(/\r\n?/g, "\n")) > PASTE_LINES) {
        e.preventDefault();
        pasteText(text);
      }
    },
    [attach, pasteText]
  );

  const onTextChange = useCallback(
    (next: string, at: number) => {
      const fixed = keepChipsWhole(displayRef.current, next, chipsRef.current);
      if (fixed) setDisplay(fixed.display, fixed.caret);
      else {
        setDisplay(next);
        setCaret(at);
      }
    },
    [setDisplay]
  );

  // A tap on a pill opens its preview; the caret never rests inside one
  const onTap = useCallback(() => {
    const el = textareaRef.current;
    if (!el || el.selectionStart !== el.selectionEnd) return;
    const chip = chipAt(chipsRef.current, el.selectionStart);
    if (!chip) return;
    el.setSelectionRange(chip.end, chip.end);
    setCaret(chip.end);
    setPreview({ kind: chip.kind, n: chip.n });
  }, []);

  const onSelect = useCallback(() => {
    const el = textareaRef.current;
    if (el) setCaret(el.selectionStart);
  }, []);

  /**
   * Keys the composer takes before the box's own Enter handling: picker
   * navigation, history and Ctrl-R. True when it took the key.
   */
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.nativeEvent.isComposing) return false;
      const el = e.currentTarget;
      const plain = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;

      if (pickerToken && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(displayRef.current);
        return true;
      }
      if (pickerToken && suggestions.length > 0 && plain) {
        const s = suggestions[Math.min(selected, suggestions.length - 1)];
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          setSelected(
            (i) => (i + step + suggestions.length) % suggestions.length
          );
          return true;
        }
        const word = displayRef.current.slice(
          pickerToken.start,
          pickerToken.end
        );
        // Enter on a command already typed out sends it, as Claude Code
        if (
          e.key === "Tab" ||
          (e.key === "Enter" && word !== s.insert.trim())
        ) {
          e.preventDefault();
          choose(s);
          return true;
        }
      }

      if (!claude) return false;
      if (e.key === "r" && e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setHistoryOpen(true);
        return true;
      }
      if (plain && e.key === "ArrowUp" && entries.length > 0) {
        const onFirstLine = !el.value
          .slice(0, el.selectionStart)
          .includes("\n");
        if ((value === "" || recalled >= 0) && onFirstLine) {
          e.preventDefault();
          const next = Math.min(recalled + 1, entries.length - 1);
          recall(entries[next].text, next);
          return true;
        }
      }
      if (plain && e.key === "ArrowDown" && recalled >= 0) {
        const onLastLine = !el.value.slice(el.selectionEnd).includes("\n");
        if (onLastLine) {
          e.preventDefault();
          const next = recalled - 1;
          recall(next >= 0 ? entries[next].text : "", next);
          return true;
        }
      }
      return false;
    },
    [
      pickerToken,
      suggestions,
      selected,
      choose,
      claude,
      entries,
      value,
      recalled,
      recall,
    ]
  );

  // Arrow keys step over pills, never into them
  const onKeyUp = useCallback(() => {
    const el = textareaRef.current;
    if (!el || el.selectionStart !== el.selectionEnd) return;
    const chip = chipAt(chipsRef.current, el.selectionStart);
    if (!chip) return;
    const at = caret <= chip.start ? chip.end : chip.start;
    el.setSelectionRange(at, at);
    setCaret(at);
  }, [caret]);

  // ---- What the box shows: modes, magic words, highlight
  const mode: ComposerMode = !claude
    ? null
    : display.startsWith("!")
      ? "bash"
      : display.startsWith("#")
        ? "memory"
        : null;

  const magicWords: MagicWord[] = MAGIC_WORDS;
  const pattern = useMemo(() => magicWordPattern(magicWords), [magicWords]);
  const { segments, magic } = useMemo(() => {
    const ranges: {
      start: number;
      end: number;
      kind: Segment["kind"];
      chip?: Chip;
    }[] = chips.map((c) => ({
      start: c.start,
      end: c.end,
      kind: "chip",
      chip: c,
    }));
    const found = new Set<string>();
    if (claude && pattern && mode !== "bash") {
      for (const m of display.matchAll(pattern)) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        if (ranges.some((r) => r.start < end && r.end > start)) continue;
        ranges.push({ start, end, kind: "magic" });
        found.add(m[0].toLowerCase());
      }
    }
    ranges.sort((a, b) => a.start - b.start);
    const out: Segment[] = [];
    let last = 0;
    for (const r of ranges) {
      if (r.start > last)
        out.push({ text: display.slice(last, r.start), kind: "plain" });
      out.push({
        text: display.slice(r.start, r.end),
        kind: r.kind,
        chip: r.chip,
      });
      last = r.end;
    }
    if (last < display.length)
      out.push({ text: display.slice(last), kind: "plain" });
    return {
      segments: ranges.length ? out : null,
      magic: magicWords.filter((w) => found.has(w.word.toLowerCase())),
    };
  }, [display, chips, claude, pattern, mode, magicWords]);

  // Passages quoted with "Reply to this" go first, as blockquotes. A slash
  // command, bash or memory line must keep its prefix first to run, so it
  // goes alone and the quotes wait for the next message
  const quotes = useQuotes(sessionId);
  const command = !!claude && /^[/!#]/.test(value.trimStart());
  const text = useMemo(
    () => (quotes.length && !command ? formatWithQuotes(quotes, value) : value),
    [quotes, value, command]
  );

  /** After a send: the pills, quotes and history position start over */
  const sent = useCallback(() => {
    setPastes([]);
    setHist(-1);
    setPreview(null);
    setDismissed(null);
    if (sessionId && !command) clearQuotes(sessionId);
  }, [setPastes, sessionId, command]);

  /** The whole draft becomes `text` (cleared after a send, a queued
      message brought back to edit); no pills */
  const replace = useCallback(
    (next: string) => setDisplay(next, next.length, []),
    [setDisplay]
  );

  return {
    textareaRef,
    /** The draft as saved: pills expanded, no quotes */
    draft: value,
    /** The full text, pills expanded and quotes first: what to send */
    text,
    quotes,
    display,
    chips,
    segments,
    magic,
    mode,
    claude,
    cwd,
    focused,
    setFocused,
    uploading,
    // pickers
    picker: pickerToken && suggestions.length > 0 ? pickerToken.kind : null,
    listboxId,
    suggestions,
    selected,
    setSelected,
    choose,
    // history
    recalled,
    historyCount: entries.length,
    historyOpen,
    setHistoryOpen,
    recall,
    // pills
    previewChip,
    openChip: (chip: Chip) => setPreview({ kind: chip.kind, n: chip.n }),
    /** An image's size in bytes, once known */
    imageSize: (path: string) => sizes[images.indexOf(path)],
    closePreview: () => setPreview(null),
    removeChip,
    unfoldChip,
    // editing
    insert,
    replace,
    attach,
    pasteText,
    onTextChange,
    onPaste,
    onSelect,
    onTap,
    onKeyDown,
    onKeyUp,
    sent,
  };
}

export type ComposerEngine = ReturnType<typeof useComposer>;
