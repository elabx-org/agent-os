import type { SendChoice, SendMenuItem } from "@/lib/bg-send";

/**
 * The send menu's rows for this moment: "Send and start a new session"
 * only when it can run (the session is known, nothing being edited, no
 * video waiting on its frames)
 */
export function offeredSendItems(
  items: SendMenuItem[],
  startNew: boolean
): SendMenuItem[] {
  return startNew ? items : items.filter((i) => i.choice !== "sendAndNew");
}

/** Hold on Send opens the menu: something typed and not editing a queued one */
export function sendMenuAvailable(opts: {
  editing: boolean;
  empty: boolean;
}): boolean {
  return !opts.editing && !opts.empty;
}

/** The row lit when the menu opens: `highlighted`, else the first */
export function initialSendIndex(
  items: SendMenuItem[],
  highlighted?: SendChoice
): number {
  const at = highlighted
    ? items.findIndex((i) => i.choice === highlighted)
    : -1;
  return at < 0 ? 0 : at;
}

/** Arrows wrap, Home and End jump; any other key → null */
export function stepSendIndex(
  at: number,
  key: string,
  count: number
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return (at + 1) % count;
    case "ArrowUp":
      return (at - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
