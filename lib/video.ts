/**
 * Screen recordings turned into frames Claude can read (server only).
 *
 * A video comes up in chunks, then ffmpeg finds where the screen changed:
 * mpdecimate keeps a frame only when it differs from the last one kept, at
 * a threshold high enough to ignore a blinking cursor or the clock. The
 * frames it keeps come in bursts (a tap, an animation, a scroll); one frame
 * is taken once each burst settles, and long bursts (scrolling) are sampled
 * as they go. Quiet stretches add nothing: the screen didn't change.
 */

import { spawn, execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

export type Preset = "quick" | "balanced" | "detail";

export const PRESETS: Record<
  Preset,
  { label: string; maxFrames: number; longEdge: number }
> = {
  quick: { label: "Quick", maxFrames: 12, longEdge: 768 },
  balanced: { label: "Balanced", maxFrames: 24, longEdge: 1092 },
  detail: { label: "Detail", maxFrames: 40, longEdge: 1568 },
};

/** Longer recordings are refused before they're uploaded */
export const MAX_SECONDS = 5 * 60;
export const MAX_BYTES = 1024 * 1024 * 1024;

export interface Frame {
  name: string;
  /** Seconds into the video */
  t: number;
}

export interface VideoJob {
  id: string;
  name: string;
  size: number;
  received: number;
  stage: "uploading" | "uploaded" | "extracting" | "ready" | "error";
  preset?: Preset;
  /** 0–1 while extracting */
  progress: number;
  duration?: number;
  width?: number;
  height?: number;
  frames: Frame[];
  error?: string;
}

// Uploads sit beside the pictures, so the image route can show the frames
export const VIDEO_ROOT = path.join(
  os.tmpdir(),
  "agent-os-screenshots",
  "video"
);

const jobs: Map<string, VideoJob> = ((
  globalThis as Record<string, unknown>
).__agentosVideoJobs ??= new Map()) as Map<string, VideoJob>;
const running = new Map<string, () => void>();

/** The machine's own ffmpeg if it has one, else the one bundled with AgentOS */
let ffmpegPath: string | null = null;
export function ffmpeg(): string {
  if (ffmpegPath) return ffmpegPath;
  try {
    ffmpegPath = execFileSync("sh", ["-c", "command -v ffmpeg"], {
      encoding: "utf8",
    }).trim();
  } catch {}
  if (!ffmpegPath) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpegPath = require("ffmpeg-static") as string;
  }
  return ffmpegPath;
}

export const jobDir = (id: string) => path.join(VIDEO_ROOT, id);
const sourceFile = (job: VideoJob) =>
  path.join(jobDir(job.id), `source${path.extname(job.name) || ".mov"}`);

export function getJob(id: string): VideoJob | undefined {
  return /^[0-9a-f-]{36}$/.test(id) ? jobs.get(id) : undefined;
}

export function createJob(name: string, size: number): VideoJob {
  const id = crypto.randomUUID();
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "video.mov";
  const job: VideoJob = {
    id,
    name: safe,
    size,
    received: 0,
    stage: "uploading",
    progress: 0,
    frames: [],
  };
  fs.mkdirSync(jobDir(id), { recursive: true });
  jobs.set(id, job);
  sweep();
  return job;
}

/** A chunk at its offset; a repeated chunk (a retry) is taken again */
export function appendChunk(job: VideoJob, offset: number, data: Buffer) {
  if (offset > job.received) throw new Error("Chunk out of order");
  if (offset + data.length > MAX_BYTES) throw new Error("Video too large");
  const fd = fs.openSync(sourceFile(job), offset === 0 ? "w" : "r+");
  try {
    fs.writeSync(fd, data, 0, data.length, offset);
  } finally {
    fs.closeSync(fd);
  }
  job.received = Math.max(job.received, offset + data.length);
  if (job.received >= job.size) job.stage = "uploaded";
}

function run(
  job: VideoJob,
  args: string[],
  onLine?: (line: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg(), args);
    running.set(job.id, () => child.kill("SIGKILL"));
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      err = (err + text).slice(-200_000);
      if (onLine) text.split(/[\r\n]+/).forEach(onLine);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      running.delete(job.id);
      if (code === 0) resolve(err);
      else
        reject(
          new Error(err.split("\n").filter(Boolean).pop() || "ffmpeg failed")
        );
    });
  });
}

const stamp = (t: number) =>
  `f-${String(Math.floor(t / 60)).padStart(2, "0")}m${(t % 60).toFixed(1).padStart(4, "0")}s.jpg`;

/** Where the screen changed, as moments to take a frame at */
export function pickMoments(
  changes: number[],
  duration: number,
  maxFrames: number
): number[] {
  const bursts: number[][] = [];
  for (const t of changes) {
    const last = bursts[bursts.length - 1];
    if (last && t - last[last.length - 1] <= 0.35) last.push(t);
    else bursts.push([t]);
  }
  const end = Math.max(0, duration - 0.05);
  // Priority: 0 the start and each settled screen, 1 what a scroll passed by
  const picks = new Map<number, number>([[0, -1]]);
  for (const b of bursts) {
    const first = b[0];
    const last = b[b.length - 1];
    const settled = Math.round(Math.min(last + 0.3, end) * 100) / 100;
    if (!picks.has(settled)) picks.set(settled, 0);
    if (last - first > 1) {
      const n = Math.floor((last - first) / 0.7);
      for (let i = 1; i <= n; i++) {
        const t =
          Math.round((first + ((last - first) * i) / (n + 1)) * 100) / 100;
        if (!picks.has(t)) picks.set(t, 1);
      }
    }
  }
  let order = [...picks.keys()].sort((a, b) => a - b);
  // Over the cap: scroll samples go first, then the most crowded moments
  while (order.length > maxFrames) {
    const worst = Math.max(...order.map((t) => picks.get(t)!));
    const crowd = (t: number) => {
      const i = order.indexOf(t);
      return Math.min(
        i > 0 ? t - order[i - 1] : Infinity,
        i < order.length - 1 ? order[i + 1] - t : Infinity
      );
    };
    const drop = order
      .filter((t) => picks.get(t) === worst)
      .reduce((a, b) => (crowd(b) < crowd(a) ? b : a));
    order = order.filter((t) => t !== drop);
  }
  return order;
}

/** Frames for a preset, in their own folder; a preset already made is kept */
export async function extract(job: VideoJob, preset: Preset) {
  const spec = PRESETS[preset];
  job.stage = "extracting";
  job.preset = preset;
  job.progress = 0;
  job.error = undefined;
  try {
    const src = sourceFile(job);
    const out = path.join(jobDir(job.id), preset);
    // The changes are the same whatever the preset: found once
    const changesFile = path.join(jobDir(job.id), "changes.json");
    let changes: number[];
    if (fs.existsSync(changesFile)) {
      changes = JSON.parse(fs.readFileSync(changesFile, "utf8"));
    } else {
      const log = await run(
        job,
        [
          "-hide_banner",
          "-nostdin",
          "-i",
          src,
          "-an",
          "-vf",
          "fps=10,scale=360:-2,mpdecimate=max=0:hi=1536:lo=640:frac=0.5,showinfo",
          "-f",
          "null",
          "-",
        ],
        (line) => {
          const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(line);
          if (d) job.duration = +d[1] * 3600 + +d[2] * 60 + +d[3];
          const s = /Stream .*Video: .*?(\d{2,5})x(\d{2,5})/.exec(line);
          if (s && !job.width) [job.width, job.height] = [+s[1], +s[2]];
          const t = /pts_time:([\d.]+)/.exec(line);
          if (t && job.duration)
            job.progress = Math.min(0.7, (+t[1] / job.duration) * 0.7);
        }
      );
      changes = [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
      fs.writeFileSync(changesFile, JSON.stringify(changes));
    }
    const duration = job.duration ?? changes[changes.length - 1] ?? 0;
    if (duration > MAX_SECONDS + 1) throw new Error("Longer than 5 minutes");
    const moments = pickMoments(changes, duration, spec.maxFrames);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const edge = spec.longEdge;
    const scale = `scale='if(gt(iw,ih),min(iw,${edge}),-2)':'if(gt(iw,ih),-2,min(ih,${edge}))'`;
    const frames: Frame[] = [];
    for (const [i, t] of moments.entries()) {
      const name = stamp(t);
      await run(job, [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-ss",
        String(t),
        "-i",
        src,
        "-frames:v",
        "1",
        "-vf",
        scale,
        "-q:v",
        "4",
        path.join(out, name),
      ]);
      frames.push({ name, t });
      job.progress = 0.7 + (0.3 * (i + 1)) / moments.length;
    }
    job.frames = frames;
    job.stage = "ready";
    job.progress = 1;
  } catch (e) {
    job.stage = "error";
    job.error = e instanceof Error ? e.message : String(e);
  }
}

/**
 * The frames to send, in a folder of their own (the ones left out removed),
 * and the line that tells Claude about them
 */
export function finalize(job: VideoJob, exclude: string[]) {
  if (job.stage !== "ready" || !job.preset) throw new Error("Frames not ready");
  const from = path.join(jobDir(job.id), job.preset);
  const kept = job.frames.filter((f) => !exclude.includes(f.name));
  if (!kept.length) throw new Error("No frames chosen");
  const dir = path.join(jobDir(job.id), "send");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of kept)
    fs.copyFileSync(path.join(from, f.name), path.join(dir, f.name));
  const d = Math.round(job.duration ?? 0);
  const length = `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`;
  const line =
    `Screen recording ${length} · ${PRESETS[job.preset].label} · ${kept.length} frames: ${dir}/ ` +
    `(read them in order; each name is its time in the video)`;
  return { dir, count: kept.length, line };
}

export function cancel(job: VideoJob) {
  running.get(job.id)?.();
  jobs.delete(job.id);
  fs.rmSync(jobDir(job.id), { recursive: true, force: true });
}

/** Videos older than a day go, with their frames */
function sweep() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let names: string[] = [];
  try {
    names = fs.readdirSync(VIDEO_ROOT);
  } catch {
    return;
  }
  for (const name of names) {
    const dir = path.join(VIDEO_ROOT, name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) {
        fs.rmSync(dir, { recursive: true, force: true });
        jobs.delete(name);
      }
    } catch {}
  }
}
