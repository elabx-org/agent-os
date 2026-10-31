import fs from "fs";

/*
 * The model a Claude session last answered with, from its transcript: for
 * sessions without AgentOS's status line (started outside AgentOS, or
 * before it had one), so the chip doesn't fall back to sessions.model.
 */

const TAIL_BYTES = 64 * 1024;

/** The last assistant message's model id in the transcript's tail */
export function lastTranscriptModel(
  file: string,
  bytes = TAIL_BYTES
): string | null {
  let text: string;
  try {
    const size = fs.statSync(file).size;
    const from = Math.max(0, size - bytes);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  return lastModelIn(text);
}

/** The last real model id among transcript lines (a partial first line is skipped) */
export function lastModelIn(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"model"')) continue;
    try {
      const entry = JSON.parse(line);
      const model = entry?.message?.model;
      if (
        entry?.type === "assistant" &&
        typeof model === "string" &&
        model.startsWith("claude")
      ) {
        return model;
      }
    } catch {
      // Partial or malformed
    }
  }
  return null;
}

/** "Opus 5.5" from "claude-opus-5-5", "Sonnet 4.5" from "claude-sonnet-4-5-20250929" */
export function modelNameFromId(id: string): string | null {
  const parts = id
    .toLowerCase()
    .replace(/\[.*\]$/, "")
    .replace(/^claude-/, "")
    .split("-")
    .filter((p) => !/^\d{6,}$/.test(p));
  const family = parts.find((p) => /^[a-z]+$/.test(p));
  if (!family) return null;
  const version = parts.filter((p) => /^\d{1,2}$/.test(p)).join(".");
  const name = family[0].toUpperCase() + family.slice(1);
  return version ? `${name} ${version}` : name;
}
