import { useEffect, useRef, type RefObject } from "react";
import { haptic } from "@/lib/haptics";
import { gestures } from "@/lib/gestures";

const HOLD_MS = 350;
const MOVE_PX = 8;

/**
 * Press and hold on touch: the phone ticks when the hold registers, and
 * `onPress` runs on release (so the sheet it opens doesn't catch the lifting
 * finger). The click that follows is swallowed. A move cancels it, so
 * scrolls and swipes still work.
 */
export function useLongPress(
  ref: RefObject<HTMLElement | null>,
  onPress: (() => void) | undefined
) {
  const press = useRef(onPress);
  press.current = onPress;
  const enabled = !!onPress;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    let held = false;
    let heldAt = 0;

    const cancel = () => {
      clearTimeout(timer);
      start = null;
      if (held) el.removeAttribute("data-held");
      held = false;
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return cancel();
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      timer = setTimeout(() => {
        if (gestures.dragging || gestures.swiping) return;
        held = true;
        el.setAttribute("data-held", "");
        haptic("medium");
      }, HOLD_MS);
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_PX)
        cancel();
    };
    const onEnd = (e: TouchEvent) => {
      const wasHeld = held && !gestures.dragging && !gestures.swiping;
      cancel();
      if (!wasHeld) return;
      e.preventDefault();
      heldAt = Date.now();
      press.current?.();
    };
    const onClick = (e: MouseEvent) => {
      if (Date.now() - heldAt < 500) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // iOS's own long-press callout and Radix's touch context menu stay out
    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", cancel);
    el.addEventListener("click", onClick, true);
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      cancel();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", cancel);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, [ref, enabled]);
}
