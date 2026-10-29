"use client";

import { forwardRef, useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  baseName,
  escapeRegex,
  mergeSearch,
  type CodeHit,
  type SearchResults,
  type SuggestEntry,
} from "./files-search";

const DEBOUNCE_MS = 200;
/** Text search starts at two characters: one matches nearly every line */
const MIN_TEXT_QUERY = 2;
const EMPTY: SearchResults = { files: [], text: [] };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * File names (/api/files/suggest) and text in files (/api/code-search) under
 * the project root, merged, 200ms after typing stops
 */
export function useFilesSearch(root: string, query: string) {
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const abort = new AbortController();
    const timer = window.setTimeout(async () => {
      const suggest = getJson<{ files?: SuggestEntry[] }>(
        `/api/files/suggest?cwd=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}&limit=30`,
        abort.signal
      );
      const text =
        q.length >= MIN_TEXT_QUERY
          ? getJson<{ results?: CodeHit[] }>(
              `/api/code-search?path=${encodeURIComponent(root)}&query=${encodeURIComponent(escapeRegex(q))}&maxResults=60&contextLines=0`,
              abort.signal
            )
          : Promise.resolve(null);
      const [s, t] = await Promise.all([suggest, text]);
      if (abort.signal.aborted) return;
      setResults(mergeSearch(root, s?.files ?? [], t?.results ?? []));
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [root, query]);

  return { results, loading };
}

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter: open the first result */
  onSubmit: () => void;
  placeholder: string;
  small?: boolean;
  loading?: boolean;
  className?: string;
}

/** The one field for names and text (E-Files 40px, D-Files .sm) */
export const FilesSearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function FilesSearchField(
    { value, onChange, onSubmit, placeholder, small, loading, className },
    ref
  ) {
    return (
      <label className={cn("search-field", small && "sm", className)}>
        {loading ? (
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
        ) : (
          <Search className="h-4 w-4 flex-shrink-0" />
        )}
        <input
          ref={ref}
          type="search"
          enterKeyHint="search"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Find a file or text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            } else if (e.key === "Escape" && value) {
              e.preventDefault();
              onChange("");
            }
          }}
        />
      </label>
    );
  }
);

/** File names first, then text hits under their file with the line */
export function FilesSearchResults({
  results,
  loading,
  onOpen,
  className,
}: {
  results: SearchResults;
  loading: boolean;
  /** Path relative to the root; line for a text hit */
  onOpen: (relPath: string, line?: number) => void;
  className?: string;
}) {
  if (!results.files.length && !results.text.length) {
    return (
      <p className={cn("text-muted-foreground px-3 py-4 text-sm", className)}>
        {loading ? "Searching…" : "Nothing found"}
      </p>
    );
  }
  return (
    <div className={className}>
      {results.files.map((f) => {
        const dir = f.path.slice(0, f.path.length - baseName(f.path).length);
        return (
          <button
            key={`f:${f.path}`}
            type="button"
            className="tree-row w-full rounded-none pl-3.5 text-left hover:bg-[hsl(var(--foreground)/0.04)]"
            title={f.path}
            onClick={() => onOpen(f.path)}
          >
            <span
              className={cn(
                "flex-none font-mono text-[13px]",
                f.changed && "git-m"
              )}
            >
              {baseName(f.path)}
            </span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[12px]">
              {dir.replace(/\/$/, "")}
            </span>
          </button>
        );
      })}
      {results.text.map((group) => (
        <div key={`t:${group.path}`} className="py-1">
          <div
            className={cn(
              "truncate px-3.5 pt-2 pb-1 font-mono text-[12px]",
              group.changed ? "git-m" : "text-muted-foreground"
            )}
          >
            {group.path}
          </div>
          {group.hits.map((hit) => (
            <button
              key={hit.line}
              type="button"
              className="flex h-[34px] w-full items-center gap-2 pr-2 text-left font-mono text-[12px] hover:bg-[hsl(var(--foreground)/0.04)]"
              onClick={() => onOpen(group.path, hit.line)}
            >
              <span className="w-10 flex-none pr-1 text-right text-[var(--code-gutter)]">
                {hit.line}
              </span>
              <span className="min-w-0 flex-1 truncate">{hit.text}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
