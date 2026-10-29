/**
 * Someone is typing into a field other than `own` (a composer, a search box).
 * A terminal that connects in the background mustn't take the focus then: on
 * iOS that drops the keyboard the tap just raised.
 */
export function typingElsewhere(own?: Element | null): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  if (own?.contains(active)) return false;
  return (
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLInputElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}
