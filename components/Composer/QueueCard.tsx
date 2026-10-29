"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { toast } from "sonner";
import { Cloud, GripVertical, Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UseQueue } from "@/hooks/useQueue";
import type { QueueItem } from "@/lib/queue/types";
import { dropIndex, holdCaption } from "./queue-model";

export interface QueueCardProps {
  queue: UseQueue;
  /** "Claude": "Sends when Claude is done. Held while it asks you something." */
  agentName: string;
  /** Lines Claude's own TUI holds (typed in the terminal): read-only rows */
  typedInTerminal?: readonly string[];
  /** Edit: the item's text goes back into the composer */
  onEdit?: (itemId: number, text: string) => void;
}

const VIOLET = "text-[#6D28D9] dark:text-[#C4B5FD]";
const ICON_BUTTON =
  "text-muted-foreground flex h-11 w-11 flex-none touch-manipulation items-center justify-center rounded-full active:bg-foreground/10";
/** The text and its label: the tap target for Edit */
const BODY = "flex min-w-0 flex-1 flex-col gap-px px-1 py-[7px] text-left";
/** The list's gap between rows */
const ROW_GAP = 6;

interface Drag {
  id: number;
  from: number;
  startY: number;
  dy: number;
  to: number;
  /** The pending rows' middles and the dragged row's height, at the start */
  mids: number[];
  height: number;
}

/** Something went wrong with a queue action: say so, briefly */
function report(e: unknown) {
  toast.error(e instanceof Error ? e.message : "Couldn't change the queue");
}

/**
 * N-Queue: "2 queued · Saved on the server", dashed purple items with drag,
 * Edit and ×, and the caption. Replaces ClaudeStateBar's QueuedMessages.
 * Renders nothing when there is nothing queued
 */
export function QueueCard({
  queue,
  agentName,
  typedInTerminal = [],
  onEdit,
}: QueueCardProps) {
  const { items } = queue;
  const sending = items.filter((i) => i.status !== "pending");
  const pending = items.filter((i) => i.status === "pending");
  const [drag, setDrag] = useState<Drag | null>(null);
  const rowsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  if (!items.length && !typedInTerminal.length) return null;

  const startDrag = (e: PointerEvent<HTMLButtonElement>, item: QueueItem) => {
    if (e.button !== 0) return;
    const from = pending.findIndex((i) => i.id === item.id);
    const rects = pending.map((i) =>
      rowsRef.current.get(i.id)?.getBoundingClientRect()
    );
    if (from < 0 || rects.some((r) => !r)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      id: item.id,
      from,
      startY: e.clientY,
      dy: 0,
      to: from,
      mids: rects.map((r) => r!.top + r!.height / 2),
      height: rects[from]!.height,
    });
  };
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    setDrag({
      ...drag,
      dy,
      to: dropIndex(drag.mids, drag.from, drag.mids[drag.from] + dy),
    });
  };
  const endDrag = () => {
    if (!drag) return;
    setDrag(null);
    if (drag.to !== drag.from) queue.move(drag.id, drag.to + 1).catch(report);
  };

  /** Arrow keys on the handle move it a place */
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to =
      e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : -1;
    if (to < 0 || to >= pending.length) return;
    e.preventDefault();
    queue.move(pending[index].id, to + 1).catch(report);
  };

  /** How far a row moves aside for the one being dragged */
  const shift = (index: number): number => {
    if (!drag || index === drag.from) return 0;
    const step = drag.height + ROW_GAP;
    if (drag.from < index && index <= drag.to) return -step;
    if (drag.to <= index && index < drag.from) return step;
    return 0;
  };

  const row = (item: QueueItem, n: number, index: number | null) => {
    const label = `queued ${n}`;
    const dragging = drag?.id === item.id;
    const offset = dragging ? drag.dy : index === null ? 0 : shift(index);
    const editable = !!onEdit && index !== null;
    const body = (
      <>
        <span className="flex items-center gap-[5px] text-xs">
          <span className={cn("font-semibold", VIOLET)}>
            {index === null ? "Sending" : `Queued ${n}`}
          </span>
          {editable && (
            <span className="text-muted-foreground flex items-center gap-[5px]">
              <Pencil className="h-3 w-3" aria-hidden="true" />
              Edit
            </span>
          )}
        </span>
        <span className="block w-full truncate text-sm">{item.text}</span>
      </>
    );
    return (
      <div
        key={item.id}
        ref={(el) => {
          if (el) rowsRef.current.set(item.id, el);
          else rowsRef.current.delete(item.id);
        }}
        role="listitem"
        className={cn(
          "queue-item relative",
          dragging
            ? "z-10 shadow-[0_8px_24px_rgb(0_0_0/0.35)]"
            : drag && "transition-transform duration-150"
        )}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
      >
        {index === null ? (
          // On its way in: no moving it now
          <span className={ICON_BUTTON} aria-hidden="true">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Reorder ${label}, hold and drag`}
            title="Drag to reorder"
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => startDrag(e, item)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => onHandleKey(e, index)}
            className={cn(ICON_BUTTON, "cursor-grab touch-none")}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        {editable ? (
          <button
            type="button"
            aria-label={`Edit ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onEdit(item.id, item.text)}
            className={BODY}
          >
            {body}
          </button>
        ) : (
          <div className={BODY}>{body}</div>
        )}
        {index !== null && (
          <button
            type="button"
            aria-label={`Remove ${label}`}
            title="Don't send"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => queue.cancel(item.id).catch(report)}
            className={ICON_BUTTON}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground flex items-center justify-between gap-2 px-1 text-[13px]">
        <span className="text-foreground/90 font-semibold">
          {items.length ? `${items.length} queued` : `Typed in the terminal`}
        </span>
        {items.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
            Saved on the server
          </span>
        )}
      </div>
      <div
        className="flex flex-col gap-1.5"
        role="list"
        aria-label="Queued messages"
      >
        {sending.map((item, i) => row(item, i + 1, null))}
        {pending.map((item, i) => row(item, sending.length + i + 1, i))}
        {typedInTerminal.map((text, i) => (
          // Claude's own queue: it takes these when its turn ends; only the
          // terminal can change them
          <div
            key={`typed-${i}`}
            role="listitem"
            className="border-border flex min-h-[52px] flex-col justify-center gap-px rounded-2xl border border-dashed px-3.5 py-[7px]"
          >
            <span className="text-muted-foreground text-xs">
              Typed in terminal
            </span>
            <span className="truncate text-sm">{text}</span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground px-1 text-[13px]">
        {items.length
          ? holdCaption(queue.holdReason, agentName)
          : `${agentName} takes these when its turn ends.`}
      </p>
    </div>
  );
}
