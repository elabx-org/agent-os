import { execSync, spawn } from "child_process";

/**
 * Check if ripgrep is available on the system
 */
export function isRipgrepAvailable(): boolean {
  try {
    execSync("which rg", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export interface SearchOptions {
  maxResults?: number;
  contextLines?: number;
  filePattern?: string;
  caseSensitive?: boolean;
}

export interface SearchMatch {
  type: "match";
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    absolute_offset: number;
    submatches: Array<{ match: { text: string }; start: number; end: number }>;
  };
}

export interface FormattedMatch {
  file: string;
  line: number;
  column: number;
  matchText: string;
  lineText: string;
}

/** Hard cap on one search, so a huge folder cannot keep ripgrep running */
const SEARCH_TIMEOUT_MS = 8000;

/**
 * ripgrep's JSON matches under workingDir. Runs asynchronously (never blocks
 * the server's event loop), stops ripgrep as soon as maxResults matches are
 * in, and kills it when the signal aborts (the request was cancelled).
 */
export function searchCode(
  workingDir: string,
  query: string,
  options: SearchOptions & { maxDepth?: number; signal?: AbortSignal } = {}
): Promise<SearchMatch[]> {
  const { maxResults = 100, contextLines = 2, maxDepth, signal } = options;

  const args = [
    "--json",
    `--max-count=${Math.ceil(maxResults / 10)}`,
    `--context=${contextLines}`,
    "--max-filesize=1M",
    "--max-columns=500",
    "--ignore-case",
    ...(maxDepth ? [`--max-depth=${maxDepth}`] : []),
    "--",
    query,
    ".", // CRITICAL: Tell ripgrep to search current directory explicitly
  ];

  return new Promise((resolve, reject) => {
    const matches: SearchMatch[] = [];
    if (signal?.aborted) return resolve(matches);

    const child = spawn("rg", args, {
      cwd: workingDir,
      // Ignore stdin so ripgrep doesn't wait for it
      stdio: ["ignore", "pipe", "ignore"],
    });
    let done = false;
    let pending = "";
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve(matches);
    };
    const timer = setTimeout(finish, SEARCH_TIMEOUT_MS);
    signal?.addEventListener("abort", finish);

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      if (done) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.includes('"type":"match"')) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "match") matches.push(parsed);
        } catch {
          continue;
        }
        if (matches.length >= maxResults) return finish();
      }
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      // ENOENT = command not found
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "ripgrep (rg) not found. Install with: brew install ripgrep"
          )
        );
      } else {
        console.error("Error in searchCode:", error);
        resolve([]);
      }
    });
    // Status 1 = no matches (not an error for ripgrep)
    child.on("close", finish);
  });
}

export function formatSearchResults(matches: SearchMatch[]): FormattedMatch[] {
  return matches.map((match) => ({
    file: match.data.path.text,
    line: match.data.line_number,
    column: match.data.submatches[0]?.start || 0,
    matchText: match.data.submatches[0]?.match.text || "",
    lineText: match.data.lines.text,
  }));
}
