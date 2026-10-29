"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { Segmented } from "@/components/Terminal/ToolbarSettings";
import { columnIcon } from "@/components/ControlColumn/icons";
import { useColumnOrder } from "@/hooks/useColumnOrder";
import {
  COLUMN_CHOICES,
  COLUMN_DEFAULTS,
  savedOrder,
  slotLabel,
  type ColumnKind,
  type ColumnOrder,
  type ColumnSlot,
} from "@/lib/column-spec";
import { haptic } from "@/lib/haptics";
import { gestures } from "@/lib/gestures";
import { cn } from "@/lib/utils";
import { SettingGroup } from "./SettingGroup";

const KINDS: { value: ColumnKind; label: string }[] = [
  { value: "session", label: "In a session" },
  { value: "beside", label: "Side by side" },
  { value: "now", label: "Now" },
];

/** What stays put at each end of a column */
const PINNED: Record<ColumnKind, { first?: string; last: string }> = {
  session: { first: "Back", last: "More" },
  beside: { first: "Back", last: "More" },
  now: { last: "Settings" },
};

const LAST_ICON: Record<ColumnKind, string> = {
  session: "Ellipsis",
  beside: "Ellipsis",
  now: "Settings",
};

/** The order of the column's items, saved for every device */
export function ColumnSection() {
  const { order, save } = useColumnOrder();
  const [kind, setKind] = useState<ColumnKind>("session");
  const own = savedOrder(kind, order);
  const slots = own ?? COLUMN_DEFAULTS[kind];
  const pool = COLUMN_CHOICES[kind].filter((s) => !slots.includes(s));
  const pinned = PINNED[kind];

  const set = (next: ColumnSlot[]) =>
    save({ ...order, [kind]: next } as ColumnOrder);
  const move = (slot: ColumnSlot, by: -1 | 1) => {
    const from = slots.indexOf(slot);
    const to = from + by;
    if (from < 0 || to < 0 || to >= slots.length) return;
    set(arrayMove(slots, from, to));
  };
  const remove = (slot: ColumnSlot) => set(slots.filter((s) => s !== slot));
  const add = (slot: ColumnSlot) => set([...slots, slot]);
  const reset = () => {
    const rest = { ...order };
    delete rest[kind];
    save(rest);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const onDragEnd = (e: DragEndEvent) => {
    setTimeout(() => (gestures.dragging = false));
    if (!e.over) return;
    const from = slots.indexOf(e.active.id as ColumnSlot);
    const to = slots.indexOf(e.over.id as ColumnSlot);
    if (from < 0 || to < 0 || from === to) return;
    haptic("light");
    set(arrayMove(slots, from, to));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="mr-[var(--settings-gutter-r,20px)] ml-[var(--settings-gutter-l,20px)]">
        <Segmented
          label="Which column"
          value={kind}
          options={KINDS}
          onChange={setKind}
        />
      </div>

      <Preview slots={slots} kind={kind} />

      <SettingGroup className="divide-y-0 overflow-hidden">
        {pinned.first && <PinnedRow icon="ChevronLeft" label="Back" />}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={() => {
            gestures.dragging = true;
            haptic("medium");
          }}
          onDragEnd={onDragEnd}
          onDragCancel={() => setTimeout(() => (gestures.dragging = false))}
        >
          <SortableContext items={slots} strategy={verticalListSortingStrategy}>
            {slots.map((slot, i) => (
              <SortableSlot
                key={slot}
                slot={slot}
                first={i === 0}
                last={i === slots.length - 1}
                onMove={move}
                onRemove={remove}
              />
            ))}
          </SortableContext>
        </DndContext>
        {slots.length === 0 && (
          <p className="text-muted-foreground px-3.5 py-3 text-[13px]">
            Nothing between the ends. Add some below.
          </p>
        )}
        <PinnedRow icon={LAST_ICON[kind]} label={pinned.last} />
      </SettingGroup>
      <p className="text-muted-foreground mr-[var(--settings-gutter-r,20px)] ml-[var(--settings-gutter-l,20px)] text-[13px]">
        {kind === "now"
          ? "Settings stays last."
          : "Back stays first and More last. What you take out is in More."}
        {kind === "session" &&
          " With the keyboard up the closed Duo keeps the first two."}
      </p>

      {pool.length > 0 && kind !== "now" && (
        <h3 className="text-muted-foreground mr-[var(--settings-gutter-r,20px)] -mb-2 ml-[var(--settings-gutter-l,20px)] pt-2 text-[13px] font-medium uppercase">
          In More
        </h3>
      )}
      {pool.length > 0 && (
        <SettingGroup>
          {pool.map((slot) => {
            const { icon, label } = slotLabel(slot);
            return (
              <SlotRow
                key={slot}
                icon={icon}
                label={label}
                end={
                  <button
                    type="button"
                    onClick={() => add(slot)}
                    aria-label={`Add ${label}`}
                    className="-mr-2 grid h-11 w-11 shrink-0 place-items-center"
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <Plus className="h-3.5 w-3.5" />
                    </span>
                  </button>
                }
              />
            );
          })}
        </SettingGroup>
      )}

      <SettingGroup>
        <button
          type="button"
          onClick={reset}
          disabled={!own}
          className="text-destructive flex min-h-[44px] w-full items-center gap-1.5 px-3.5 text-left text-[15px] disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to default
        </button>
      </SettingGroup>
    </div>
  );
}

/** The column as it will look, top to bottom laid across */
function Preview({ slots, kind }: { slots: ColumnSlot[]; kind: ColumnKind }) {
  const icons = [
    ...(PINNED[kind].first ? ["ChevronLeft"] : []),
    ...slots.map((s) => slotLabel(s).icon),
    LAST_ICON[kind],
  ];
  return (
    <div
      aria-hidden="true"
      className="bg-card ring-border mr-[var(--settings-gutter-r,20px)] ml-[var(--settings-gutter-l,20px)] flex items-center justify-center gap-1 overflow-x-auto rounded-full px-3 py-2 ring-1"
    >
      {icons.map((name, i) => {
        const Icon = columnIcon(name);
        return (
          <span
            key={i}
            className="text-foreground/80 grid h-9 w-9 shrink-0 place-items-center rounded-full"
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
        );
      })}
    </div>
  );
}

function SlotRow({
  icon,
  label,
  note,
  handle,
  end,
  children,
}: {
  icon: string;
  label: string;
  note?: string;
  handle?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
}) {
  const Icon = columnIcon(icon);
  return (
    <div className="border-hair flex min-h-[48px] items-center gap-2 border-b px-3.5 last:border-b-0">
      {handle ?? <span className="-ml-2 w-11 shrink-0" />}
      <Icon className="text-muted-foreground h-[18px] w-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[15px]">
        {label}
        {note && (
          <span className="text-muted-foreground text-[13px]"> · {note}</span>
        )}
      </span>
      {children}
      {end}
    </div>
  );
}

function PinnedRow({ icon, label }: { icon: string; label: string }) {
  return <SlotRow icon={icon} label={label} note="stays put" />;
}

function SortableSlot({
  slot,
  first,
  last,
  onMove,
  onRemove,
}: {
  slot: ColumnSlot;
  first: boolean;
  last: boolean;
  onMove: (slot: ColumnSlot, by: -1 | 1) => void;
  onRemove: (slot: ColumnSlot) => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slot });
  const { icon, label } = slotLabel(slot);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        isDragging && "bg-background relative z-10 rounded-md shadow-xl"
      )}
    >
      <SlotRow
        icon={icon}
        label={label}
        handle={
          // The handle alone drags, so the list still scrolls by touch
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${label}`}
            className="text-muted-foreground -ml-2 flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        }
        end={
          <button
            type="button"
            onClick={() => onRemove(slot)}
            aria-label={`Remove ${label}`}
            className="-mr-2 grid h-11 w-11 shrink-0 place-items-center"
          >
            <span className="bg-destructive/15 text-destructive grid h-6 w-6 place-items-center rounded-full">
              <Minus className="h-3.5 w-3.5" />
            </span>
          </button>
        }
      >
        {/* For screen readers and keyboards: one step at a time */}
        <button
          type="button"
          disabled={first}
          onClick={() => onMove(slot, -1)}
          aria-label={`Move ${label} up`}
          className="hover:bg-muted sr-only rounded p-1 focus-visible:not-sr-only"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={last}
          onClick={() => onMove(slot, 1)}
          aria-label={`Move ${label} down`}
          className="hover:bg-muted sr-only rounded p-1 focus-visible:not-sr-only"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </SlotRow>
    </div>
  );
}

/** The Settings list's value for the section */
export function columnSummary(order: ColumnOrder): string {
  return Object.keys(order).length ? "Custom" : "Default";
}
