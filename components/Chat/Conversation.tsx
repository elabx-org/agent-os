"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useLongPress } from "@/hooks/useLongPress";
import { Markdown } from "@/components/Markdown";
import {
  ImageThumb,
  imageSrc,
  isImageUrl,
} from "@/components/Composer/ImagePill";
import {
  imageName,
  replyImages,
  splitImages,
} from "@/components/Composer/text";
import { showImage } from "@/lib/client/image-view";
import type { SubagentInfo } from "@/lib/claude-subagents";
import type { WorkflowInfo } from "@/lib/claude-workflows";
import type { Turn } from "@/lib/turn-types";
import { splitUndoNotice } from "@/lib/queue/types";
import { parseReviewMessage, rangeLabel } from "@/lib/review-format";
import { splitAttachmentBlock } from "@/lib/session-attach-types";
import { AttachedSessionsLine } from "./AttachedSessionsLine";
import type { ResultItem, Row } from "./rows";
import { ToolRun } from "./ToolCard";
import { TurnCard } from "./TurnCard";

/** Per turn: its card's Diff and Undo turn */
export interface TurnActions {
  /** placeTurns: the cards that follow each row */
  after: Map<string, Turn[]>;
  onDiff: (turnNo: number) => void;
  onUndo: (turnNo: number) => void;
  /** The turn whose diff review is open: its card shows it (O-Diff, D-Diff) */
  diffTurn?: number | null;
}

function RowView({
  row,
  results,
  agents,
  onOpenAgent,
  workflows,
  onShowWorkflow,
  quotable,
  onReuse,
  sessionId,
}: {
  row: Row;
  results: Map<string, ResultItem>;
  agents?: Map<string, SubagentInfo>;
  onOpenAgent?: (agentId: string) => void;
  workflows?: Map<string, WorkflowInfo>;
  onShowWorkflow?: (runId: string) => void;
  quotable?: boolean;
  onReuse?: (text: string) => void;
  sessionId?: string;
}) {
  if (row.kind === "user") {
    // The undo notice and the attached sessions' block the server put in
    // front aren't the user's words
    const notice = splitUndoNotice(row.text);
    const { undoneTurn } = notice;
    const { text, attached, summaries } = splitAttachmentBlock(notice.text);
    return (
      <div className="flex min-w-0 flex-col items-end gap-1">
        {undoneTurn !== null && (
          <span className="text-muted-foreground text-xs">
            Told it turn {undoneTurn} was undone
          </span>
        )}
        <AttachedSessionsLine
          names={attached}
          summaries={summaries}
          className="ml-8"
        />
        {text && (
          <UserBubble
            text={text}
            onReuse={onReuse}
            sessionId={sessionId}
            entryId={row.id}
          />
        )}
      </div>
    );
  }
  if (row.kind === "summary")
    return (
      <details className="group text-xs">
        <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
          <span className="bg-hair h-px flex-1" />
          <span className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Earlier conversation summarised
          </span>
          <span className="bg-hair h-px flex-1" />
        </summary>
        <div className="bg-card mt-1 max-h-[60vh] overflow-y-auto rounded-2xl p-3">
          <Markdown text={row.text} className="text-xs break-words" />
        </div>
      </details>
    );
  if (row.kind === "assistant") {
    const pictures = replyImages(row.text);
    const say = (
      <Markdown
        text={row.text}
        className="say text-[15px] leading-normal break-words"
        quotable={quotable}
        sourceId={row.id}
      />
    );
    if (!pictures.length) return say;
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {say}
        <ReplyImages paths={pictures} />
      </div>
    );
  }
  return (
    <ToolRun
      tools={row.tools}
      results={results}
      agents={agents}
      onOpenAgent={onOpenAgent}
      workflows={workflows}
      onShowWorkflow={onShowWorkflow}
    />
  );
}

/**
 * The user's message. Line comments sent from the diff review (O-Diff) read
 * as a quote card per comment: the file:lines label, then the comment
 */
function UserBubble({
  text: sent,
  onReuse,
  sessionId,
  entryId,
}: {
  text: string;
  onReuse?: (text: string) => void;
  /** The session and transcript entry, for pictures pasted into Claude Code */
  sessionId?: string;
  entryId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  // Hold (or right-click): Edit and resend, Copy
  useLongPress(ref, () => setMenu(true));
  const comments = parseReviewMessage(sent);
  // Pictures sent with it show as pictures, not their /tmp paths
  const split = comments
    ? { images: [], pasted: 0, text: sent }
    : splitImages(sent);
  const { text } = split;
  // Pictures pasted into Claude Code are kept in the transcript itself
  const pasted =
    sessionId && entryId
      ? Array.from(
          { length: split.pasted },
          (_, n) =>
            `/api/sessions/${sessionId}/transcript-image?entry=${entryId}&n=${n}`
        )
      : [];
  const images = [...pasted, ...split.images];
  return (
    <div className="relative ml-8 flex min-w-0 flex-col items-end">
      <div
        ref={ref}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        className="bubble-me flex min-w-0 flex-col gap-2 text-[15px] [overflow-wrap:anywhere] whitespace-pre-wrap select-none [-webkit-touch-callout:none] data-[held]:opacity-80 pointer-fine:select-text"
      >
        {images.length > 0 && <SentImages paths={images} />}
        {comments
          ? comments.map((c, i) => (
              <div key={i} className="flex min-w-0 flex-col gap-1.5">
                <span
                  title={c.path}
                  className="truncate border-l-2 border-current/50 pl-2.5 font-mono text-[13px] opacity-80"
                >
                  {rangeLabel(c)}
                  {c.side === "old" && " (removed)"}
                </span>
                <span>{c.body}</span>
              </div>
            ))
          : text || null}
      </div>
      {menu && (
        <MessageMenu
          onClose={() => setMenu(false)}
          onEdit={
            onReuse
              ? () => {
                  setMenu(false);
                  onReuse(sent);
                }
              : undefined
          }
          onCopy={() => {
            setMenu(false);
            navigator.clipboard
              ?.writeText(sent)
              .then(() => toast("Copied"))
              .catch(() => toast.error("Couldn't copy it"));
          }}
        />
      )}
    </div>
  );
}

/** A sent message's menu, under its bubble */
function MessageMenu({
  onEdit,
  onCopy,
  onClose,
}: {
  onEdit?: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const item =
    "active:bg-foreground/10 hover:bg-foreground/8 flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm";
  return (
    <>
      <div aria-hidden className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="menu"
        className="glass absolute top-full right-0 z-50 mt-1.5 flex w-52 flex-col rounded-2xl p-1.5 shadow-xl"
      >
        {onEdit && (
          <button
            type="button"
            role="menuitem"
            onClick={onEdit}
            className={item}
          >
            <Pencil className="h-4 w-4" />
            Edit and resend
          </button>
        )}
        <button type="button" role="menuitem" onClick={onCopy} className={item}>
          <Copy className="h-4 w-4" />
          Copy
        </button>
      </div>
    </>
  );
}

/**
 * Pictures a reply names (a screenshot Claude took): a row to tap, without
 * the ones that can't be shown (gone, or outside the folders pictures may
 * come from)
 */
function ReplyImages({ paths }: { paths: string[] }) {
  const [broken, setBroken] = useState<string[]>([]);
  const shown = paths.filter((p) => !broken.includes(p)).slice(0, 6);
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((path) => (
        <button
          key={path}
          type="button"
          onClick={(e) => showImage(e.currentTarget, path)}
          aria-label={`View ${imageName(path).replace(/\u2011/g, "-")}`}
          className="bg-muted block overflow-hidden rounded-xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc(path)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken((b) => [...b, path])}
            className={
              shown.length === 1
                ? "max-h-56 max-w-[min(100%,20rem)] object-contain"
                : "h-24 w-24 object-cover"
            }
          />
        </button>
      ))}
    </div>
  );
}

/** A message's pictures: one large, several as a row of squares */
function SentImages({ paths }: { paths: string[] }) {
  const one = paths.length === 1;
  return (
    <div className="flex flex-wrap gap-1.5">
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          onClick={(e) => showImage(e.currentTarget, path)}
          aria-label={`View ${
            isImageUrl(path)
              ? "pasted image"
              : imageName(path).replace(/\u2011/g, "-")
          }`}
          className="block overflow-hidden rounded-xl"
        >
          <ImageThumb
            path={path}
            className={one ? "h-44 w-36 sm:h-56 sm:w-44" : "h-20 w-20"}
          />
        </button>
      ))}
    </div>
  );
}

/**
 * The conversation's messages and tool calls, as rows: one element per
 * row (the book's seam and "Jump to it" count them), a row a turn ended on
 * holding its turn cards too
 */
export function Conversation({
  rows,
  turns,
  ...rest
}: {
  rows: Row[];
  results: Map<string, ResultItem>;
  agents?: Map<string, SubagentInfo>;
  onOpenAgent?: (agentId: string) => void;
  workflows?: Map<string, WorkflowInfo>;
  onShowWorkflow?: (runId: string) => void;
  /** Claude's messages offer "Reply to this" */
  quotable?: boolean;
  turns?: TurnActions;
  /** The user's messages offer "Edit and resend": the text, to the box */
  onReuse?: (text: string) => void;
  /** Whose transcript: pictures pasted into Claude Code load from it */
  sessionId?: string;
}) {
  return (
    <>
      {rows.map((row) => {
        const cards = turns?.after.get(row.id);
        if (!cards || !turns)
          return <RowView key={row.id} row={row} {...rest} />;
        return (
          <div key={row.id} className="flex min-w-0 flex-col gap-3">
            <RowView row={row} {...rest} />
            {cards.map((turn) => (
              <TurnCard
                key={turn.turnNo}
                turn={turn}
                diffOpen={turns.diffTurn === turn.turnNo}
                onDiff={() => turns.onDiff(turn.turnNo)}
                onUndo={() => turns.onUndo(turn.turnNo)}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
