"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronRight, ChevronDown, Folder, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { gitBadgeClass } from "@/lib/git-types";
import type { FileNode } from "@/lib/file-utils";

/** Narrow (E-Files): violet folder icons, rows on a card. Wide (D-Files): plain */
export type TreeVariant = "narrow" | "wide";

interface FileTreeProps {
  nodes: FileNode[];
  variant: TreeVariant;
  /** The open file's row is selected */
  selectedPath?: string | null;
  onFileClick: (path: string) => void;
  /** Double-click or long-press a folder: list from it */
  onEnterFolder?: (path: string) => void;
  /** Changes when the listing was refreshed: expanded folders refetch too */
  refreshKey?: number;
}

const LONG_PRESS_MS = 500;

/** Each level 20px further in; files one level past their folder */
const INDENT = { narrow: 14, wide: 8 } as const;

export async function fetchListing(dir: string): Promise<FileNode[] | null> {
  try {
    const res = await fetch(`/api/files?path=${encodeURIComponent(dir)}&git=1`);
    const data = await res.json();
    return Array.isArray(data.files) ? data.files : null;
  } catch (err) {
    console.error("Failed to load directory:", err);
    return null;
  }
}

/**
 * The file tree (E-Files, D-Files): folders expand in place and load lazily;
 * files show their git letter and colour
 */
export function FileTree({
  nodes,
  variant,
  selectedPath,
  onFileClick,
  onEnterFolder,
  refreshKey = 0,
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Map<string, FileNode[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const load = useCallback(async (dir: string) => {
    setLoadingDirs((prev) => new Set(prev).add(dir));
    const files = await fetchListing(dir);
    if (files) setChildren((prev) => new Map(prev).set(dir, files));
    setLoadingDirs((prev) => {
      const next = new Set(prev);
      next.delete(dir);
      return next;
    });
  }, []);

  // A refresh (upload, new file, coming back to the view) reloads what is open
  useEffect(() => {
    if (!refreshKey) return;
    for (const dir of expandedRef.current) load(dir);
  }, [refreshKey, load]);

  const toggle = useCallback(
    (dir: string) => {
      const opening = !expandedRef.current.has(dir);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (opening) next.add(dir);
        else next.delete(dir);
        return next;
      });
      if (opening && !children.has(dir)) load(dir);
    },
    [children, load]
  );

  // Long-press a folder (touch): enter it instead of toggling
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const startPress = (dir: string) => {
    if (!onEnterFolder) return;
    const state = { timer: 0, fired: false };
    state.timer = window.setTimeout(() => {
      state.fired = true;
      onEnterFolder(dir);
    }, LONG_PRESS_MS);
    press.current = state;
  };
  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };

  const renderLevel = (list: FileNode[], depth: number): React.ReactNode =>
    list.map((node) => {
      if (node.type === "directory") {
        const open = expanded.has(node.path);
        const kids = children.get(node.path) ?? node.children;
        return (
          <div key={node.path} role="treeitem" aria-expanded={open}>
            <button
              type="button"
              className="tree-row w-full text-left hover:bg-[hsl(var(--foreground)/0.04)]"
              style={{ paddingLeft: INDENT[variant] + depth * 20 }}
              title={
                onEnterFolder ? "Double-click to list from here" : undefined
              }
              onClick={() => {
                if (press.current?.fired) {
                  press.current = null;
                  return;
                }
                toggle(node.path);
              }}
              onDoubleClick={() => onEnterFolder?.(node.path)}
              onPointerDown={() => startPress(node.path)}
              onPointerUp={endPress}
              onPointerLeave={endPress}
              onPointerCancel={endPress}
              onContextMenu={(e) => onEnterFolder && e.preventDefault()}
            >
              <span className="text-muted-foreground flex h-4 w-4 flex-shrink-0 items-center justify-center">
                {loadingDirs.has(node.path) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : open ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </span>
              {variant === "narrow" && (
                <Folder className="h-4 w-4 flex-shrink-0 text-[hsl(var(--meter))]" />
              )}
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {node.dirty && (
                <span className="dirty-dot mr-1" aria-label="Has changes" />
              )}
            </button>
            {open && kids && kids.length > 0 && (
              <div role="group">{renderLevel(kids, depth + 1)}</div>
            )}
          </div>
        );
      }

      const badge = node.git;
      const selected = node.path === selectedPath;
      return (
        <button
          key={node.path}
          type="button"
          role="treeitem"
          aria-selected={selected}
          className={cn(
            "tree-row w-full text-left",
            selected ? "sel" : "hover:bg-[hsl(var(--foreground)/0.04)]",
            // E-Files' selection runs edge to edge of its card
            variant === "narrow" && "rounded-none"
          )}
          style={{ paddingLeft: INDENT[variant] + (depth + 1) * 20 }}
          onClick={() => onFileClick(node.path)}
        >
          {variant === "narrow" && <span className="w-4 flex-shrink-0" />}
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[13px]",
              badge && gitBadgeClass(badge)
            )}
          >
            {node.name}
          </span>
          {badge && (
            <span className={cn("git-st", gitBadgeClass(badge))}>{badge}</span>
          )}
        </button>
      );
    });

  return <div role="tree">{renderLevel(nodes, 0)}</div>;
}
