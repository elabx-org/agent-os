/**
 * Rows of a side-by-side diff (D-Diff's Split): the old file left, the new
 * one right. Within a hunk a run of deletions is paired with the run of
 * additions after it, line by line; the shorter side gets blank fillers.
 * Pure: unit-tested.
 */

import type { DiffHunk, DiffLine } from "@/lib/diff-parser";
import { hunkLines } from "./diff-format";

export interface SplitRow {
  /** The old file's line, or null for a filler */
  left: DiffLine | null;
  /** The new file's line, or null for a filler */
  right: DiffLine | null;
}

/**
 * A context line as the left column shows it: only its old number, so
 * sideOf reads it as the old file's (selection, markers)
 */
export function asOldSide(line: DiffLine): DiffLine {
  return line.type === "context" ? { ...line, newLineNumber: null } : line;
}

/** One hunk's rows, in diff order */
export function pairRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++)
      rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const line of hunkLines(hunk)) {
    if (line.type === "deletion") {
      // A deletion after additions starts a new change block
      if (adds.length) flush();
      dels.push(line);
    } else if (line.type === "addition") {
      adds.push(line);
    } else {
      flush();
      rows.push({ left: asOldSide(line), right: line });
    }
  }
  flush();
  return rows;
}
