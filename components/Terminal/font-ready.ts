"use client";

import type { Terminal as XTerm } from "@xterm/xterm";

/**
 * xterm measures its cells when it opens, and again only when the font
 * family or size changes. Opened before JetBrains Mono (next/font, in
 * app/layout.tsx) has loaded, it would keep the fallback's widths and
 * misplace every glyph. So the terminal waits for the font, at most
 * FONT_WAIT_MS, and if it gave up re-measures once every font is in.
 */
export const TERMINAL_FONT = '13px "JetBrains Mono"';
export const FONT_WAIT_MS = 1500;

/** True once the terminal font is ready, false if the wait timed out */
export function terminalFontReady(): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts) {
    return Promise.resolve(true);
  }
  if (document.fonts.check(TERMINAL_FONT)) return Promise.resolve(true);
  return Promise.race([
    document.fonts.load(TERMINAL_FONT).then(
      (faces) => faces.length > 0,
      () => false
    ),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), FONT_WAIT_MS)
    ),
  ]);
}

/**
 * After a timed-out wait: once document.fonts is ready, makes xterm measure
 * its cells again and calls `refit`. Returns a cancel for unmount.
 */
export function remeasureWhenFontsReady(
  term: XTerm,
  refit: () => void
): () => void {
  let live = true;
  document.fonts?.ready.then(() => {
    if (!live) return;
    // xterm measures only on a changed family: change it and put it back
    const family = term.options.fontFamily ?? "monospace";
    term.options.fontFamily = `${family}, monospace`;
    term.options.fontFamily = family;
    refit();
  });
  return () => {
    live = false;
  };
}
