import type { KeyboardEvent } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tab and Shift+Tab wrap inside `layer`, so a modal page (aria-modal)
 * never hands focus to the app hidden under it
 */
export function trapTab(e: KeyboardEvent, layer: HTMLElement | null): void {
  if (e.key !== "Tab" || !layer) return;
  const items = [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !layer.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !layer.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
