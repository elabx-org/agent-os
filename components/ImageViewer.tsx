"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageSrc, isImageUrl } from "@/components/Composer/ImagePill";
import { formatSize } from "@/components/Composer/text";

interface ImageViewerProps {
  /** The image's absolute path on the server */
  path: string;
  /** Bytes, when known */
  size?: number;
  /** Take the picture out of the message */
  onRemove?: () => void;
  /** Put the picture in the message (one already sent, shown again) */
  onAdd?: () => void;
  onClose: () => void;
}

const MAX_SCALE = 6;
const TAP_ZOOM = 2.5;

interface View {
  scale: number;
  x: number;
  y: number;
}
const FIT: View = { scale: 1, x: 0, y: 0 };

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(1, s));

/** "IMG_7654.jpeg" from ".../1730000000000-IMG_7654.jpeg" */
const fileName = (path: string) =>
  isImageUrl(path)
    ? "Pasted image"
    : path.slice(path.lastIndexOf("/") + 1).replace(/^\d{10,}-/, "");

const BUTTON =
  "min-h-11 flex-1 rounded-xl bg-white/10 px-4 text-sm font-medium active:bg-white/20 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white/60";

/**
 * An attached image, full screen on black: fitted, pinch or double-tap (or
 * wheel) to zoom, drag to look around. On the open Duo it takes the right
 * page and leaves the conversation and composer on the left.
 */
export function ImageViewer({
  path,
  size,
  onRemove,
  onAdd,
  onClose,
}: ImageViewerProps) {
  const [view, setView] = useState<View>(FIT);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [touched, setTouched] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    setView(FIT);
    setDims(null);
    setFailed(false);
  }, [path]);

  // Esc closes the viewer, and isn't an Esc for Claude
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => doneRef.current?.focus({ preventScroll: true }), []);

  /** A point on screen, from the stage's centre (where scaling starts) */
  const local = useCallback((clientX: number, clientY: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: clientX - r.left - r.width / 2,
      y: clientY - r.top - r.height / 2,
    };
  }, []);

  /** Zoom to a scale keeping the picture's point under `at` where it is */
  const zoomAt = useCallback(
    (from: View, scale: number, at: { x: number; y: number }): View => {
      const s = clampScale(scale);
      if (s === 1) return FIT;
      const k = s / from.scale;
      return {
        scale: s,
        x: at.x - (at.x - from.x) * k,
        y: at.y - (at.y - from.y) * k,
      };
    },
    []
  );

  // Pinch, pan and double tap, from pointer events (touch, pen or mouse)
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    view: View;
    a: { x: number; y: number };
    dist: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const a =
      pts.length > 1
        ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
        : pts[0];
    const dist =
      pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = {
      view: viewRef.current,
      a,
      dist,
      moved: gesture.current?.moved ?? false,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setTouched(true);
    if (pointers.current.size === 0) gesture.current = null;
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    startGesture();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length > 1 && g.dist > 0) {
      const mid = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const s = clampScale((g.view.scale * dist) / g.dist);
      // The picture's point under the fingers' start stays under them
      const k = s / g.view.scale;
      setView({
        scale: s,
        x: mid.x - (g.a.x - g.view.x) * k,
        y: mid.y - (g.a.y - g.view.y) * k,
      });
      g.moved = true;
      return;
    }
    const p = pts[0];
    if (Math.hypot(p.x - g.a.x, p.y - g.a.y) > 8) g.moved = true;
    if (g.view.scale > 1)
      setView({
        ...g.view,
        x: g.view.x + p.x - g.a.x,
        y: g.view.y + p.y - g.a.y,
      });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // One finger of a pinch lifted: carry on as a pan from here
      startGesture();
      return;
    }
    if (viewRef.current.scale <= 1) setView(FIT);
    if (!g || g.moved || e.type === "pointercancel") return;
    const at = local(e.clientX, e.clientY);
    const prev = lastTap.current;
    if (
      prev &&
      e.timeStamp - prev.t < 300 &&
      Math.hypot(at.x - prev.x, at.y - prev.y) < 30
    ) {
      lastTap.current = null;
      setView((v) => (v.scale > 1 ? FIT : zoomAt(v, TAP_ZOOM, at)));
    } else lastTap.current = { t: e.timeStamp, x: at.x, y: at.y };
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const at = local(e.clientX, e.clientY);
    // A trackpad pinch arrives as a wheel with ctrl held
    const step = Math.exp((-e.deltaY * (e.ctrlKey ? 10 : 1)) / 400);
    setView((v) => zoomAt(v, v.scale * step, at));
  };

  const name = fileName(path);
  const detail = [
    size !== undefined ? formatSize(size) : null,
    dims ? `${dims.w}×${dims.h}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className={cn(
        "fixed inset-y-0 left-0 z-[60] flex flex-col bg-black text-white",
        "right-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]",
        // The open Duo: the right page, clear of the fold
        "[html[data-hinge]_&]:left-[calc(var(--hinge-x)+var(--fold-clear))] [html[data-hinge]_&]:pl-0",
        "[html[data-fold=vertical]_&]:left-[var(--fold-end)] [html[data-fold=vertical]_&]:pl-0"
      )}
    >
      <div className="flex shrink-0 items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          {detail && (
            <div className="truncate text-xs text-white/60">{detail}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-full px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-white/60"
        >
          Done
        </button>
      </div>

      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
      >
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/60">
            <ImageOff className="h-6 w-6" />
            Couldn&apos;t load this image
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc(path)}
            alt={name}
            draggable={false}
            onLoad={(e) =>
              setDims({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-contain will-change-transform"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          />
        )}
        {!touched && !failed && (
          <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/70 pointer-fine:hidden">
            Pinch to zoom
          </span>
        )}
      </div>

      <div className="flex shrink-0 gap-2 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className={cn(BUTTON, "text-red-400")}
          >
            Remove
          </button>
        )}
        {onAdd && (
          <button type="button" onClick={onAdd} className={BUTTON}>
            Add to message
          </button>
        )}
        <button
          ref={doneRef}
          type="button"
          onClick={onClose}
          className={BUTTON}
        >
          Done
        </button>
      </div>
    </div>,
    document.body
  );
}
