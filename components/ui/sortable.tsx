"use client";

import * as React from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { gestures } from "@/lib/gestures";

// Hold this long to lift a row on touch; a move first is a scroll or swipe
const HOLD_MS = 300;
const STILL_PX = 8;

interface SortableListProps {
  ids: string[];
  onReorder: (ids: string[]) => void;
  /** A touch hold let go without moving: the row's actions */
  onHoldRelease?: (id: string) => void;
  children: React.ReactNode;
}

/**
 * A vertical list whose rows reorder by dragging: hold on touch until the
 * row lifts (the phone ticks), or drag with a mouse. Letting go of a lifted
 * row without moving it asks for its actions instead.
 */
export function SortableList({
  ids,
  onReorder,
  onHoldRelease,
  children,
}: SortableListProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: HOLD_MS, tolerance: STILL_PX },
    })
  );
  const byTouch = React.useRef(false);

  const onDragEnd = ({ active, over, delta, activatorEvent }: DragEndEvent) => {
    // After the touchend handlers on the row have seen the drag
    setTimeout(() => (gestures.dragging = false));
    const id = String(active.id);
    if (over && active.id !== over.id) {
      const from = ids.indexOf(id);
      const to = ids.indexOf(String(over.id));
      if (from >= 0 && to >= 0) {
        haptic("light");
        onReorder(arrayMove(ids, from, to));
      }
      return;
    }
    const still = Math.abs(delta.x) < STILL_PX && Math.abs(delta.y) < STILL_PX;
    if (still && byTouch.current && activatorEvent.type.startsWith("touch"))
      onHoldRelease?.(id);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={({ activatorEvent }) => {
        gestures.dragging = true;
        byTouch.current = activatorEvent.type.startsWith("touch");
        haptic("medium");
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => setTimeout(() => (gestures.dragging = false))}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

interface SortableItemProps {
  id: string;
  disabled?: boolean;
  className?: string;
  /**
   * The row; `handle` goes on the part that starts a drag (the whole row
   * for a session, just the header for a project with its sessions below)
   */
  children: (handle: {
    ref: (el: HTMLElement | null) => void;
    props: Record<string, unknown>;
  }) => React.ReactNode;
}

export function SortableItem({
  id,
  disabled,
  className,
  children,
}: SortableItemProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        className,
        isDragging &&
          "bg-background relative z-10 scale-[1.02] rounded-md shadow-xl"
      )}
    >
      {children({
        ref: setActivatorNodeRef,
        props: disabled ? {} : { ...attributes, ...listeners, role: undefined },
      })}
    </div>
  );
}
