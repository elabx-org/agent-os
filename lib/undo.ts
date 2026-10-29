import { toast } from "sonner";
import { proxy } from "valtio";
import { haptic } from "@/lib/haptics";
import { pendingRemoval, type RemovalKind } from "@/stores/pendingRemoval";

const UNDO_MS = 5000;
/** A settle that already happened: a little longer, it wasn't your tap */
const SETTLED_UNDO_MS = 8000;
const waiting = new Set<() => void>();

/**
 * Deletes with a few seconds to undo instead of asking first: the item
 * leaves the list at once, and `commit` runs when the toast times out.
 * Leaving the page commits straight away, as the timer would have.
 */
export function removeWithUndo({
  kind,
  id,
  message,
  commit,
}: {
  kind: RemovalKind;
  id: string;
  message: string;
  commit: () => Promise<unknown>;
}) {
  pendingRemoval[kind][id] = true;
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    waiting.delete(finish);
    // Once deleted it stays hidden (ids aren't reused); on failure it returns
    commit().catch(() => {
      delete pendingRemoval[kind][id];
      toast.error(message.replace(/^Deleted/, "Couldn't delete"));
    });
  };
  const timer = setTimeout(finish, UNDO_MS);
  waiting.add(finish);

  toast(message, {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiting.delete(finish);
        delete pendingRemoval[kind][id];
        haptic("light");
      },
    },
  });
}

/** A glass toast with Undo (N-Settle), drawn by the Now page's SettleToasts */
export interface UndoToast {
  key: string;
  /** "Deck state line fix settled" */
  title: string;
  /** "PR #106 merged" */
  caption?: string;
  onUndo: () => void;
}

/** The undo toasts showing, oldest first */
export const undoToasts = proxy<{ list: UndoToast[] }>({ list: [] });

let toastSeq = 0;

function showUndoToast(
  toastProps: Omit<UndoToast, "key" | "onUndo">,
  ms: number,
  onUndo: () => void
): () => void {
  const key = `undo-${++toastSeq}`;
  const dismiss = () => {
    clearTimeout(timer);
    const i = undoToasts.list.findIndex((t) => t.key === key);
    if (i >= 0) undoToasts.list.splice(i, 1);
  };
  const timer = setTimeout(dismiss, ms);
  undoToasts.list.push({
    ...toastProps,
    key,
    onUndo: () => {
      dismiss();
      haptic("light");
      onUndo();
    },
  });
  return dismiss;
}

/**
 * Settles with a few seconds to undo: the row moves to Settled at once and
 * `commit` (the POST, which ends tmux) runs only when the window passes, so
 * an Undo never kills anything. Leaving the page commits straight away.
 * The row stays shown settled until `commit` resolves (it refetches), and
 * returns to Working if it fails.
 */
export function settleWithUndo({
  id,
  title,
  caption,
  commit,
}: {
  id: string;
  title: string;
  caption?: string;
  commit: () => Promise<unknown>;
}) {
  pendingRemoval.settles[id] = Date.now();
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    waiting.delete(finish);
    commit()
      .catch((e: unknown) => {
        // A declined "Settle anyway?" says nothing more
        if (e instanceof SettleCancelled) return;
        toast.error(`Couldn't settle “${title}”`, {
          description: e instanceof Error ? e.message : undefined,
        });
      })
      .finally(() => delete pendingRemoval.settles[id]);
  };
  const timer = setTimeout(finish, UNDO_MS);
  waiting.add(finish);

  showUndoToast({ title: `${title} settled`, caption }, UNDO_MS, () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    waiting.delete(finish);
    delete pendingRemoval.settles[id];
  });
}

/**
 * The toast for a settle that already happened (auto-settle): Undo runs
 * `undo` (DELETE, which relaunches it) and says so if that fails
 */
export function showSettledToast({
  title,
  caption,
  undo,
}: {
  title: string;
  caption?: string;
  undo: () => Promise<unknown>;
}) {
  showUndoToast({ title: `${title} settled`, caption }, SETTLED_UNDO_MS, () => {
    undo().catch((e: unknown) =>
      toast.error(`Couldn't undo settling “${title}”`, {
        description: e instanceof Error ? e.message : undefined,
      })
    );
  });
}

/** Thrown when "It is still working. Settle anyway?" was declined */
export class SettleCancelled extends Error {
  constructor() {
    super("Not settled");
    this.name = "SettleCancelled";
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => waiting.forEach((f) => f()));
}
