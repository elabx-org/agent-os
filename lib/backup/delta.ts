/**
 * Which conversation bytes a copy needs (lib/backup). Claude only ever
 * appends to its conversation file, so a copy sends what came after the
 * hub's end, unless the hub's last bytes differ from this machine's
 * (it was rewritten): then all of it, starting over. Server only (fs).
 */

import { createHash } from "crypto";
import fsp from "fs/promises";

/** The hub's tail hash covers at most this much */
export const TAIL_BYTES = 64 * 1024;

const STEP = 64 * 1024;

/**
 * Where a file's last whole line ends at or before `size`: a line Claude
 * is still writing is left for the next copy
 */
export async function cutAtNewline(
  file: string,
  size: number
): Promise<number> {
  if (size <= 0) return 0;
  const handle = await fsp.open(file, "r");
  try {
    let end = size;
    while (end > 0) {
      const start = Math.max(0, end - STEP);
      const buffer = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      const at = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
      if (at !== -1) return start + at + 1;
      end = start;
    }
    return 0;
  } finally {
    await handle.close();
  }
}

/** sha256 of a file's last min(end, TAIL_BYTES) bytes before `end` */
export async function tailHash(file: string, end: number): Promise<string> {
  const hash = createHash("sha256");
  const start = Math.max(0, end - TAIL_BYTES);
  if (end > start) {
    const handle = await fsp.open(file, "r");
    try {
      const buffer = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      hash.update(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }
  return hash.digest("hex");
}

/** sha256 of nothing: the tail of an empty copy */
export const EMPTY_TAIL = createHash("sha256").digest("hex");

/**
 * What to send: from the hub's end when its tail matches this file's
 * bytes there, else everything again (`reset`)
 */
export function conversationRange(input: {
  /** This machine's length, cut at the last newline */
  length: number;
  /** The hub's length */
  offset: number;
  hubTail: string;
  /** This file's tail hash at `offset` (null when it is shorter) */
  localTail: string | null;
}): { from: number; reset: boolean } {
  if (
    input.length < input.offset ||
    input.localTail === null ||
    input.localTail !== input.hubTail
  ) {
    return { from: 0, reset: true };
  }
  return { from: input.offset, reset: false };
}
