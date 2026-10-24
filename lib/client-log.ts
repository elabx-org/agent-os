/**
 * What the page saw inside the iOS app (taps, focus, keyboard, errors), sent
 * to /api/client-log in batches so app-only bugs can be read on the server.
 * Element descriptions only; never what was typed.
 */

import { NATIVE_EVENT } from "@/lib/native-bridge";

const FLUSH_MS = 2000;

function describe(target: EventTarget | null): string {
  if (!(target instanceof Element)) return String(target);
  const el = target as HTMLElement;
  const bits = [el.tagName.toLowerCase()];
  const placeholder = el.getAttribute("placeholder");
  if (placeholder) bits.push(`"${placeholder}"`);
  const inputmode = el.getAttribute("inputmode");
  if (inputmode) bits.push(`inputmode=${inputmode}`);
  if (el.closest(".xterm")) bits.push("in-xterm");
  const label = el.closest("[aria-label]")?.getAttribute("aria-label");
  if (label) bits.push(`[${label}]`);
  return bits.join(" ");
}

export function startClientLog(): () => void {
  let queue: string[] = [];
  const add = (what: string) => {
    queue.push(
      `${new Date().toISOString()} ${window.innerWidth}x${window.innerHeight} ${what} | active: ${describe(document.activeElement)}`
    );
  };
  const flush = () => {
    if (!queue.length) return;
    const lines = queue;
    queue = [];
    fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
      keepalive: true,
    }).catch(() => {});
  };

  const onTouch = (e: TouchEvent) => add(`touchstart ${describe(e.target)}`);
  const onFocusIn = (e: FocusEvent) => add(`focusin ${describe(e.target)}`);
  const onFocusOut = (e: FocusEvent) => add(`focusout ${describe(e.target)}`);
  const onNative = (e: Event) => {
    const detail = (e as CustomEvent).detail ?? {};
    if (detail.type !== "key") add(`native ${JSON.stringify(detail)}`);
  };
  const onError = (e: ErrorEvent) => add(`error ${e.message}`);

  add("start");
  document.addEventListener("touchstart", onTouch, true);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.addEventListener(NATIVE_EVENT, onNative);
  window.addEventListener("error", onError);
  const timer = setInterval(flush, FLUSH_MS);

  return () => {
    flush();
    clearInterval(timer);
    document.removeEventListener("touchstart", onTouch, true);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    window.removeEventListener(NATIVE_EVENT, onNative);
    window.removeEventListener("error", onError);
  };
}
