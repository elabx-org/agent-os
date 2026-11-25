/**
 * What the wheel does in tmux's scroll-back (copy mode), for both key
 * tables: a row per wheel event, since the page sends one per row of finger
 * or wheel travel (components/Terminal/hooks/touch-scroll.ts, wheel.ts).
 *
 * A wheel down at the bottom leaves the scroll-back. tmux does that itself
 * only for a scroll-back the wheel began (`copy-mode -e`); one begun any
 * other way (its menu's Copy Mode, a drag, a jump to the last message)
 * stops at the bottom and stays on, where the terminal looks live but
 * shows nothing new and takes no typing.
 */
const DOWN =
  "if-shell -F '#{scroll_position}' 'send-keys -X scroll-down' 'send-keys -X cancel'";

/** The tmux commands (without `tmux`), in the order they are set */
export const WHEEL_BINDINGS: string[] = ["copy-mode", "copy-mode-vi"].flatMap(
  (table) => [
    `bind-key -T ${table} WheelUpPane send-keys -X scroll-up`,
    `bind-key -T ${table} WheelDownPane ${DOWN}`,
  ]
);
