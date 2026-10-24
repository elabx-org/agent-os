"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardInset } from "@/hooks/useKeyboardInset";

const STORAGE_KEY = "keyboardDebug";

/**
 * Enabled with ?kbdebug=1 (remembered), disabled with ?kbdebug=0.
 * Used to capture how iPhone Duo / iPad split and floating keyboards affect
 * the viewport, which Safari doesn't document.
 */
export function useKeyboardDebug() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      const param = new URLSearchParams(window.location.search).get("kbdebug");
      if (param === "1") localStorage.setItem(STORAGE_KEY, "1");
      if (param === "0") localStorage.removeItem(STORAGE_KEY);
      setEnabled(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setEnabled(false);
    }
  }, []);

  return enabled;
}

interface Snapshot {
  t: string;
  event: string;
  inner: string;
  vv: string;
  offset: string;
  safe: string;
  focus: string;
}

const readSafeArea = (probe: HTMLDivElement | null) => {
  if (!probe) return "?";
  const cs = getComputedStyle(probe);
  return [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
    .map((v) => parseInt(v, 10))
    .join("/");
};

export function KeyboardDebugOverlay({
  keyboard,
  isMobile,
  isTouch,
}: {
  keyboard: KeyboardInset;
  isMobile: boolean;
  isTouch: boolean;
}) {
  const probeRef = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<Snapshot[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    const snap = (event: string) => {
      const el = document.activeElement;
      setLog((prev) =>
        [
          {
            t: new Date().toISOString().slice(11, 23),
            event,
            inner: `${window.innerWidth}x${window.innerHeight}`,
            vv: vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}` : "n/a",
            offset: vv
              ? `${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}`
              : "n/a",
            safe: readSafeArea(probeRef.current),
            focus: el ? el.tagName.toLowerCase() : "none",
          },
          ...prev,
        ].slice(0, 20)
      );
    };

    const handlers: [EventTarget, string][] = [
      [window, "resize"],
      [document, "focusin"],
      [document, "focusout"],
    ];
    if (vv) handlers.push([vv, "resize"], [vv, "scroll"]);
    if ("orientation" in screen) handlers.push([screen.orientation, "change"]);

    const bound = handlers.map(([target, type]) => {
      const fn = () => snap(type);
      target.addEventListener(type, fn);
      return () => target.removeEventListener(type, fn);
    });
    snap("init");
    return () => bound.forEach((off) => off());
  }, []);

  const copyLog = async () => {
    const text = [
      `ua: ${navigator.userAgent}`,
      `screen: ${screen.width}x${screen.height} dpr ${window.devicePixelRatio}`,
      `isMobile ${isMobile} isTouch ${isTouch} kb ${keyboard.height}px ${keyboard.mode}`,
      ...log.map(
        (s) =>
          `${s.t} ${s.event} inner ${s.inner} vv ${s.vv} off ${s.offset} safe ${s.safe} focus ${s.focus}`
      ),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      // Clipboard unavailable
    }
  };

  const latest = log[0];

  return (
    <>
      <div
        ref={probeRef}
        aria-hidden
        className="pointer-events-none invisible fixed"
        style={{
          padding:
            "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
        }}
      />
      <div className="fixed top-[calc(env(safe-area-inset-top)+30vh)] left-[calc(env(safe-area-inset-left)+0.5rem)] z-50 max-h-[40vh] w-72 overflow-y-auto rounded-md bg-black/80 p-2 font-mono text-[10px] leading-tight text-green-300">
        <div className="mb-1 flex items-center justify-between">
          <span>
            kb {keyboard.height}px {keyboard.mode} · mobile {String(isMobile)} ·
            touch {String(isTouch)}
          </span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={copyLog}
            className="rounded bg-green-900 px-1.5 py-0.5 text-green-100"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
        {latest && (
          <div className="mb-1 text-green-100">
            inner {latest.inner} · vv {latest.vv} · off {latest.offset}
            <br />
            safe t/r/b/l {latest.safe} · focus {latest.focus}
          </div>
        )}
        {log.slice(1).map((s, i) => (
          <div key={i} className="opacity-70">
            {s.t} {s.event} vv {s.vv} off {s.offset} {s.focus}
          </div>
        ))}
      </div>
    </>
  );
}
