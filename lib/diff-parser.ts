/**
 * Unified diff parser
 * Parses git diff output into structured data
 */

export interface DiffLine {
  type: "context" | "addition" | "deletion" | "header";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  oldFile: string;
  newFile: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
}

/**
 * Parse a unified diff string into structured data
 */
export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");

  let oldFile = "";
  let newFile = "";
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let additions = 0;
  let deletions = 0;
  let isBinary = false;
  let isNew = false;
  let isDeleted = false;
  let isRenamed = false;

  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Binary file detection
    if (line.startsWith("Binary files")) {
      isBinary = true;
      continue;
    }

    // Old file header
    if (line.startsWith("--- ")) {
      oldFile = line.slice(4);
      if (oldFile === "/dev/null") {
        isNew = true;
      }
      // Strip a/ prefix
      if (oldFile.startsWith("a/")) {
        oldFile = oldFile.slice(2);
      }
      continue;
    }

    // New file header
    if (line.startsWith("+++ ")) {
      newFile = line.slice(4);
      if (newFile === "/dev/null") {
        isDeleted = true;
      }
      // Strip b/ prefix
      if (newFile.startsWith("b/")) {
        newFile = newFile.slice(2);
      }
      continue;
    }

    // Rename detection
    if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      isRenamed = true;
      continue;
    }

    // Hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
    );
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      const oldStart = parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;
      const context = hunkMatch[5] || "";

      currentHunk = {
        header: line,
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [],
      };

      // Add header line with context (function name, etc.)
      if (context.trim()) {
        currentHunk.lines.push({
          type: "header",
          content: context.trim(),
          oldLineNumber: null,
          newLineNumber: null,
        });
      }

      oldLineNum = oldStart;
      newLineNum = newStart;
      continue;
    }

    // Inside a hunk
    if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "addition",
          content: line.slice(1),
          oldLineNumber: null,
          newLineNumber: newLineNum,
        });
        newLineNum++;
        additions++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "deletion",
          content: line.slice(1),
          oldLineNumber: oldLineNum,
          newLineNumber: null,
        });
        oldLineNum++;
        deletions++;
      } else if (line.startsWith(" ") || line === "") {
        // Context line or empty
        const content = line.startsWith(" ") ? line.slice(1) : line;
        currentHunk.lines.push({
          type: "context",
          content,
          oldLineNumber: oldLineNum,
          newLineNumber: newLineNum,
        });
        oldLineNum++;
        newLineNum++;
      }
      // Skip other lines like "\ No newline at end of file"
    }
  }

  // Don't forget the last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return {
    oldFile,
    newFile,
    hunks,
    additions,
    deletions,
    isBinary,
    isNew,
    isDeleted,
    isRenamed,
  };
}

/**
 * Get a summary string for a diff
 */
export function getDiffSummary(diff: ParsedDiff): string {
  if (diff.isBinary) {
    return "Binary file";
  }
  if (diff.isNew) {
    return `New file (+${diff.additions})`;
  }
  if (diff.isDeleted) {
    return `Deleted (-${diff.deletions})`;
  }
  if (diff.isRenamed) {
    return `Renamed (+${diff.additions}, -${diff.deletions})`;
  }
  return `+${diff.additions}, -${diff.deletions}`;
}

/**
 * Get file name from diff (handles renames)
 */
export function getDiffFileName(diff: ParsedDiff): string {
  if (diff.isNew) {
    return diff.newFile;
  }
  if (diff.isDeleted) {
    return diff.oldFile;
  }
  if (diff.isRenamed) {
    return `${diff.oldFile} → ${diff.newFile}`;
  }
  return diff.newFile || diff.oldFile;
}

/** Undoes git's C-style quoting of a path ("a/t\\tab" -> a/t<tab>) */
function unquotePath(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  const bytes: number[] = [];
  const body = Array.from(p.slice(1, -1));
  const escapes: Record<string, number> = {
    n: 10,
    t: 9,
    r: 13,
    a: 7,
    b: 8,
    f: 12,
    v: 11,
    '"': 34,
    "\\": 92,
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      bytes.push(...new TextEncoder().encode(c));
      continue;
    }
    const next = body[++i];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i, i + 3).join(""), 8));
      i += 2;
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function stripPrefix(p: string): string {
  const path = unquotePath(p);
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path;
}

/** Both names from "diff --git a/x b/y" (ambiguous with spaces: same name wins) */
function headerNames(header: string): [string, string] | null {
  const rest = header.slice("diff --git ".length);
  const quoted = rest.match(/^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*")$/);
  if (quoted) return [stripPrefix(quoted[1]), stripPrefix(quoted[2])];
  const q2 = rest.match(/^("(?:[^"\\]|\\.)*") (\S+)$/);
  if (q2) return [stripPrefix(q2[1]), stripPrefix(q2[2])];
  // Unquoted: "a/P b/P" splits in the middle when both names are the same
  const mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid) && rest[mid] === " ") {
    const a = rest.slice(0, mid);
    const b = rest.slice(mid + 1);
    if (a.slice(2) === b.slice(2)) return [stripPrefix(a), stripPrefix(b)];
  }
  const space = rest.indexOf(" b/");
  if (space > 0)
    return [
      stripPrefix(rest.slice(0, space)),
      stripPrefix(rest.slice(space + 1)),
    ];
  return null;
}

/**
 * Splits a multi-file `git diff` into one ParsedDiff per file. Fills in what
 * parseDiff can't see without ---/+++ lines: names, new/deleted/renamed for
 * empty, binary and pure-rename files.
 */
export function parseMultiDiff(diffText: string): ParsedDiff[] {
  const chunks: string[][] = [];
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) chunks.push([line]);
    else if (chunks.length > 0) chunks[chunks.length - 1].push(line);
  }
  return chunks.map((lines) => {
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const diff = parseDiff(lines.join("\n"));
    const names = headerNames(lines[0]);
    let renameFrom: string | null = null;
    let renameTo: string | null = null;
    for (const line of lines) {
      if (line.startsWith("@@")) break;
      if (line.startsWith("new file mode")) diff.isNew = true;
      else if (line.startsWith("deleted file mode")) diff.isDeleted = true;
      else if (line.startsWith("rename from "))
        renameFrom = unquotePath(line.slice(12));
      else if (line.startsWith("rename to "))
        renameTo = unquotePath(line.slice(10));
    }
    // parseDiff keeps "/dev/null" (or nothing) as the missing side's name
    if (renameFrom && renameTo) {
      diff.oldFile = renameFrom;
      diff.newFile = renameTo;
    } else if (names) {
      if (!diff.oldFile || diff.oldFile === "/dev/null")
        diff.oldFile = names[0];
      if (!diff.newFile || diff.newFile === "/dev/null")
        diff.newFile = names[1];
    }
    // parseDiff strips a/ and b/ only from unquoted names
    if (diff.oldFile.startsWith('"')) diff.oldFile = stripPrefix(diff.oldFile);
    if (diff.newFile.startsWith('"')) diff.newFile = stripPrefix(diff.newFile);
    return diff;
  });
}
