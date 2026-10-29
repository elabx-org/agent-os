"use client";

import { useCallback, useEffect, useState } from "react";
import { baseName, pushRecent } from "./files-search";

const MAX_RECENT = 8;
const keyFor = (root: string) => `agentOS:files:recent:${root}`;

function readRecent(root: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(root));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((f): f is string => typeof f === "string")
      : [];
  } catch {
    return [];
  }
}

/** Files opened lately in this project, newest first (this browser only) */
export function useRecentFiles(root: string) {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(readRecent(root));
  }, [root]);

  const add = useCallback(
    (file: string) => {
      const next = pushRecent(readRecent(root), file, MAX_RECENT);
      setRecent(next);
      try {
        localStorage.setItem(keyFor(root), JSON.stringify(next));
      } catch {
        // Private mode or full: the list just isn't kept
      }
    },
    [root]
  );

  return { recent, add };
}

/** "Recent" and a chip per file, clipped at the edge (E-Files) */
export function RecentFiles({
  files,
  onOpen,
}: {
  files: string[];
  onOpen: (path: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-shrink-0 items-center gap-2 overflow-hidden">
      <span className="text-muted-foreground flex-none text-[13px]">
        Recent
      </span>
      {files.map((file) => (
        <button
          key={file}
          type="button"
          className="chip flex-none font-mono text-[12px]"
          title={file}
          onClick={() => onOpen(file)}
        >
          {baseName(file)}
        </button>
      ))}
    </div>
  );
}
