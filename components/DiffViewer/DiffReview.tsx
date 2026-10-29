"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  File,
  Loader2,
  MessageSquare,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";
import type { DiffLine } from "@/lib/diff-parser";
import type { DiffScope } from "@/lib/turn-types";
import type { ReviewComment } from "@/lib/review-types";
import { timeAgo } from "@/lib/agent-state";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useTurns } from "@/hooks/useTurns";
import { useSessionDiff } from "@/hooks/useSessionDiff";
import { useReviewComments } from "@/hooks/useReviewComments";
import { useReviewSend } from "@/hooks/useReviewSend";
import { commentCount } from "@/lib/review-send";
import { DiffCounts, DiffLines } from "./UnifiedDiff";
import { FileDiffCard } from "./FileDiffCard";
import { CommentBox } from "./CommentBox";
import { CommentTray } from "./CommentTray";
import { SelectionBar } from "./SelectionBar";
import { countsOf, diffPath as pathOf, splitPath } from "./diff-format";
import {
  commentFlow,
  lineCount,
  quoteOf,
  rangeOf,
  sideOf,
  tapSelection,
  type DiffLayout,
  type LineHit,
  type LineSelection,
} from "./review-selection";

export interface DiffReviewProps {
  session: Session;
  /** "Claude", "Codex": the header's sub line and the send buttons */
  agentName: string;
  /** Where it opens: the turn card's Diff gives turn:N */
  initialScope: DiffScope;
  /**
   * "page": the open Duo's / desktop's right page beside the chat (O-Diff,
   * D-Diff); "screen": full screen over the chat (closed Duo, phone, one
   * file at a time with the "1 of 3 files" picker)
   */
  placement: "page" | "screen";
  onClose: () => void;
  /** Undo turn N in the header: opens M2's UndoSheet */
  onUndoTurn?: (turnNo: number) => void;
  className?: string;
  /** The parent's placement extras (on a table: the bottom stops at the fold) */
  style?: CSSProperties;
}

const LAYOUT_KEY = "agentos.diffReview.layout";

function readLayout(): DiffLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

function saveLayout(layout: DiffLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // Private mode or blocked storage: the choice lasts this visit
  }
}

/** turn:4 -> 4; branch, uncommitted -> null */
function turnOf(scope: DiffScope): number | null {
  return scope.startsWith("turn:") ? Number(scope.slice(5)) : null;
}

/** Where a comment is drawn: under its last line on its side */
function markerKey(path: string, side: string, line: number): string {
  return `${path}\u0000${side}\u0000${line}`;
}

const EMPTY: Record<"turn" | "branch" | "uncommitted", string> = {
  turn: "This turn changed no files",
  branch: "No changes on this branch",
  uncommitted: "Nothing uncommitted",
};

/**
 * The diff review (O-Diff, D-Diff): header "Turn N · 3 files · 4m ago ·
 * Claude" with +N −N and Undo turn N, the scope segment This turn / Branch /
 * Uncommitted, Unified/Split on the desktop, file cards with gutter line
 * selection, the floating "2 lines · Comment" bar, the comment box, sent and
 * pending markers on lines, and the desktop's CommentTray.
 */
export function DiffReview({
  session,
  agentName,
  initialScope,
  placement,
  onClose,
  onUndoTurn,
  className,
  style,
}: DiffReviewProps) {
  const mode = useLayoutMode();
  const desktop = mode === "desktop";
  const flow = commentFlow(mode);
  // One file at a time with the picker everywhere but the desktop's page
  const single = placement === "screen" || !desktop;
  // The open Duo's right page (O-Diff): a plain "Diff" title
  const compact = placement === "page" && !desktop;

  const [scope, setScope] = useState<DiffScope>(initialScope);
  useEffect(() => setScope(initialScope), [initialScope]);

  const [layout, setLayout] = useState<DiffLayout>("unified");
  useEffect(() => setLayout(readLayout()), []);
  const shownLayout: DiffLayout = desktop ? layout : "unified";

  const { turns } = useTurns(session.id, { agentName });
  const turnNo = turnOf(scope);
  const turn =
    turnNo === null ? undefined : turns.find((t) => t.turnNo === turnNo);
  // "This turn" goes back to the turn it opened on, else the latest
  const thisTurn = turnOf(initialScope) ?? turns.at(-1)?.turnNo ?? null;
  const hasTurn = thisTurn !== null;

  const { diff, isLoading, error, refetch } = useSessionDiff(
    session.id,
    scope,
    { enabled: true }
  );
  const review = useReviewComments(session.id, { enabled: true, scope });
  const send = useReviewSend(session.id, { enabled: true });

  const files = useMemo(() => diff?.files ?? [], [diff]);
  const totals = countsOf(files);

  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [composing, setComposing] = useState<LineSelection | null>(null);
  const [adding, setAdding] = useState(false);
  const [fileIndex, setFileIndex] = useState(0);
  const [picking, setPicking] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  const openTarget = useRef<number | null>(null);

  // A new scope: nothing selected, first file
  useEffect(() => {
    setSelection(null);
    setComposing(null);
    setFileIndex(0);
    setPicking(false);
    setExpanded({});
  }, [scope]);

  const current = single ? files[Math.min(fileIndex, files.length - 1)] : null;

  // Comments of this scope, where they are drawn
  const markers = useMemo(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const c of review.comments) {
      if (c.scope !== scope) continue;
      const key = markerKey(c.path, c.side, c.endLine);
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return map;
  }, [review.comments, scope]);

  const pendingByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of review.pending)
      if (c.scope === scope) map.set(c.path, (map.get(c.path) ?? 0) + 1);
    return map;
  }, [review.pending, scope]);

  const onLineHit = useCallback(
    (hit: LineHit) => {
      setComposing(null);
      setSelection((prev) => tapSelection(prev, hit, !desktop));
    },
    [desktop]
  );

  const clear = useCallback(() => {
    setSelection(null);
    setComposing(null);
  }, []);
  const startComment = useCallback(() => {
    if (selection) setComposing(selection);
  }, [selection]);

  // Escape, in one place: the selection (or its comment box) first, then
  // the review. Not while typing elsewhere (the chat's composer beside it);
  // the comment box takes its own Escape
  const held = !!selection || !!composing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || typing(e.target)) return;
      e.preventDefault();
      if (held) clear();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [held, clear, onClose]);

  const submit = async (body: string) => {
    const sel = composing;
    const file = sel && files.find((f) => pathOf(f) === sel.path);
    if (!sel || !file) return;
    const input = {
      ...rangeOf(sel),
      scope,
      quote: quoteOf(file, sel),
      body,
    };
    if (flow === "immediate") {
      const { sent } = await send.sendNow(input);
      toast.success(
        sent ? `Sent to ${agentName}` : `Queued: goes when ${agentName} is done`
      );
    } else {
      setAdding(true);
      try {
        await review.add(input);
      } finally {
        setAdding(false);
      }
    }
    setComposing(null);
    setSelection(null);
  };

  // Never rejects: the tray shows send.error
  const sendPending = async () => {
    const { sent, count } = await send.sendPending();
    if (count)
      toast.success(
        sent
          ? `Sent ${commentCount(count)} to ${agentName}`
          : `Queued: goes when ${agentName} is done`
      );
  };

  const discard = async () => {
    try {
      await review.discard();
    } catch {
      toast.error("Couldn't discard the comments");
    }
  };

  // The tray's comment: its scope, its file open, then scrolled to
  const openComment = (c: ReviewComment) => {
    openTarget.current = c.id;
    if (c.scope !== scope) setScope(c.scope);
    else revealFile(c.path);
  };
  const revealFile = useCallback(
    (path: string) => {
      const i = files.findIndex((f) => pathOf(f) === path);
      if (i < 0) return;
      if (single) setFileIndex(i);
      // Unchanged when already open: the effect below re-runs on it
      else setExpanded((e) => (e[path] ? e : { ...e, [path]: true }));
    },
    [files, single]
  );
  useEffect(() => {
    const id = openTarget.current;
    if (id === null) return;
    const c = review.comments.find((x) => x.id === id);
    if (!c || c.scope !== scope) return;
    revealFile(c.path);
    const frame = requestAnimationFrame(() => {
      const el = root.current?.querySelector(`[data-comment-id="${id}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      openTarget.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [files, scope, review.comments, revealFile, expanded, fileIndex]);

  const renderAfter = (path: string) => (line: DiffLine) => {
    const { side, line: n } = sideOf(line);
    if (n === null) return null;
    const here = markers.get(markerKey(path, side, n));
    const box =
      composing &&
      composing.path === path &&
      composing.side === side &&
      composing.endLine === n;
    // The "2 lines · Comment" bar beside the selection's last line (D-Diff)
    const bar =
      selection &&
      !composing &&
      selection.path === path &&
      selection.side === side &&
      selection.endLine === n;
    if (!here && !box && !bar) return null;
    return (
      <>
        {bar && (
          // Right under the last selected line, in the flow: an overlay
          // would be clipped by the card at a file's last lines
          <div className="flex justify-end px-3 py-1.5 font-sans">
            <SelectionBar
              className="shadow-lg"
              lines={lineCount(selection)}
              onComment={startComment}
              onClear={clear}
            />
          </div>
        )}
        {here && <Markers comments={here} />}
        {box && (
          <CommentBox
            range={rangeOf(composing)}
            flow={flow}
            agentName={agentName}
            busy={flow === "immediate" ? send.sending : adding}
            onSubmit={submit}
            onCancel={() => setComposing(null)}
          />
        )}
      </>
    );
  };

  const reviewProps = (path: string) => ({
    path,
    selection,
    onLineHit,
    renderAfter: renderAfter(path),
  });

  const kind = turnNo !== null ? "turn" : (scope as "branch" | "uncommitted");
  const title = compact
    ? "Diff"
    : turnNo !== null
      ? `Turn ${turnNo}`
      : scope === "branch"
        ? "Branch"
        : "Uncommitted";
  const sub = [
    diff ? `${files.length} ${files.length === 1 ? "file" : "files"}` : null,
    turn
      ? turn.undoneAt
        ? "undone"
        : turn.endedAt || turn.startedAt
          ? timeAgo((turn.endedAt ?? turn.startedAt)!)
          : null
      : scope === "branch" && diff?.base
        ? `against ${shortRef(diff.base)}`
        : null,
    agentName,
  ]
    .filter(Boolean)
    .join(" · ");
  const canUndo = turnNo !== null && !!onUndoTurn && !compact;

  let body: ReactNode;
  if (isLoading && !diff) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  } else if (error && !diff) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-muted-foreground text-[13px]">{error}</p>
        <button
          type="button"
          onClick={refetch}
          className="pill pill-secondary pill-sm"
        >
          Try again
        </button>
      </div>
    );
  } else if (files.length === 0) {
    body = (
      <p className="text-muted-foreground flex flex-1 items-center justify-center text-[13px]">
        {EMPTY[kind]}
      </p>
    );
  } else if (single && current) {
    const path = pathOf(current);
    const { name } = splitPath(path);
    const pending = pendingByPath.get(path) ?? 0;
    body = (
      <>
        <div className="group-card shrink-0">
          <button
            type="button"
            aria-expanded={picking}
            onClick={() => setPicking(!picking)}
            className="row min-h-12 w-full text-left"
            title={path}
          >
            <File
              aria-hidden="true"
              className="text-primary dark:text-meter h-4 w-4 shrink-0"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-[13px]">{name}</span>
              <span className="text-muted-foreground truncate text-[13px]">
                {fileIndex + 1} of {files.length}{" "}
                {files.length === 1 ? "file" : "files"}
                {pending > 0 && ` · ${commentCount(pending)}`}
              </span>
            </span>
            {!current.isBinary && (
              <DiffCounts
                added={current.additions}
                removed={current.deletions}
              />
            )}
            {picking ? (
              <ChevronUp className="text-muted-foreground h-4 w-4 shrink-0" />
            ) : (
              <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
            )}
          </button>
          {picking &&
            files.map((f, i) => {
              const p = pathOf(f);
              const split = splitPath(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={i === fileIndex}
                  onClick={() => {
                    setFileIndex(i);
                    setPicking(false);
                    clear();
                  }}
                  className={cn(
                    "row min-h-12 w-full border-t border-[var(--hair)] text-left",
                    i === fileIndex && "sel"
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-[13px]">
                      {split.name}
                    </span>
                    {split.folder && (
                      <span className="text-muted-foreground truncate text-[13px]">
                        {split.folder}
                      </span>
                    )}
                  </span>
                  {!f.isBinary && (
                    <DiffCounts added={f.additions} removed={f.deletions} />
                  )}
                </button>
              );
            })}
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain",
            // On a table it stops at the fold: a soft edge, not a cut line
            mode === "tabletop" &&
              "rounded-b-2xl [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]"
          )}
        >
          <div className="tools">
            {/* Touch screens wrap: no sideways scroll past the page edge */}
            <DiffLines diff={current} wrap={!desktop} {...reviewProps(path)} />
          </div>
        </div>
      </>
    );
  } else {
    body = (
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-3"
        )}
      >
        {files.map((f, i) => {
          const path = pathOf(f);
          const pending = pendingByPath.get(path) ?? 0;
          return (
            <FileDiffCard
              key={path}
              diff={f}
              expanded={expanded[path] ?? i === 0}
              onToggle={(open) => setExpanded((e) => ({ ...e, [path]: open }))}
              layout={shownLayout}
              actions={
                pending > 0 && (
                  <span className="chip bg-primary/20 text-foreground h-6 text-xs">
                    {commentCount(pending)}
                  </span>
                )
              }
              {...reviewProps(path)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <section
      ref={root}
      aria-label="Diff"
      style={style}
      className={cn(
        "flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden",
        desktop
          ? "px-6 pt-[18px] pb-6"
          : cn(
              "pt-5 pb-[max(16px,env(safe-area-inset-bottom))] pl-4",
              // The open Duo's right page keeps O-Diff's 16px inset
              compact ? "pr-4" : "pr-2"
            ),
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {placement === "screen" && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="t-title truncate">{title}</h2>
          {!compact && sub && (
            <span className="text-muted-foreground truncate text-[13px]">
              {sub}
            </span>
          )}
        </div>
        {files.length > 0 && (
          <span className="chip shrink-0">
            <span className="n-add">+{totals.added}</span>
            <span className="n-del">−{totals.removed}</span>
          </span>
        )}
        {placement === "page" && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close diff"
            title="Close (Esc)"
            className="text-muted-foreground hover:bg-accent -mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        {canUndo && (
          <button
            type="button"
            onClick={() => onUndoTurn!(turnNo!)}
            disabled={!!turn?.undoneAt}
            aria-label={`Undo turn ${turnNo}`}
            title={turn?.undoneAt ? "This turn was undone" : undefined}
            className={cn(
              "pill pill-secondary pill-sm shrink-0 disabled:opacity-50",
              !desktop && "w-9 px-0"
            )}
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            {desktop && `Undo turn ${turnNo}`}
          </button>
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div
          className="seg bg-card max-w-full self-start overflow-x-auto"
          role="group"
          aria-label="Diff scope"
        >
          {hasTurn && (
            <button
              type="button"
              aria-pressed={turnNo !== null}
              onClick={() => setScope(`turn:${thisTurn!}`)}
              className="shrink-0"
            >
              This turn
            </button>
          )}
          <button
            type="button"
            aria-pressed={scope === "branch"}
            onClick={() => setScope("branch")}
            className="shrink-0"
          >
            Branch
          </button>
          <button
            type="button"
            aria-pressed={scope === "uncommitted"}
            onClick={() => setScope("uncommitted")}
            className="shrink-0"
          >
            Uncommitted
          </button>
        </div>
        {desktop && placement === "page" && (
          <div className="seg bg-card" role="group" aria-label="Layout">
            {(["unified", "split"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={layout === l}
                onClick={() => {
                  setLayout(l);
                  saveLayout(l);
                }}
              >
                {l === "unified" ? "Unified" : "Split"}
              </button>
            ))}
          </div>
        )}
      </div>

      {body}

      {/* The Duo sends at once: its tray only holds comments whose queued
          message was cancelled, to send again or discard */}
      {(flow === "tray" || review.pending.length > 0) && (
        <CommentTray
          className="shrink-0"
          comments={review.pending}
          agentName={agentName}
          // Not while a comment is still being saved: it'd be left out
          sending={send.sending || adding}
          error={send.error}
          onSend={() => void sendPending()}
          onDiscard={() => void discard()}
          onOpen={openComment}
          onRemove={(c) =>
            void review
              .remove(c.id)
              .catch(() => toast.error("Couldn't remove the comment"))
          }
        />
      )}
    </section>
  );
}

/** Typing somewhere: Escape belongs to that field */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

function markerState(c: ReviewComment): string {
  return c.sentAt !== null
    ? "Sent"
    : c.queueItemId !== null
      ? "Queued"
      : "Pending";
}

/**
 * A line's comments: one marker, the latest ("Sent · Keep the chevron
 * muted") and "+2" for the older sent ones, which open under it
 */
function Markers({ comments }: { comments: ReviewComment[] }) {
  const [open, setOpen] = useState(false);
  const newest = [...comments].sort(
    (a, b) => b.createdAt - a.createdAt || b.id - a.id
  );
  // The latest, and any still to go (the tray opens those by id)
  const shown = open
    ? newest
    : newest.filter((c, i) => i === 0 || c.sentAt === null);
  const more = newest.length - shown.length;
  return (
    <div className="flex flex-col items-start gap-1 px-3 pt-1 pb-1.5 pl-9 font-sans">
      {shown.map((c, i) => (
        <span key={c.id} className="flex max-w-full items-center gap-1">
          <span
            data-comment-id={c.id}
            title={c.body}
            className="chip bg-primary/20 text-foreground h-7 min-w-0"
          >
            <MessageSquare
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">
              {markerState(c)} · {c.body}
            </span>
          </span>
          {i === 0 && (open ? newest.length > 1 : more > 0) && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={
                open ? "Show the latest only" : `${more} more on this line`
              }
              onClick={() => setOpen(!open)}
              className="chip bg-primary/20 text-foreground h-7 shrink-0 px-2.5"
            >
              {open ? "−" : `+${more}`}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** A sha as 7 characters; a ref name as it is */
function shortRef(ref: string): string {
  return /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref;
}
