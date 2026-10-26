"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSnapshot } from "valtio";
import {
  X,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  GripVertical,
  Minus,
  Plus,
  Check,
  Mic,
  Clipboard,
  MousePointer2,
  ImagePlus,
  FileText,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { gestures } from "@/lib/gestures";
import {
  getComposerEnabled,
  getTypingAssist,
  setComposerEnabled,
  setTypingAssist,
} from "./typing-assist";
import {
  type ToolbarPreferences,
  type ToolbarButtonId,
  type PresetId,
  type KeysRowId,
  type DuoLayout,
  TOOLBAR_BUTTONS,
  GROUP_LABELS,
  PRESETS,
  CLOSED_ROW_PX,
  OPEN_DUO_ROW_PX,
  getButtonDef,
  keysSettingsStore,
  savedContextRow,
  splitOverflow,
  useToolbarPreferences,
} from "./toolbar-config";

interface ToolbarSettingsProps {
  open: boolean;
  onClose: () => void;
  preferences: ToolbarPreferences;
  onUpdate: (prefs: ToolbarPreferences) => void;
  /** The context row to show first (the one in use) */
  row?: KeysRowId;
}

const ROW_OPTIONS: { value: KeysRowId; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "claudeUp", label: "Claude · typing" },
  { value: "shell", label: "Shell" },
];

const ROW_NAMES: Record<KeysRowId, string> = {
  claude: "Claude",
  claudeUp: "Claude · typing",
  shell: "Shell",
};

export const DUO_LAYOUT_OPTIONS: { value: DuoLayout; label: string }[] = [
  { value: "split", label: "Split" },
  { value: "mirrored", label: "Mirrored" },
  { value: "two-rows", label: "Two rows" },
];

export function ToolbarSettings({
  open,
  onClose,
  preferences,
  onUpdate,
  row = "claude",
}: ToolbarSettingsProps) {
  const [rowId, setRowId] = useState<KeysRowId>(row);
  // Opening shows the row in use; the keyboard going down meanwhile doesn't
  // switch it
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRowId(row);
  }
  const [typingAssist, setTypingAssistState] = useState(getTypingAssist);
  const [composer, setComposer] = useState(getComposerEnabled);

  useEffect(() => {
    if (!open) return;
    keysSettingsStore.open = true;
    return () => {
      keysSettingsStore.open = false;
    };
  }, [open]);

  if (!open) return null;

  const contextMode = preferences.mode !== "custom";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 [html[data-fold=vertical]_&]:left-[var(--fold-end)] [html[data-hinge]_&]:left-[calc(var(--hinge-x)+var(--fold-clear))] [html[data-native]_&]:right-[env(safe-area-inset-right)]"
      onClick={onClose}
    >
      {/* On the open Duo it takes the right page, so the left page's key
          row shows each change as it's made */}
      <div
        className="bg-background flex max-h-[75vh] w-full flex-col rounded-t-xl [html[data-fold=vertical]_&]:max-h-[92vh] [html[data-hinge]_&]:max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">Keys</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="hover:bg-muted rounded-md p-1.5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {/* One row that follows what you're in (default), or rows as set */}
          <Segmented
            label="Key rows"
            value={contextMode ? "context" : "custom"}
            options={[
              { value: "context", label: "Follow context" },
              { value: "custom", label: "Fixed rows" },
            ]}
            onChange={(mode) => onUpdate({ ...preferences, mode })}
          />

          {contextMode ? (
            <ContextRowsEditor
              prefs={preferences}
              rowId={rowId}
              onRowId={setRowId}
              onUpdate={onUpdate}
            />
          ) : (
            <FixedRowsEditor prefs={preferences} onUpdate={onUpdate} />
          )}

          <div className="bg-card ring-border divide-border divide-y rounded-xl ring-1">
            {/* Narrow screens: one row that follows Claude, or the rows above */}
            <label className="flex min-h-[50px] items-center justify-between gap-3 px-3 py-1.5">
              <span className="min-w-0">
                <span className="block text-sm">Adaptive row when closed</span>
                <span className="text-muted-foreground block text-xs">
                  Keys follow what Claude is doing, flick up for more; ⋯ has
                  every key. Off: the rows above
                </span>
              </span>
              <Switch
                checked={preferences.adaptive !== false}
                onCheckedChange={(checked) =>
                  onUpdate({ ...preferences, adaptive: checked })
                }
              />
            </label>
            {/* Text box above the keys instead of typing straight into xterm */}
            <label className="flex min-h-[44px] items-center justify-between gap-3 px-3">
              <span className="text-sm">Compose box</span>
              <Switch
                checked={composer}
                onCheckedChange={(checked) => {
                  setComposer(checked);
                  setComposerEnabled(checked);
                }}
              />
            </label>
            {/* iOS predictions row costs terminal rows on short screens */}
            <label className="flex min-h-[44px] items-center justify-between gap-3 px-3">
              <span className="text-sm">Autocorrect and predictions</span>
              <Switch
                checked={typingAssist}
                onCheckedChange={(checked) => {
                  setTypingAssistState(checked);
                  setTypingAssist(checked);
                }}
              />
            </label>
          </div>

          <p className="text-muted-foreground flex items-center gap-1.5 pb-1 text-xs">
            <Check className="h-3.5 w-3.5" />
            Synced to all your devices · saved on the server
          </p>
        </div>
      </div>
    </div>
  );
}

/** A row of choices, one picked */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="bg-muted flex rounded-lg p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-11 flex-1 rounded-md px-2 text-xs font-medium",
            option.value === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// --- Context rows (Settings → Keys) ---

const TOOL_ICONS: Partial<Record<ToolbarButtonId, typeof Mic>> = {
  mic: Mic,
  paste: Clipboard,
  select: MousePointer2,
  image: ImagePlus,
  snippets: FileText,
};

/** A key as the row shows it, small */
function KeyChip({
  id,
  className,
}: {
  id: ToolbarButtonId;
  className?: string;
}) {
  const def = getButtonDef(id);
  const Icon = TOOL_ICONS[id];
  return (
    <span
      className={cn(
        "flex h-6 min-w-[26px] flex-shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] font-medium",
        id === "ctrl-c"
          ? "border border-red-500/40 bg-red-500/15 text-red-400"
          : "bg-secondary text-secondary-foreground",
        className
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : def?.displayLabel}
    </span>
  );
}

/** The row as it comes out at a width: keys, ⋯ for the rest, ^C last */
function RowPreview({
  label,
  row,
  width,
  pinCtrlC,
}: {
  label: string;
  row: ToolbarButtonId[];
  /** Undefined: every key shows (two rows) */
  width?: number;
  pinCtrlC: boolean;
}) {
  const [shown, more] =
    width === undefined ? [row, []] : splitOverflow(row, width, { pinCtrlC });
  const pinned = pinCtrlC && shown[shown.length - 1] === "ctrl-c";
  const keys = pinned ? shown.slice(0, -1) : shown;
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </div>
      <div className="flex items-center gap-1 overflow-hidden">
        {keys.map((id) => (
          <KeyChip key={id} id={id} />
        ))}
        {more.length > 0 && (
          <span className="bg-secondary text-secondary-foreground flex h-6 min-w-[26px] items-center justify-center rounded-md px-1.5 text-[11px]">
            ⋯
          </span>
        )}
        {pinned && (
          <>
            <span className="flex-1" />
            <KeyChip id="ctrl-c" />
          </>
        )}
      </div>
    </div>
  );
}

function ContextRowsEditor({
  prefs,
  rowId,
  onRowId,
  onUpdate,
}: {
  prefs: ToolbarPreferences;
  rowId: KeysRowId;
  onRowId: (id: KeysRowId) => void;
  onUpdate: (prefs: ToolbarPreferences) => void;
}) {
  const { previewPreferences } = useToolbarPreferences();
  const pinCtrlC = prefs.pinCtrlC ?? true;
  const duoLayout = prefs.duoLayout ?? "split";
  // The live row's own width once a Duo page has shown it; else the estimate
  const { rowWidth: measured } = useSnapshot(keysSettingsStore);
  const openRowPx = measured || OPEN_DUO_ROW_PX;
  const row = savedContextRow(rowId, prefs);
  const pinned = pinCtrlC && row.includes("ctrl-c");
  // While a key is dragged the list keeps its order (dnd-kit moves the rows);
  // the saved row, and every key row showing it, follows the finger
  const [dragBase, setDragBase] = useState<ToolbarButtonId[] | null>(null);
  const startPrefs = useRef(prefs);
  const movable = dragBase ?? (pinned ? row.slice(0, -1) : row);
  const withPin = (ids: ToolbarButtonId[]) =>
    pinned ? [...ids, "ctrl-c" as const] : ids;

  const rowPrefs = (next: ToolbarButtonId[]): ToolbarPreferences => ({
    ...prefs,
    mode: "context",
    contextRows: { ...prefs.contextRows, [rowId]: next },
  });
  const save = (next: ToolbarButtonId[]) => onUpdate(rowPrefs(next));

  const move = (id: ToolbarButtonId, by: -1 | 1) => {
    const from = movable.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= movable.length) return;
    save(withPin(arrayMove(movable, from, to)));
  };
  const remove = (id: ToolbarButtonId) => save(row.filter((k) => k !== id));
  const add = (id: ToolbarButtonId) => save(withPin([...movable, id]));
  const reset = () => {
    const rest = { ...prefs.contextRows };
    delete rest[rowId];
    onUpdate({ ...prefs, contextRows: rest });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const order = (base: ToolbarButtonId[], e: DragOverEvent | DragEndEvent) => {
    if (!e.over) return null;
    const from = base.indexOf(e.active.id as ToolbarButtonId);
    const to = base.indexOf(e.over.id as ToolbarButtonId);
    if (from < 0 || to < 0) return null;
    return arrayMove(base, from, to);
  };
  const onDragOver = (e: DragOverEvent) => {
    if (!dragBase) return;
    const next = order(dragBase, e);
    if (next) previewPreferences(rowPrefs(withPin(next)));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setTimeout(() => (gestures.dragging = false));
    const base = dragBase;
    setDragBase(null);
    const next = base && order(base, e);
    if (next && next.join() !== base.join()) {
      haptic("light");
      save(withPin(next));
    } else previewPreferences(startPrefs.current);
  };
  const onDragCancel = () => {
    setTimeout(() => (gestures.dragging = false));
    setDragBase(null);
    previewPreferences(startPrefs.current);
  };

  // Where ⋯ starts on the closed screen and the open Duo's split row
  const cutAt = (width: number) =>
    splitOverflow(row, width, { pinCtrlC })[0].length - (pinned ? 1 : 0);
  const closedCut = cutAt(CLOSED_ROW_PX);
  const openCut = duoLayout === "two-rows" ? movable.length : cutAt(openRowPx);
  const divider = (at: number) => {
    const closed = at === closedCut;
    const openDuo = at === openCut;
    if (at >= movable.length || (!closed && !openDuo)) return null;
    const where =
      closed && openDuo
        ? "the closed screen and open Duo"
        : closed
          ? "the closed screen"
          : "the open Duo";
    return (
      <div
        key={`cut-${at}`}
        className="border-muted-foreground/40 text-muted-foreground border-y border-dashed px-3 py-1 text-[11px]"
      >
        ⋯ More keys go in ⋯ on {where}
      </div>
    );
  };

  const pool = TOOLBAR_BUTTONS.filter((b) => !row.includes(b.id));

  return (
    <div className="space-y-4">
      <Segmented
        label="Key row"
        value={rowId}
        options={ROW_OPTIONS}
        onChange={onRowId}
      />
      <p className="text-muted-foreground text-xs">
        One row for what you&apos;re in: Claude Code or the shell, keyboard up
        or down. Hold ^C for ^D ^Z ^L and this menu, hold / for more characters.
      </p>

      {/* Live preview: the closed screen and the open Duo */}
      <div className="bg-card ring-border space-y-2 rounded-xl p-3 ring-1">
        <RowPreview
          label="Closed screen"
          row={row}
          width={CLOSED_ROW_PX}
          pinCtrlC={pinCtrlC}
        />
        <RowPreview
          label={
            duoLayout === "two-rows"
              ? "Open Duo · two rows"
              : "Open Duo · split row"
          }
          row={row}
          width={duoLayout === "two-rows" ? undefined : openRowPx}
          pinCtrlC={pinCtrlC}
        />
      </div>

      {/* The row in order: what's above a dashed line is on the row, what's
          below it is in ⋯ */}
      <div className="bg-card ring-border overflow-hidden rounded-xl ring-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={() => {
            gestures.dragging = true;
            startPrefs.current = prefs;
            setDragBase(movable);
            haptic("medium");
          }}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <SortableContext
            items={movable}
            strategy={verticalListSortingStrategy}
          >
            {movable.map((id, i) => [
              divider(i),
              <SortableKey
                key={id}
                id={id}
                first={i === 0}
                last={i === movable.length - 1}
                onMove={move}
                onRemove={remove}
              />,
            ])}
          </SortableContext>
        </DndContext>
        {pinned && <KeyItem id="ctrl-c" note="pinned last" onRemove={remove} />}
        {row.length === 0 && (
          <p className="text-muted-foreground px-3 py-3 text-xs">
            No keys on this row. Add some below.
          </p>
        )}
      </div>

      {pool.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Add keys
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pool.map((def) => (
              <button
                key={def.id}
                type="button"
                onClick={() => add(def.id)}
                aria-label={`Add ${def.label}`}
                title={
                  def.conditional ? `${def.label} (when available)` : def.label
                }
                className="bg-secondary text-secondary-foreground active:bg-accent flex min-h-11 items-center gap-1 rounded-lg py-1 pr-2 pl-1"
              >
                <Plus className="text-muted-foreground h-3.5 w-3.5" />
                <KeyChip id={def.id} className="bg-transparent px-0.5" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card ring-border divide-border divide-y rounded-xl ring-1">
        <label className="flex min-h-[50px] items-center justify-between gap-3 px-3 py-1.5">
          <span className="min-w-0">
            <span className="block text-sm">Keep ^C at the end</span>
            <span className="text-muted-foreground block text-xs">
              Pinned after ⋯ in every context
            </span>
          </span>
          <Switch
            checked={pinCtrlC}
            onCheckedChange={(checked) =>
              onUpdate({ ...prefs, pinCtrlC: checked })
            }
          />
        </label>
        <div className="space-y-1.5 px-3 py-2.5">
          <span className="block text-sm">Open Duo layout</span>
          <Segmented
            label="Open Duo layout"
            value={duoLayout}
            options={DUO_LAYOUT_OPTIONS}
            onChange={(value) => onUpdate({ ...prefs, duoLayout: value })}
          />
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={!prefs.contextRows?.[rowId]}
          className="text-destructive flex min-h-[44px] w-full items-center gap-1.5 px-3 text-left text-sm disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset {ROW_NAMES[rowId]} to default
        </button>
      </div>
    </div>
  );
}

function SortableKey({
  id,
  first,
  last,
  onMove,
  onRemove,
}: {
  id: ToolbarButtonId;
  first: boolean;
  last: boolean;
  onMove: (id: ToolbarButtonId, by: -1 | 1) => void;
  onRemove: (id: ToolbarButtonId) => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const label = getButtonDef(id)?.label ?? id;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        isDragging && "bg-background relative z-10 rounded-md shadow-xl"
      )}
    >
      <KeyItem
        id={id}
        onRemove={onRemove}
        handle={
          // The handle alone drags, so the list still scrolls by touch
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${label}`}
            // 44px to grab; the row's padding and gap give back the room
            className="text-muted-foreground -ml-2 flex h-11 w-11 flex-shrink-0 cursor-grab touch-none items-center justify-center"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        }
      >
        {/* For screen readers and keyboards: one step at a time */}
        <button
          type="button"
          disabled={first}
          onClick={() => onMove(id, -1)}
          aria-label={`Move ${label} up`}
          className="hover:bg-muted sr-only rounded p-1 focus-visible:not-sr-only"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={last}
          onClick={() => onMove(id, 1)}
          aria-label={`Move ${label} down`}
          className="hover:bg-muted sr-only rounded p-1 focus-visible:not-sr-only"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </KeyItem>
    </div>
  );
}

function KeyItem({
  id,
  note,
  handle,
  children,
  onRemove,
}: {
  id: ToolbarButtonId;
  note?: string;
  handle?: ReactNode;
  children?: ReactNode;
  onRemove: (id: ToolbarButtonId) => void;
}) {
  const def = getButtonDef(id);
  const label = def?.label ?? id;
  return (
    <div className="border-border flex min-h-[44px] items-center gap-2 border-b px-2 last:border-b-0">
      {handle ?? <span className="-ml-2 w-11 flex-shrink-0" />}
      <KeyChip id={id} />
      <span className="min-w-0 flex-1 truncate text-sm">
        {label}
        {note && (
          <span className="text-muted-foreground text-xs"> · {note}</span>
        )}
        {def?.conditional && (
          <span className="text-muted-foreground text-xs">
            {" "}
            (when available)
          </span>
        )}
      </span>
      {children}
      <button
        type="button"
        onClick={() => onRemove(id)}
        aria-label={`Remove ${label}`}
        // A 44px target round the small minus
        className="-mr-2 grid h-11 w-11 flex-shrink-0 place-items-center"
      >
        <span className="bg-destructive/15 text-destructive grid h-6 w-6 place-items-center rounded-full">
          <Minus className="h-3.5 w-3.5" />
        </span>
      </button>
    </div>
  );
}

// --- Fixed rows (row 1 and row 2 as set, whatever runs) ---

function FixedRowsEditor({
  prefs,
  onUpdate,
}: {
  prefs: ToolbarPreferences;
  onUpdate: (prefs: ToolbarPreferences) => void;
}) {
  // Changing a key by hand leaves the context rows for a custom row
  const apply = (next: ToolbarPreferences, preset = false) => {
    if (!preset) next = { ...next, mode: "custom" };
    onUpdate(next);
  };
  const copy = () => ({
    ...prefs,
    row1: [...prefs.row1],
    row2: [...prefs.row2],
    hidden: [...prefs.hidden],
  });

  const toggleLayout = () => {
    const next = copy();
    if (prefs.layout === "single") {
      next.layout = "double";
      // Move nav+shell buttons to row2 by default when switching to double
      if (next.row2.length === 0) {
        const moveToRow2 = new Set<ToolbarButtonId>([
          "arrow-left",
          "arrow-right",
          "arrow-up",
          "arrow-down",
          "char-tilde",
          "char-slash",
          "char-pipe",
          "char-gt",
          "char-at",
        ]);
        next.row2 = next.row1.filter((id) => moveToRow2.has(id));
        next.row1 = next.row1.filter((id) => !moveToRow2.has(id));
      }
    } else {
      next.layout = "single";
      // Merge row2 back into row1
      next.row1 = [...next.row1, ...next.row2];
      next.row2 = [];
    }
    apply(next);
  };

  // Presets set the fixed rows; the context rows, ^C and the open Duo's
  // layout stay as they are
  const applyPreset = (id: PresetId) => {
    const preset = PRESETS[id].get();
    apply(
      {
        ...preset,
        row1: [...preset.row1],
        row2: [...preset.row2],
        hidden: [...preset.hidden],
        contextRows: prefs.contextRows,
        pinCtrlC: prefs.pinCtrlC,
        duoLayout: prefs.duoLayout,
      },
      true
    );
  };

  const toggleButton = (id: ToolbarButtonId) => {
    const next = copy();
    if (next.hidden.includes(id)) {
      // Unhide: add to row1
      next.hidden = next.hidden.filter((h) => h !== id);
      next.row1.push(id);
    } else {
      // Hide: remove from whichever row it's in
      next.row1 = next.row1.filter((r) => r !== id);
      next.row2 = next.row2.filter((r) => r !== id);
      next.hidden.push(id);
    }
    apply(next);
  };

  const getButtonRow = (id: ToolbarButtonId): 1 | 2 | 0 => {
    if (prefs.row1.includes(id)) return 1;
    if (prefs.row2.includes(id)) return 2;
    return 0; // hidden
  };

  const toggleRow = (id: ToolbarButtonId) => {
    const next = copy();
    const currentRow = getButtonRow(id);
    if (currentRow === 1) {
      next.row1 = next.row1.filter((r) => r !== id);
      next.row2.push(id);
    } else if (currentRow === 2) {
      next.row2 = next.row2.filter((r) => r !== id);
      next.row1.push(id);
    }
    apply(next);
  };

  const moveUp = (id: ToolbarButtonId) => {
    const next = copy();
    const row1Idx = next.row1.indexOf(id);
    const row2Idx = next.row2.indexOf(id);

    if (row1Idx > 0) {
      [next.row1[row1Idx - 1], next.row1[row1Idx]] = [
        next.row1[row1Idx],
        next.row1[row1Idx - 1],
      ];
    } else if (
      row1Idx === 0 &&
      prefs.layout === "double" &&
      next.row2.length > 0
    ) {
      // Cross to end of row2
      next.row1 = next.row1.filter((r) => r !== id);
      next.row2.push(id);
    } else if (row2Idx > 0) {
      [next.row2[row2Idx - 1], next.row2[row2Idx]] = [
        next.row2[row2Idx],
        next.row2[row2Idx - 1],
      ];
    } else if (row2Idx === 0) {
      // Cross to end of row1
      next.row2 = next.row2.filter((r) => r !== id);
      next.row1.push(id);
    }
    apply(next);
  };

  const moveDown = (id: ToolbarButtonId) => {
    const next = copy();
    const row1Idx = next.row1.indexOf(id);
    const row2Idx = next.row2.indexOf(id);

    if (row1Idx >= 0 && row1Idx < next.row1.length - 1) {
      [next.row1[row1Idx], next.row1[row1Idx + 1]] = [
        next.row1[row1Idx + 1],
        next.row1[row1Idx],
      ];
    } else if (row1Idx === next.row1.length - 1 && prefs.layout === "double") {
      // Cross to start of row2
      next.row1 = next.row1.filter((r) => r !== id);
      next.row2.unshift(id);
    } else if (row2Idx >= 0 && row2Idx < next.row2.length - 1) {
      [next.row2[row2Idx], next.row2[row2Idx + 1]] = [
        next.row2[row2Idx + 1],
        next.row2[row2Idx],
      ];
    } else if (row2Idx === next.row2.length - 1) {
      // Cross to start of row1
      next.row2 = next.row2.filter((r) => r !== id);
      next.row1.unshift(id);
    }
    apply(next);
  };

  // Row1 buttons, then row2 buttons, then hidden — grouped by category
  const groupedButtons = (() => {
    const seen = new Set<ToolbarButtonId>();
    const groups: Record<string, ToolbarButtonId[]> = {};
    for (const id of [...prefs.row1, ...prefs.row2, ...prefs.hidden]) {
      const def = getButtonDef(id);
      if (!def || seen.has(id)) continue;
      seen.add(id);
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push(id);
    }
    return groups;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm">Two rows</span>
        <Switch
          checked={prefs.layout === "double"}
          onCheckedChange={toggleLayout}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESETS) as PresetId[])
          .filter((id) => id !== "context")
          .map((id) => (
            <button
              key={id}
              onClick={() => applyPreset(id)}
              title={PRESETS[id].description}
              className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium"
            >
              {PRESETS[id].label}
            </button>
          ))}
      </div>

      <div className="ring-border overflow-hidden rounded-xl ring-1">
        {Object.entries(groupedButtons).map(([group, ids]) => (
          <div key={group}>
            <div className="bg-muted/50 text-muted-foreground px-4 py-1.5 text-xs font-medium tracking-wider uppercase">
              {GROUP_LABELS[group as keyof typeof GROUP_LABELS] || group}
            </div>
            {ids.map((id) => {
              const def = getButtonDef(id);
              if (!def) return null;
              const isHidden = prefs.hidden.includes(id);
              const row = getButtonRow(id);

              return (
                <div
                  key={id}
                  className="border-border flex items-center gap-2 border-b px-4 py-2"
                >
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => toggleButton(id)}
                    aria-label={`Show ${def.label}`}
                    className="accent-primary h-4 w-4 rounded"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm">{def.label}</span>
                    {def.conditional && (
                      <span className="text-muted-foreground ml-1 text-xs">
                        (when available)
                      </span>
                    )}
                  </div>

                  {/* Row toggle — only in double layout for visible buttons */}
                  {prefs.layout === "double" && !isHidden && (
                    <button
                      onClick={() => toggleRow(id)}
                      className="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs font-medium"
                    >
                      R{row}
                    </button>
                  )}

                  {!isHidden && (
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => moveUp(id)}
                        aria-label={`Move ${def.label} up`}
                        className="hover:bg-muted rounded p-1"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => moveDown(id)}
                        aria-label={`Move ${def.label} down`}
                        className="hover:bg-muted rounded p-1"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Back to the default: one row that follows the context */}
      <button
        onClick={() => applyPreset("context")}
        className="text-muted-foreground flex w-full items-center justify-center gap-1.5 text-xs"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reset to Defaults
      </button>
    </div>
  );
}
