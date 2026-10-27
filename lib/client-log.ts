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
  // Which control: a button's own caption, never input text
  const control = el.closest("button, [role]");
  if (control && !label) {
    const role = control.getAttribute("role");
    if (role) bits.push(`role=${role}`);
    const caption = control.textContent?.trim().slice(0, 20);
    if (caption) bits.push(`"${caption}"`);
  }
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

  const onTouch = (e: TouchEvent) => {
    const t = e.touches[0];
    add(
      `touchstart ${describe(e.target)} at ${Math.round(t?.clientX ?? -1)},${Math.round(t?.clientY ?? -1)}`
    );
  };
  // A tap that ends without a click is the bug this exists to catch
  const onTouchEnd = (e: TouchEvent) =>
    add(
      `touchend ${describe(e.target)}${e.defaultPrevented ? " prevented" : ""}`
    );
  const onTouchCancel = (e: TouchEvent) =>
    add(`touchcancel ${describe(e.target)}`);
  const onClick = (e: MouseEvent) =>
    add(`click${e.isTrusted ? "" : " (synthetic)"} ${describe(e.target)}`);
  const onFocusIn = (e: FocusEvent) => add(`focusin ${describe(e.target)}`);
  const onFocusOut = (e: FocusEvent) => add(`focusout ${describe(e.target)}`);
  const onNative = (e: Event) => {
    const detail = (e as CustomEvent).detail ?? {};
    if (detail.type !== "key") add(`native ${JSON.stringify(detail)}`);
    // What the keyboard left the page, once it has settled: a gap above
    // the keyboard shows as a viewport shorter than the page's own rows
    if (detail.type === "keyboard")
      setTimeout(
        () =>
          add(`viewport ${Math.round(window.visualViewport?.height ?? -1)}`),
        700
      );
  };
  const onError = (e: ErrorEvent) => add(`error ${e.message}`);

  add(`start app ${window.agentosNative?.version ?? "web"}`);
  document.addEventListener("touchstart", onTouch, true);
  document.addEventListener("touchend", onTouchEnd);
  document.addEventListener("touchcancel", onTouchCancel, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.addEventListener(NATIVE_EVENT, onNative);
  window.addEventListener("error", onError);
  const timer = setInterval(flush, FLUSH_MS);

  return () => {
    flush();
    clearInterval(timer);
    document.removeEventListener("touchstart", onTouch, true);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", onTouchCancel, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    window.removeEventListener(NATIVE_EVENT, onNative);
    window.removeEventListener("error", onError);
  };
}
