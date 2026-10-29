/**
 * Pure helpers for showing a diff: a path as name over folder, +N −N, and
 * the one line that stands in for hunks that say nothing (binary, empty,
 * deleted, pure rename).
 */

import type { DiffHunk, DiffLine, ParsedDiff } from "@/lib/diff-parser";

/** "components/Session/ActivityStrip.tsx" -> ActivityStrip.tsx over components/Session */
export function splitPath(path: string): { name: string; folder: string } {
  const clean = path.replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  if (slash < 0) return { name: clean, folder: "" };
  return { name: clean.slice(slash + 1), folder: clean.slice(0, slash) };
}

/** Lines added and removed, over one file or several */
export function countsOf(diffs: ParsedDiff | readonly ParsedDiff[]): {
  added: number;
  removed: number;
} {
  const list = Array.isArray(diffs) ? diffs : [diffs as ParsedDiff];
  return list.reduce(
    (n, d) => ({
      added: n.added + d.additions,
      removed: n.removed + d.deletions,
    }),
    { added: 0, removed: 0 }
  );
}

/** One short line for a header: "+38 −9", "New file · +12", "Binary" */
export function diffSummary(diff: ParsedDiff): string {
  if (diff.isBinary) return "Binary";
  const counts = `+${diff.additions} −${diff.deletions}`;
  if (diff.isNew) return `New file · +${diff.additions}`;
  if (diff.isDeleted) return `Deleted · −${diff.deletions}`;
  if (diff.isRenamed) return `Renamed · ${counts}`;
  return counts;
}

/**
 * What the body shows: a caption line, the hunks, or both. A binary file, a
 * deleted file (every line red says no more than "Deleted") and a file with
 * no hunks get only the caption; a rename with edits keeps its hunks under it.
 */
export function diffBody(diff: ParsedDiff): {
  caption: string | null;
  hunks: boolean;
} {
  if (diff.isBinary)
    return {
      caption: diff.isNew
        ? "New binary file"
        : diff.isDeleted
          ? "Binary file deleted"
          : "Binary file changed",
      hunks: false,
    };
  if (diff.isDeleted)
    return {
      caption: diff.deletions
        ? `File deleted · ${diff.deletions} ${diff.deletions === 1 ? "line" : "lines"}`
        : "Empty file deleted",
      hunks: false,
    };
  const renamed =
    diff.isRenamed && diff.oldFile && diff.oldFile !== diff.newFile
      ? `Renamed from ${diff.oldFile}`
      : null;
  if (diff.hunks.length === 0)
    return {
      caption: renamed ?? (diff.isNew ? "Empty new file" : "No changes"),
      hunks: false,
    };
  return { caption: renamed, hunks: true };
}

/**
 * The hunk's lines to draw: without its function header (already in the
 * @@ line) and without the blank "context" line parseDiff reads from the
 * diff text's final newline (one past the hunk's own line count)
 */
export function hunkLines(hunk: DiffHunk): DiffLine[] {
  const lines = hunk.lines.filter((l) => l.type !== "header");
  const last = lines[lines.length - 1];
  if (last?.type === "context" && last.content === "") {
    const old = lines.filter((l) => l.type !== "addition").length;
    if (old > hunk.oldCount) lines.pop();
  }
  return lines;
}

/** The line as git prints it: its sign, then its text */
export function lineText(line: DiffLine): string {
  const sign =
    line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
  return sign + line.content;
}

/** The number a single gutter shows: the new side's, the old one for a deletion */
export function lineNumberOf(line: DiffLine): number | null {
  return line.type === "deletion" ? line.oldLineNumber : line.newLineNumber;
}

/** The path a file's diff is about: a deleted file keeps its old name */
export function diffPath(diff: ParsedDiff): string {
  const real = (p: string) => (p && p !== "/dev/null" ? p : "");
  return diff.isDeleted
    ? real(diff.oldFile) || real(diff.newFile)
    : real(diff.newFile) || real(diff.oldFile);
}
