import type * as React from "react";

// On iOS a tap on a menu item's label can end without a click, so the item
// never selects. Touch selects on pointerup instead, and the native click
// that may still follow is dropped so the action doesn't run twice.
const FOLLOWING_CLICK_MS = 700;

type Handlers = {
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onClickCapture?: React.MouseEventHandler<HTMLDivElement>;
};

export function withTouchSelect<P extends Handlers>(props: P): P {
  return {
    ...props,
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      props.onPointerUp?.(e);
      if (e.pointerType !== "touch" || e.defaultPrevented) return;
      const el = e.currentTarget;
      el.dataset.touchSelected = String(Date.now());
      el.click();
    },
    onClickCapture: (e: React.MouseEvent<HTMLDivElement>) => {
      const at = Number(e.currentTarget.dataset.touchSelected);
      if (e.isTrusted && at && Date.now() - at < FOLLOWING_CLICK_MS) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      props.onClickCapture?.(e);
    },
  };
}
