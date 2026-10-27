"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageSrc } from "./ImagePill";
import {
  PRESETS,
  acceptFrames,
  closeReview,
  estimateTokens,
  formatLength,
  formatTokens,
  frameDir,
  keptFrames,
  makeFrames,
  toggleFrame,
  uploadPrefs,
  videoStore,
  type Preset,
  type VideoUpload,
} from "@/stores/videoUploads";

/** "0:07" from a frame's time */
const at = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** The open Duo lying flat (useHinge sets the attribute) */
function useHinge(): boolean {
  const [hinge, setHinge] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setHinge(root.hasAttribute("data-hinge"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributeFilter: ["data-hinge"] });
    return () => observer.disconnect();
  }, []);
  return hinge;
}

/**
 * A video's frames to look over before they're sent: untick the ones that
 * don't matter, or make them again at another preset. On the open Duo, the
 * grid on the left page and the chosen frame large on the right.
 */
export function VideoReview() {
  const snap = useSnapshot(videoStore);
  const { check } = useSnapshot(uploadPrefs);
  const v = snap.items.find((x) => x.key === snap.review) as
    | VideoUpload
    | undefined;
  const hinge = useHinge();
  const [selected, setSelected] = useState<string | null>(null);
  const [dontAsk, setDontAsk] = useState(false);

  useEffect(() => {
    if (!v) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeReview();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [v]);

  if (!v) return null;
  const ready = v.stage === "ready";
  const kept = keptFrames(v);
  const tokens = estimateTokens(v);
  const current = v.frames.find((f) => f.name === selected) ?? v.frames[0];
  const src = (name: string) => imageSrc(`${frameDir(v)}/${name}`);
  const portrait = (v.height ?? 2) >= (v.width ?? 1);
  // Opened by the setting, not by a tap: say why
  const why =
    check === "large" && tokens > uploadPrefs.limit
      ? `Opened because ${formatTokens(tokens)} tokens is over your ${Math.round(uploadPrefs.limit / 1000)}k limit`
      : null;

  const presets = (
    <div
      role="radiogroup"
      aria-label="Frames"
      className="bg-secondary grid grid-cols-3 gap-1 rounded-xl p-1"
    >
      {(Object.keys(PRESETS) as Preset[]).map((p) => {
        const on = v.preset === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={v.stage === "extracting"}
            onClick={() => !on && void makeFrames(v.key, p)}
            className={cn(
              "flex flex-col items-center rounded-lg px-1 py-1.5",
              on ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            <span className="text-[13px] font-medium">{PRESETS[p].label}</span>
            <span className="text-[11px]">
              {on && ready
                ? `${v.frames.length} · ${formatTokens(estimateTokens(v, v.frames.length))}`
                : `up to ${PRESETS[p].maxFrames}`}
            </span>
          </button>
        );
      })}
    </div>
  );

  const grid = ready ? (
    <div className="grid grid-cols-3 gap-2">
      {v.frames.map((f, i) => {
        const on = !v.exclude.includes(f.name);
        return (
          <div key={f.name} className="relative">
            <button
              type="button"
              onClick={() =>
                hinge ? setSelected(f.name) : toggleFrame(v.key, f.name)
              }
              aria-label={`Frame ${i + 1} at ${at(f.t)}${on ? "" : ", left out"}`}
              className={cn(
                "bg-muted block w-full overflow-hidden rounded-lg",
                portrait ? "aspect-[9/16]" : "aspect-video",
                hinge && current?.name === f.name && "ring-primary ring-2",
                !on && "opacity-35"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src(f.name)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover object-top"
              />
            </button>
            <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[11px] text-white tabular-nums">
              {at(f.t)}
            </span>
            <button
              type="button"
              onClick={() => toggleFrame(v.key, f.name)}
              aria-label={on ? `Leave out ${at(f.t)}` : `Use ${at(f.t)}`}
              className="absolute top-0 right-0 flex h-10 w-10 items-start justify-end p-1.5"
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border-2",
                  on
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-white/80 bg-black/40"
                )}
              >
                {on && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  ) : (
    <div className="text-muted-foreground flex flex-col items-center gap-3 py-16 text-sm">
      {v.stage === "error" ? (
        <span className="text-red-400">{v.error}</span>
      ) : (
        <>
          <span>Making {PRESETS[v.preset].label} frames…</span>
          <span className="bg-secondary h-1 w-40 overflow-hidden rounded-full">
            <span
              className="bg-primary block h-full transition-[width]"
              style={{ width: `${Math.round(v.progress * 100)}%` }}
            />
          </span>
        </>
      )}
    </div>
  );

  const footer = (
    <div className="border-border flex items-center gap-3 border-t px-5 py-3">
      <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={dontAsk}
          onChange={(e) => setDontAsk(e.target.checked)}
          className="accent-primary h-4 w-4"
        />
        <span className="truncate">Don&apos;t ask again</span>
      </label>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {kept.length} of {v.frames.length} · {formatTokens(tokens)} tokens
      </span>
      <button
        type="button"
        disabled={!ready || !kept.length}
        onClick={() => acceptFrames(v.key, dontAsk)}
        className="bg-primary text-primary-foreground h-10 shrink-0 rounded-full px-4 text-sm font-medium disabled:opacity-40"
      >
        Use {kept.length}
      </button>
    </div>
  );

  const header = (
    <div className="flex items-center gap-2 px-5 pt-3 pb-2">
      <button
        type="button"
        onClick={closeReview}
        aria-label="Close"
        className="text-muted-foreground -ml-2 flex h-10 w-10 items-center justify-center rounded-full"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold">
          Screen recording · {formatLength(v.duration)}
        </div>
        {why && (
          <div className="text-muted-foreground truncate text-xs">{why}</div>
        )}
      </div>
    </div>
  );

  const layer =
    "bg-background fixed inset-0 z-50 flex pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)]";

  if (hinge) {
    const i = current ? v.frames.indexOf(current) : -1;
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Video frames"
        className={layer}
      >
        {/* Left page: the frames */}
        <div className="flex w-[calc(var(--hinge-x)-var(--fold-clear))] shrink-0 flex-col">
          {header}
          <div className="px-5 pb-2">{presets}</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">{grid}</div>
          {footer}
        </div>
        {/* Right page: the one chosen, large */}
        <div className="ml-[calc(2*var(--fold-clear))] flex min-w-0 flex-1 flex-col items-center gap-2 py-4 pr-5">
          {ready && current ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src(current.name)}
                alt={`Frame at ${at(current.t)}`}
                className="min-h-0 flex-1 rounded-xl object-contain"
              />
              <div className="text-muted-foreground text-xs tabular-nums">
                {at(current.t)} · frame {i + 1} of {v.frames.length} ·{" "}
                {current.name}
              </div>
              <div
                className="relative h-6 w-full max-w-[360px]"
                aria-hidden="true"
              >
                <span className="bg-border absolute top-1/2 h-0.5 w-full -translate-y-1/2 rounded-full" />
                {v.frames.map((f) => (
                  <span
                    key={f.name}
                    className={cn(
                      "absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full",
                      f.name === current.name
                        ? "bg-primary h-5 w-1"
                        : v.exclude.includes(f.name)
                          ? "bg-muted-foreground/30"
                          : "bg-foreground/70"
                    )}
                    style={{ left: `${(f.t / (v.duration || 1)) * 100}%` }}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Video frames"
      className={cn(layer, "flex-col")}
    >
      {header}
      <div className="px-5 pb-2">{presets}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">{grid}</div>
      {footer}
    </div>
  );
}
