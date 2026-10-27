"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { Film, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageSrc } from "./ImagePill";
import { formatSize } from "./text";
import {
  PRESETS,
  estimateTokens,
  formatLength,
  formatTokens,
  frameDir,
  keptFrames,
  loadUploadPrefs,
  openReview,
  removeVideo,
  retry,
  uploadPrefs,
  videoStore,
  type VideoUpload,
} from "@/stores/videoUploads";

function status(v: VideoUpload, showTokens: boolean): string {
  switch (v.stage) {
    case "uploading":
      return `Uploading ${Math.round((v.sent / v.size) * 100)}% · ${formatSize(v.sent)} of ${formatSize(v.size)}`;
    case "extracting":
      return `Making frames… ${Math.round(v.progress * 100)}%`;
    case "ready": {
      const n = keptFrames(v).length;
      const base = `${PRESETS[v.preset].label} · ${n} frame${n === 1 ? "" : "s"}`;
      return showTokens
        ? `${base} · ${formatTokens(estimateTokens(v))} tokens`
        : base;
    }
    case "error":
      return v.error || "Couldn't make the frames";
  }
}

/**
 * The draft's videos, above the box: a poster frame, the recording's length
 * and where it's got to. A tap opens the frames to look over; × drops it.
 */
export function VideoPills({ draft }: { draft: string }) {
  const { items } = useSnapshot(videoStore);
  const { showTokens } = useSnapshot(uploadPrefs);
  useEffect(loadUploadPrefs, []);
  const mine = items.filter((v) => v.draft === draft);
  if (!mine.length) return null;

  return (
    <div className="flex flex-col gap-1.5 pb-1.5">
      {mine.map((v) => {
        const busy = v.stage === "uploading" || v.stage === "extracting";
        const fraction = v.stage === "uploading" ? v.sent / v.size : v.progress;
        const poster = v.frames[0];
        return (
          <div
            key={v.key}
            className="bg-secondary relative flex h-12 items-center gap-2.5 overflow-hidden rounded-2xl pr-1 pl-1.5"
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => v.stage !== "uploading" && openReview(v.key)}
              aria-label={`Screen recording ${formatLength(v.duration)}: ${status(v as VideoUpload, false)}`}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <span className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                {poster && v.job ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageSrc(
                      `${frameDir(v as VideoUpload)}/${poster.name}`
                    )}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Film className="h-4 w-4" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium">
                  Screen recording
                  {v.duration ? ` · ${formatLength(v.duration)}` : ""}
                </span>
                <span
                  className={cn(
                    "truncate text-xs",
                    v.stage === "error"
                      ? "text-red-400"
                      : "text-muted-foreground"
                  )}
                >
                  {status(v as VideoUpload, showTokens)}
                </span>
              </span>
            </button>
            {v.stage === "error" && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => retry(v.key)}
                aria-label="Retry"
                className="text-primary flex h-10 shrink-0 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Retry
              </button>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => removeVideo(v.key)}
              aria-label={busy ? "Cancel" : "Remove the video"}
              className="text-muted-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            >
              <X className="h-4 w-4" />
            </button>
            {busy && (
              <span
                aria-hidden="true"
                className="bg-primary absolute bottom-0 left-0 h-0.5 transition-[width]"
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
