import { toast } from "sonner";
import { haptic } from "@/lib/haptics";
import { pendingRemoval, type RemovalKind } from "@/stores/pendingRemoval";

const UNDO_MS = 5000;
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

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => waiting.forEach((f) => f()));
}
