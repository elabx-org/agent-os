"use client";

import { ChevronRight } from "lucide-react";
import { Markdown } from "@/components/Markdown";
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
}: {
  row: Row;
  results: Map<string, ResultItem>;
  agents?: Map<string, SubagentInfo>;
  onOpenAgent?: (agentId: string) => void;
  workflows?: Map<string, WorkflowInfo>;
  onShowWorkflow?: (runId: string) => void;
  quotable?: boolean;
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
        {text && <UserBubble text={text} />}
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
  if (row.kind === "assistant")
    return (
      <Markdown
        text={row.text}
        className="say text-[15px] leading-normal break-words"
        quotable={quotable}
        sourceId={row.id}
      />
    );
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
function UserBubble({ text }: { text: string }) {
  const comments = parseReviewMessage(text);
  return (
    <div className="bubble-me ml-8 flex min-w-0 flex-col gap-2 text-[15px] [overflow-wrap:anywhere] whitespace-pre-wrap">
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
        : text}
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
