import { proxy, ref } from "valtio";
import { toast } from "sonner";
import type { Frame, Preset, VideoJob } from "@/lib/video";

export type { Frame, Preset };

/** The presets, as lib/video.ts has them (that module is the server's) */
export const PRESETS: Record<
  Preset,
  { label: string; maxFrames: number; longEdge: number; hint: string }
> = {
  quick: {
    label: "Quick",
    maxFrames: 12,
    longEdge: 768,
    hint: "The gist: headings and layout",
  },
  balanced: {
    label: "Balanced",
    maxFrames: 24,
    longEdge: 1092,
    hint: "Most screen text stays readable",
  },
  detail: {
    label: "Detail",
    maxFrames: 40,
    longEdge: 1568,
    hint: "Fine print: logs, code, small labels",
  },
};

const MAX_SECONDS = 5 * 60;
const CHUNK = 4 * 1024 * 1024;

// ---- Settings → Uploads (per device) ----------------------------------

export interface UploadPrefs {
  preset: Preset;
  /** When the review sheet opens by itself before sending */
  check: "always" | "large" | "never";
  /** "Large", in tokens */
  limit: number;
  showTokens: boolean;
}

const PREFS_KEY = "agentos:upload-prefs";
export const uploadPrefs = proxy<UploadPrefs>({
  preset: "balanced",
  check: "large",
  limit: 40_000,
  showTokens: false,
});

export function loadUploadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    Object.assign(uploadPrefs, saved);
  } catch {}
}

export function setUploadPrefs(patch: Partial<UploadPrefs>) {
  Object.assign(uploadPrefs, patch);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(uploadPrefs));
  } catch {}
}

// ---- Videos on their way ----------------------------------------------

export interface VideoUpload {
  /** This page's id for it; `job` is the server's */
  key: string;
  /** The draft it belongs to (the session) */
  draft: string;
  job?: string;
  name: string;
  size: number;
  sent: number;
  stage: "uploading" | "extracting" | "ready" | "error";
  error?: string;
  progress: number;
  duration?: number;
  width?: number;
  height?: number;
  preset: Preset;
  frames: Frame[];
  exclude: string[];
  /** Looked over in the review sheet (or not asked to be) */
  reviewed: boolean;
  /** Kept for Retry */
  file?: File;
}

interface PendingSend {
  /** The box's text when it goes (it stays in the box while waiting) */
  text: () => string;
  send: (text: string) => void;
  /** Empties the box once it's sent */
  clear: () => void;
}

export const videoStore = proxy<{
  items: VideoUpload[];
  /** The upload the review sheet shows */
  review: string | null;
  /** A message waiting for its videos' frames, per draft */
  pending: Record<string, PendingSend>;
}>({ items: [], review: null, pending: {} });

const find = (key: string) => videoStore.items.find((v) => v.key === key);
const live = new Map<string, AbortController>();

export const videosFor = (draft: string) =>
  videoStore.items.filter((v) => v.draft === draft);

/** The frames' folder for the preset made */
export const frameDir = (v: VideoUpload) =>
  `/tmp/agent-os-screenshots/video/${v.job}/${v.preset}`;

export const keptFrames = (v: VideoUpload) =>
  v.frames.filter((f) => !v.exclude.includes(f.name));

/** About what the frames cost: Claude counts width × height / 750 an image */
export function estimateTokens(v: VideoUpload, count = keptFrames(v).length) {
  const w = v.width || 1170;
  const h = v.height || 2532;
  const edge = PRESETS[v.preset].longEdge;
  const scale = Math.min(1, edge / Math.max(w, h));
  return Math.round(count * Math.min(1600, (w * scale * h * scale) / 750));
}

export const formatTokens = (n: number) =>
  n >= 1000 ? `~${Math.round(n / 1000)}k` : `~${n}`;

export const formatLength = (seconds = 0) => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** How long the video is, read in the page before anything is uploaded */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => done(null), 5000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    video.src = url;
  });
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  return data as T;
}

/** Picked videos: each becomes a pill that uploads and then makes frames */
export async function addVideos(files: File[], draft: string) {
  for (const file of files) {
    const duration = await readDuration(file);
    if (duration && duration > MAX_SECONDS + 1) {
      toast.error(
        `${file.name || "That video"} is ${formatLength(duration)}: up to 5:00 can be sent. Trim it in Photos first.`
      );
      continue;
    }
    const item: VideoUpload = {
      // randomUUID is for secure pages only (https, localhost)
      key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      draft,
      name: file.name || "Screen recording",
      size: file.size,
      sent: 0,
      stage: "uploading",
      progress: 0,
      duration: duration ?? undefined,
      preset: uploadPrefs.preset,
      frames: [],
      exclude: [],
      reviewed: false,
      file: ref(file),
    };
    videoStore.items.push(item);
    void upload(item.key);
  }
}

async function upload(key: string) {
  const v = find(key);
  if (!v?.file) return;
  const file = v.file;
  const abort = new AbortController();
  live.set(key, abort);
  try {
    v.stage = "uploading";
    v.error = undefined;
    v.sent = 0;
    const { id } = await api<{ id: string }>("/api/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size }),
      signal: abort.signal,
    });
    v.job = id;
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      const chunk = file.slice(offset, offset + CHUNK);
      for (let attempt = 0; ; attempt++) {
        try {
          await api(`/api/video/${id}?offset=${offset}`, {
            method: "PUT",
            body: chunk,
            signal: abort.signal,
          });
          break;
        } catch (e) {
          if (abort.signal.aborted || attempt >= 2) throw e;
        }
      }
      v.sent = Math.min(file.size, offset + CHUNK);
    }
    await makeFrames(key, v.preset);
  } catch (e) {
    if (abort.signal.aborted) return;
    v.stage = "error";
    v.error = e instanceof Error ? e.message : "Upload failed";
  } finally {
    if (live.get(key) === abort) live.delete(key);
  }
}

/** Frames for a preset; the upload is kept, so only this part runs again */
export async function makeFrames(key: string, preset: Preset) {
  const v = find(key);
  if (!v?.job) return;
  v.preset = preset;
  v.stage = "extracting";
  v.progress = 0;
  v.error = undefined;
  v.exclude = [];
  try {
    await api(`/api/video/${v.job}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset }),
    });
    for (;;) {
      await new Promise((r) => setTimeout(r, 600));
      if (!find(key)) return;
      const job = await api<VideoJob>(`/api/video/${v.job}`);
      v.progress = job.progress;
      v.duration = job.duration ?? v.duration;
      v.width = job.width;
      v.height = job.height;
      if (job.stage === "ready" && job.preset === preset) {
        v.frames = job.frames;
        v.stage = "ready";
        v.file = undefined;
        afterReady(v.draft);
        return;
      }
      if (job.stage === "error") throw new Error(job.error || "ffmpeg failed");
    }
  } catch (e) {
    v.stage = "error";
    v.error = e instanceof Error ? e.message : "Couldn't make the frames";
  }
}

/** Retry: the upload again if it never finished, else just the frames */
export function retry(key: string) {
  const v = find(key);
  if (!v) return;
  if (v.file && v.sent < v.size) void upload(key);
  else void makeFrames(key, v.preset);
}

export function removeVideo(key: string) {
  const v = find(key);
  live.get(key)?.abort();
  if (v?.job) void fetch(`/api/video/${v.job}`, { method: "DELETE" });
  videoStore.items = videoStore.items.filter((x) => x.key !== key);
  if (videoStore.review === key) videoStore.review = null;
}

export function toggleFrame(key: string, name: string) {
  const v = find(key);
  if (!v) return;
  v.exclude = v.exclude.includes(name)
    ? v.exclude.filter((n) => n !== name)
    : [...v.exclude, name];
}

export function openReview(key: string) {
  videoStore.review = key;
}

/** The sheet closed without "Use": a waiting message stays waiting */
export function closeReview() {
  videoStore.review = null;
}

/** "Use N frames": looked over; a message waiting on it goes now */
export function acceptFrames(key: string, dontAsk: boolean) {
  const v = find(key);
  if (!v) return;
  v.reviewed = true;
  videoStore.review = null;
  if (dontAsk) setUploadPrefs({ check: "never" });
  afterReady(v.draft);
}

/** One to look over before sending, by the setting, or none */
function needsReview(draft: string): VideoUpload | undefined {
  if (uploadPrefs.check === "never") return undefined;
  return videosFor(draft).find(
    (v) =>
      v.stage === "ready" &&
      !v.reviewed &&
      (uploadPrefs.check === "always" || estimateTokens(v) > uploadPrefs.limit)
  );
}

/**
 * Send with the draft's videos: the lines for their frames, then the text.
 * Waits for frames still being made (the message goes on its own), and
 * opens the review sheet first when the setting asks. The text stays in the
 * box until it goes.
 */
export function sendWithVideos(
  draft: string,
  text: () => string,
  send: (text: string) => void,
  clear: () => void
): void {
  const videos = videosFor(draft);
  if (videos.some((v) => v.stage === "error")) {
    toast.error("A video couldn't be made into frames: retry or remove it");
    return;
  }
  videoStore.pending[draft] = ref({ text, send, clear });
  if (videos.some((v) => v.stage !== "ready"))
    toast("Sends when the frames are ready", { id: `video-wait-${draft}` });
  afterReady(draft);
}

/** A video got its frames, or was looked over: send what waited, if it can */
function afterReady(draft: string) {
  const pending = videoStore.pending[draft];
  const videos = videosFor(draft);
  const review = needsReview(draft);
  if (review) {
    if (videoStore.review !== review.key) openReview(review.key);
    return;
  }
  if (!pending || videos.some((v) => v.stage !== "ready")) return;
  delete videoStore.pending[draft];
  void (async () => {
    try {
      const lines: string[] = [];
      for (const v of videos) {
        const { line } = await api<{ line: string }>(
          `/api/video/${v.job}/finalize`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ exclude: v.exclude }),
          }
        );
        lines.push(line);
      }
      videoStore.items = videoStore.items.filter((v) => v.draft !== draft);
      toast.dismiss(`video-wait-${draft}`);
      const text = pending.text();
      pending.clear();
      pending.send([...lines, text].filter(Boolean).join("\n\n"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send the video");
    }
  })();
}
