import { useQuery } from "@tanstack/react-query";
import type { ClaudeCommand, ClaudeCommandGroups } from "@/lib/claude-commands";

export type { ClaudeCommand, ClaudeCommandGroups };

export interface HistoryEntry {
  text: string;
  timestamp: number;
}

export interface FileSuggestion {
  /** Relative to cwd; directories end in "/" */
  path: string;
  kind: "changed" | "recent" | "match";
  /** git's two-letter porcelain code, for changed files */
  status?: string;
}

const STALE = 60_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

const EMPTY_GROUPS: ClaudeCommandGroups = {
  builtin: [],
  skills: [],
  plugins: [],
  user: [],
  project: [],
};

/** Claude Code's "/" commands for a working directory, grouped by source */
export function useClaudeCommands(
  cwd: string | null | undefined,
  enabled = true
) {
  const { data, isLoading } = useQuery({
    queryKey: ["claude-commands", cwd ?? ""],
    queryFn: () =>
      getJson<ClaudeCommandGroups>(
        `/api/claude/commands${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`
      ),
    enabled,
    staleTime: STALE,
  });
  return { groups: data ?? EMPTY_GROUPS, isLoading };
}

/** Group order in the picker: what the user wrote before what ships */
const GROUP_ORDER: (keyof ClaudeCommandGroups)[] = [
  "project",
  "user",
  "skills",
  "plugins",
  "builtin",
];

/**
 * Commands matching what follows the "/": name prefix first, then name
 * contains, then description contains. Empty query keeps everything.
 */
export function filterCommands(
  groups: ClaudeCommandGroups,
  query: string
): ClaudeCommand[] {
  const all = GROUP_ORDER.flatMap((g) => groups[g]);
  const q = query.trim().replace(/^\//, "").toLowerCase();
  if (!q) return all;
  const rank = (c: ClaudeCommand) => {
    const name = c.name.toLowerCase();
    // "commit" finds "commit-commands:commit" as readily as "commit"
    const short = name.slice(name.indexOf(":") + 1);
    if (name.startsWith(q) || short.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (c.description.toLowerCase().includes(q)) return 2;
    return -1;
  };
  return all
    .map((c, i) => ({ c, i, r: rank(c) }))
    .filter((m) => m.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((m) => m.c);
}

/** Recent prompts sent in this project, newest first (↑/↓ and Ctrl-R) */
export function useClaudeHistory(
  project: string | null | undefined,
  query = "",
  limit = 50
) {
  const q = query.trim();
  const { data, isLoading } = useQuery({
    queryKey: ["claude-history", project ?? "", q, limit],
    queryFn: () =>
      getJson<{ entries: HistoryEntry[] }>(
        `/api/claude/history?project=${encodeURIComponent(project!)}&q=${encodeURIComponent(q)}&limit=${limit}`
      ),
    enabled: !!project,
    staleTime: STALE,
    placeholderData: (previous) => previous,
  });
  return { entries: data?.entries ?? [], isLoading };
}

/** "@" suggestions: changed files first, then recent, then fuzzy matches */
export function useFileSuggestions(
  cwd: string | null | undefined,
  query = "",
  enabled = true
) {
  const q = query.trim();
  const { data, isLoading } = useQuery({
    queryKey: ["file-suggest", cwd ?? "", q],
    queryFn: () =>
      getJson<{ files: FileSuggestion[] }>(
        `/api/files/suggest?cwd=${encodeURIComponent(cwd!)}&q=${encodeURIComponent(q)}`
      ),
    enabled: enabled && !!cwd,
    staleTime: STALE,
    // Keep the last list on screen while the next keystroke loads
    placeholderData: (previous) => previous,
  });
  return { files: data?.files ?? [], isLoading };
}
