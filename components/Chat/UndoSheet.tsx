"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { Check, Circle, Loader2, MessageSquare, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { registerNavHandlers } from "@/lib/nav-actions";
import { mobileNavStore } from "@/stores/mobileNav";
import type { UseTurns } from "@/hooks/useTurns";
import type { TurnDetail, TurnFile, UndoResult } from "@/lib/turn-types";
import { shortNames } from "./rows";
import { Counts } from "./ToolCard";
import { SheetGrab } from "@/components/ui/sheet-grab";

/** A file to undo, ticked or not (N-Undo's rows) */
function FileRow({
  file,
  name,
  checked,
  disabled,
  onToggle,
}: {
  file: TurnFile;
  /** The file name, with folders when another file shares it */
  name: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      title={file.path}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 px-3.5 text-left text-[13px] disabled:opacity-60",
        !checked && "text-muted-foreground"
      )}
    >
      {checked ? (
        <Undo2 className="text-muted-foreground h-4 w-4 shrink-0" />
      ) : (
        <Circle className="text-muted-foreground/60 h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      <Counts added={file.added} removed={file.removed} />
    </button>
  );
}

function FileGroup({
  files,
  names,
  picked,
  disabled,
  onToggle,
}: {
  files: TurnFile[];
  names: ReadonlyMap<string, string>;
  picked: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (path: string) => void;
}) {
  return (
    <div className="group-card [&>*+*]:border-hair [&>*+*]:border-t">
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          name={names.get(file.path) ?? file.path}
          checked={picked.has(file.path)}
          disabled={disabled}
          onToggle={() => onToggle(file.path)}
        />
      ))}
    </div>
  );
}

/**
 * N-Undo: the confirmation for undoing a turn. The agent's own files are
 * ticked, what else changed during the turn is listed unticked; afterwards
 * it says which files were kept because they changed since
 */
export function UndoSheet({
  turnNo,
  turns,
  agentName,
  onClose,
}: {
  turnNo: number;
  turns: UseTurns;
  /** "Claude": who will be told */
  agentName: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<TurnDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UndoResult | null>(null);
  const { railWidth } = useSnapshot(mobileNavStore);

  const { detail: readDetail } = turns;
  useEffect(() => {
    let stale = false;
    readDetail(turnNo)
      .then((d) => {
        if (stale) return;
        setDetail(d);
        setPicked(new Set(d.files.map((f) => f.path)));
      })
      .catch((e) => !stale && setLoadError(String(e?.message ?? e)));
    return () => {
      stale = true;
    };
  }, [readDetail, turnNo]);

  const names = useMemo(
    () =>
      shortNames(
        detail
          ? [...detail.files, ...detail.alsoChanged].map((f) => f.path)
          : []
      ),
    [detail]
  );

  // The column's × closes it while it's open (closeSheet)
  const close = useCallback(() => {
    mobileNavStore.sheet = null;
    onClose();
  }, [onClose]);
  useEffect(() => {
    mobileNavStore.sheet = "undo";
    const unregister = registerNavHandlers({ closeSheet: close });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      unregister();
      window.removeEventListener("keydown", onKey);
      mobileNavStore.sheet = null;
    };
  }, [close]);

  const toggle = (path: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const undo = async () => {
    setUndoing(true);
    setError(null);
    try {
      const done = await turns.undo(turnNo, [...picked]);
      haptic("success");
      if (!done.kept.length) {
        toast(
          `Turn ${turnNo} undone: ${done.reverted.length} ${done.reverted.length === 1 ? "file" : "files"} back`
        );
        close();
      } else setResult(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUndoing(false);
    }
  };

  const undoable = !!detail?.undoable;
  const busy = undoing || !!result;

  return createPortal(
    <div className="fixed inset-0 z-50" style={{ right: railWidth }}>
      <div
        aria-hidden="true"
        onClick={close}
        className="absolute inset-0 bg-black/55"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Undo turn ${turnNo}`}
        className="sheet-surface absolute inset-x-0 bottom-0 mx-auto flex max-h-[85%] max-w-lg flex-col gap-3 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <SheetGrab onClose={close} />
        <div className="flex flex-col gap-1">
          <h2 className="t-title text-[20px]">Undo turn {turnNo}?</h2>
          <p className="text-muted-foreground text-sm">
            These files go back to how they were before turn {turnNo}.
          </p>
        </div>

        {!detail && !loadError && (
          <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the turn…
          </div>
        )}
        {loadError && <p className="text-sm text-[var(--del)]">{loadError}</p>}

        {detail && !undoable && (
          <p className="text-muted-foreground text-sm">
            Undo not available for this turn
          </p>
        )}

        {detail && detail.files.length > 0 && (
          <FileGroup
            files={detail.files}
            names={names}
            picked={picked}
            disabled={!undoable || busy}
            onToggle={toggle}
          />
        )}
        {detail && detail.alsoChanged.length > 0 && (
          <>
            <h3 className="t-sec !px-0.5 text-[13px]">
              Also changed during this turn
            </h3>
            <FileGroup
              files={detail.alsoChanged}
              names={names}
              picked={picked}
              disabled={!undoable || busy}
              onToggle={toggle}
            />
          </>
        )}

        {result ? (
          <div className="flex flex-col gap-2.5 px-0.5 text-sm">
            <p className="text-foreground/80 flex items-start gap-2.5">
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--add)]"
                strokeWidth={2.6}
              />
              {result.reverted.length}{" "}
              {result.reverted.length === 1 ? "file is" : "files are"} back to
              before turn {turnNo}
            </p>
            {result.kept.map((k) => (
              <p
                key={k.path}
                title={k.path}
                className="text-muted-foreground flex items-center gap-2.5"
              >
                <Circle className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate font-mono text-[13px]">
                  {names.get(k.path) ?? k.path}
                </span>
                <span className="shrink-0">changed since, kept</span>
              </p>
            ))}
          </div>
        ) : (
          <div className="text-foreground/80 flex flex-col gap-2.5 px-0.5 text-sm">
            <p className="flex items-start gap-2.5">
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--add)]"
                strokeWidth={2.6}
              />
              Your own uncommitted edits are kept
            </p>
            <p className="flex items-start gap-2.5">
              <MessageSquare className="text-meter mt-0.5 h-4 w-4 shrink-0" />
              {agentName} will be told the turn was undone
            </p>
          </div>
        )}
        <p className="text-muted-foreground px-0.5 text-[13px]">
          Each turn is saved as a hidden git snapshot, not a commit. Your branch
          history stays clean.
        </p>
        {error && <p className="text-sm text-[var(--del)]">{error}</p>}

        <div className="mt-0.5 flex gap-2.5">
          {result ? (
            <button
              type="button"
              onClick={close}
              className="pill pill-primary flex-1 active:opacity-80"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                className="pill pill-secondary flex-1 active:opacity-80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={undo}
                disabled={!undoable || !picked.size || undoing}
                className="pill pill-primary flex-1 active:opacity-80 disabled:opacity-50"
              >
                {undoing && <Loader2 className="h-4 w-4 animate-spin" />}
                Undo turn {turnNo}
              </button>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}
