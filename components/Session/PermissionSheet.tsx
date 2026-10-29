"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { Clock, Info, Loader2 } from "lucide-react";
import { confirmAction } from "@/components/ui/confirm";
import { usePermissionMode } from "@/hooks/usePermissionMode";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import { haptic } from "@/lib/haptics";
import { isNative, nativeCaps } from "@/lib/native-bridge";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { registerNavHandlers } from "@/lib/nav-actions";
import {
  MODE_HINTS,
  MODE_LABELS,
  MODES,
  type Mode,
} from "@/lib/permission-mode";
import {
  fullAccessConfirm,
  initialChoice,
  modeToast,
  needsPost,
  RESTART_BUSY,
  sheetNote,
  waitingText,
} from "@/lib/permission-sheet";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/db";
import {
  closePermissionSheet,
  permissionSheetStore,
} from "@/stores/permissionSheet";
import { mobileNavStore } from "@/stores/mobileNav";
import { SheetGrab } from "@/components/ui/sheet-grab";

export interface PermissionSheetProps {
  session: Session;
  /** The column's ×, Escape, the dim or after Done */
  onClose: () => void;
}

/** Restarts Claude with its stored mode, never mid-turn (the toast's Restart now) */
async function restartWhenIdle(session: Session): Promise<void> {
  try {
    const res = await fetchAsUser(`/api/sessions/${session.id}/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whenIdle: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(
        res.status === 409 && data?.busy ? RESTART_BUSY : refusalText(data)
      );
      return;
    }
    window.dispatchEvent(
      new CustomEvent("agentos-session-restarted", {
        detail: { session: data.session },
      })
    );
  } catch {
    toast.error("Restart failed");
  }
}

/** One mode: 22px radio, label and hint (Full access's in red) */
function ModeRow({
  mode,
  selected,
  waiting,
  disabled,
  onPick,
  onKeyDown,
}: {
  mode: Mode;
  selected: boolean;
  /** This choice waits: for the turn in progress to end, or a restart */
  waiting: string | null;
  disabled: boolean;
  onPick: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      // Roving: the group is one Tab stop, the arrows move in it
      tabIndex={selected ? 0 : -1}
      data-mode={mode}
      disabled={disabled}
      onClick={onPick}
      onKeyDown={onKeyDown}
      className={cn(
        "row min-h-[60px] w-full touch-manipulation !items-start text-left disabled:opacity-60",
        selected && "sel"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-primary dark:border-meter" : "border-foreground/25"
        )}
      >
        {selected && (
          <span className="bg-primary dark:bg-meter h-2.5 w-2.5 rounded-full" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-medium">{MODE_LABELS[mode]}</span>
        <span
          className={cn(
            "text-[13px]",
            mode === "bypassPermissions"
              ? "text-[var(--del)]"
              : "text-muted-foreground"
          )}
        >
          {MODE_HINTS[mode]}
        </span>
        {waiting && (
          <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
            <Clock className="h-3 w-3 shrink-0" />
            {waiting}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * N-PermMode: "Permissions" and the session's title, four radio rows
 * (MODES with MODE_LABELS / MODE_HINTS, Full access's hint in red), the
 * note "Applies from the next turn. Codex and Gemini use their closest
 * matching setting." Picking a row only selects it; Done (the column's ✓,
 * mobileNavStore.sheet = "permissions" + registerNavHandlers confirmSheet,
 * or the sheet's own button where there's no column) POSTs it through
 * usePermissionMode, Full access after an in-page confirm.
 */
export function PermissionSheet({ session, onClose }: PermissionSheetProps) {
  const { state, setMode, setting, error } = usePermissionMode(session.id);
  const { railWidth } = useSnapshot(mobileNavStore);
  const layoutMode = useLayoutMode();
  // The column carries × and ✓: the web column, or the app's on the closed
  // Duo (its sheet column, lib/column-spec); app builds without the column,
  // phones, tabletop, the open Duo and the desktop get the sheet's own
  const columnCarries =
    railWidth > 0 ||
    (isNative() && nativeCaps().column === true && layoutMode === "duo-closed");
  const sheetRef = useRef<HTMLElement>(null);
  const [picked, setPicked] = useState<Mode | null>(null);
  const [confirming, setConfirming] = useState(false);
  const opened = initialChoice(state);
  const choice = picked ?? opened;
  const busy = setting || confirming;

  const close = useCallback(() => {
    mobileNavStore.sheet = null;
    onClose();
  }, [onClose]);

  const done = useCallback(async () => {
    if (busy) return;
    if (!needsPost(choice, state)) return close();
    if (choice === "bypassPermissions") {
      setConfirming(true);
      // The confirm's destructive button gives the warning haptic
      const ok = await confirmAction(fullAccessConfirm(session.name));
      setConfirming(false);
      if (!ok) return;
    }
    try {
      const result = await setMode({ mode: choice });
      if (result.mode !== "bypassPermissions") haptic("success");
      const said = modeToast(result, session.agent_type);
      toast(said.text, {
        action: said.restart
          ? { label: "Restart now", onClick: () => restartWhenIdle(session) }
          : undefined,
      });
      close();
    } catch {
      // error says why; the sheet stays open
    }
  }, [busy, choice, state, close, session, setMode]);

  // The closed Duo's column: × closes, ✓ is Done (latest choice via the ref)
  const doneRef = useRef(done);
  doneRef.current = done;
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;
  useEffect(() => {
    mobileNavStore.sheet = "permissions";
    const unregister = registerNavHandlers({
      closeSheet: close,
      confirmSheet: () => void doneRef.current(),
    });
    // Escape in the full-access confirm is the confirm's own. Caught before
    // it reaches the composer's box (opened from its pill, the box keeps
    // focus), where Escape would interrupt Claude
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirmingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      unregister();
      window.removeEventListener("keydown", onKey, true);
      mobileNavStore.sheet = null;
    };
  }, [close]);

  const waiting = choice === state?.pending ? waitingText(state) : null;

  // Focus into the dialog once the rows are up, on the selected one, unless
  // a text box has it (opened from the composer: the keyboard stays up)
  const loaded = !!state;
  useEffect(() => {
    if (!loaded) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    )
      return;
    sheetRef.current
      ?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
      ?.focus({ preventScroll: true });
  }, [loaded]);

  // The radiogroup's arrows: move and select, as the pattern expects
  const onRowKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step || busy) return;
    e.preventDefault();
    const at = MODES.indexOf((e.currentTarget.dataset.mode as Mode) ?? "");
    const next = MODES[(at + step + MODES.length) % MODES.length];
    setPicked(next);
    sheetRef.current
      ?.querySelector<HTMLElement>(`[data-mode="${next}"]`)
      ?.focus();
  };

  // Tab stays in the dialog
  const onSheetKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab" || !sheetRef.current) return;
    const stops = Array.from(
      sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"])'
      )
    );
    if (!stops.length) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const inside = sheetRef.current.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50" style={{ right: railWidth }}>
      <div
        aria-hidden="true"
        onClick={() => !busy && close()}
        className="absolute inset-0 bg-black/55"
      />
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Permissions"
        tabIndex={-1}
        onKeyDown={onSheetKey}
        className={cn(
          "sheet-surface absolute inset-x-0 bottom-0 mx-auto flex max-h-[85%] max-w-lg flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
          // The open Duo: the right page, clear of the fold
          "[html[data-hinge]_&]:left-[calc(var(--hinge-x)+var(--fold-clear))] [html[data-hinge]_&]:mx-0 [html[data-hinge]_&]:max-w-none",
          "[html[data-fold=vertical]_&]:left-[var(--fold-end)] [html[data-fold=vertical]_&]:mx-0 [html[data-fold=vertical]_&]:max-w-none",
          // Tabletop: on the base, under the fold
          "[html[data-fold=horizontal]_&]:max-h-[calc(100%-var(--fold-end))]"
        )}
      >
        <SheetGrab onClose={() => !busy && close()} />
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <h2 className="t-title shrink-0 text-[20px]">Permissions</h2>
          <span
            className="text-muted-foreground min-w-0 truncate text-[13px]"
            title={session.name}
          >
            {session.name}
          </span>
        </div>

        {!state ? (
          <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the mode…
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label="Permission mode"
            className="group-card"
          >
            {MODES.map((mode) => (
              <ModeRow
                key={mode}
                mode={mode}
                selected={mode === choice}
                waiting={mode === choice ? waiting : null}
                disabled={busy}
                onPick={() => setPicked(mode)}
                onKeyDown={onRowKey}
              />
            ))}
          </div>
        )}

        <p className="text-muted-foreground flex items-start gap-2 px-1 text-[13px]">
          <Info className="mt-px h-4 w-4 shrink-0" />
          <span>{sheetNote(state)}</span>
        </p>
        {error && <p className="px-1 text-sm text-[var(--del)]">{error}</p>}

        {/* No column to carry × and ✓ (desktop, phones, tabletop, the open Duo) */}
        {!columnCarries && (
          <div className="mt-0.5 flex gap-2.5">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="pill pill-secondary flex-1 active:opacity-80 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void done()}
              disabled={busy || !state}
              className="pill pill-primary flex-1 active:opacity-80 disabled:opacity-50"
            >
              {setting && <Loader2 className="h-4 w-4 animate-spin" />}
              Done
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}

/** Draws the sheet over the pane showing `session` while it's the one open */
export function PermissionSheetHost({ session }: { session: Session }) {
  const { sessionId } = useSnapshot(permissionSheetStore);
  if (sessionId !== session.id) return null;
  return <PermissionSheet session={session} onClose={closePermissionSheet} />;
}
