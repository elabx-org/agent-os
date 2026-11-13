import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  appendChunk,
  cancel,
  createJob,
  extract,
  ffmpeg,
  finalize,
} from "@/lib/video";

test("a recording whose sound outlasts its picture still sends its frames", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "video-test-"));
  const clip = path.join(tmp, "clip.mp4");
  // 2s of picture under 2.4s of sound: the last moment is past the last image
  execFileSync(ffmpeg(), [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=d=2:r=30:s=320x240",
    "-f",
    "lavfi",
    "-i",
    "sine=d=2.4",
    "-pix_fmt",
    "yuv420p",
    clip,
  ]);
  const data = fs.readFileSync(clip);
  const job = createJob("clip.mp4", data.length);
  try {
    appendChunk(job, 0, data);
    await extract(job, "balanced");
    assert.equal(job.stage, "ready", job.error);
    assert.ok(job.frames.length > 1);
    const sent = finalize(job, []);
    assert.equal(sent.count, job.frames.length);
    for (const f of job.frames)
      assert.ok(fs.existsSync(path.join(sent.dir, f.name)), f.name);
    // The moment past the picture's end got the last image there is
    const last = job.frames[job.frames.length - 1];
    assert.ok(last.t > 2, String(last.t));
  } finally {
    cancel(job);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
