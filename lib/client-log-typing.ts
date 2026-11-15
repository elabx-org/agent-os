/**
 * How typing went inside the iOS app, for the client log: how long each key
 * waited for the page, how long the page took to show it, and what else was
 * going on (frames dropped, resizes, events from the app). Timings and counts
 * only; never what was typed.
 */

import { NATIVE_EVENT } from "@/lib/native-bridge";

const REPORT_MS = 5000;
const IDLE_MS = 3000;
/** A frame this late is one the person can see */
const JANK_MS = 50;

function stats(values: number[]): string {
  if (!values.length) return "-";
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return `med ${Math.round(mid)} max ${Math.round(sorted[sorted.length - 1])}`;
}

export function startTypingLog(add: (what: string) => void): () => void {
  let waits: number[] = [];
  let shows: number[] = [];
  let resizes = 0;
  let viewports = 0;
  let natives = 0;
  let janks = 0;
  let worstGap = 0;
  let typing = false;
  let lastKey = 0;
  let lastFrame = 0;
  let frame = 0;
  let since = 0;

  const report = () => {
    if (!waits.length) return;
    const fold = document.documentElement.dataset.fold ?? "none";
    add(
      `typing ${waits.length} keys in ${((performance.now() - since) / 1000).toFixed(1)}s:` +
        ` waited ${stats(waits)} ms, shown ${stats(shows)} ms,` +
        ` late frames ${janks} (worst ${Math.round(worstGap)} ms),` +
        ` resize ${resizes}, viewport ${viewports}, native ${natives}, fold ${fold}`
    );
    waits = [];
    shows = [];
    resizes = viewports = natives = janks = 0;
    worstGap = 0;
    since = performance.now();
  };

  // Frames while typing: a gap is the page (or the app under it) held up
  const tick = (now: number) => {
    if (lastFrame) {
      const gap = now - lastFrame;
      if (gap > worstGap) worstGap = gap;
      if (gap > JANK_MS) janks++;
    }
    lastFrame = now;
    if (now - lastKey > IDLE_MS) {
      typing = false;
      lastFrame = 0;
      report();
      return;
    }
    if (now - since > REPORT_MS) report();
    frame = requestAnimationFrame(tick);
  };

  const onInput = (e: Event) => {
    const el = e.target;
    if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement))
      return;
    const now = performance.now();
    // From the key reaching the page to the page handling it
    waits.push(Math.max(0, now - e.timeStamp));
    requestAnimationFrame(() => shows.push(performance.now() - now));
    lastKey = now;
    if (!typing) {
      typing = true;
      since = now;
      frame = requestAnimationFrame(tick);
    }
  };
  const onResize = () => {
    if (typing) resizes++;
  };
  const onViewport = () => {
    if (typing) viewports++;
  };
  const onNative = () => {
    if (typing) natives++;
  };

  document.addEventListener("input", onInput, true);
  window.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("resize", onViewport);
  window.addEventListener(NATIVE_EVENT, onNative);

  return () => {
    cancelAnimationFrame(frame);
    report();
    document.removeEventListener("input", onInput, true);
    window.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("resize", onViewport);
    window.removeEventListener(NATIVE_EVENT, onNative);
  };
}
