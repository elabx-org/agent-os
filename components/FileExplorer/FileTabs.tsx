"use client";

import { useRef, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpenFile } from "@/hooks/useFileEditor";

interface FileTabsProps {
  files: OpenFile[];
  activeFilePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  isDirty: (path: string) => boolean;
  /** Files changed in git (absolute paths) also get the amber dot */
  isModified?: (path: string) => boolean;
  className?: string;
}

/** Open files over the code (D-Files): the shown one joins the code page */
export function FileTabs({
  files,
  activeFilePath,
  onSelect,
  onClose,
  isDirty,
  isModified,
  className,
}: FileTabsProps) {
  const activeTabRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeFilePath]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div
      role="tablist"
      aria-label="Open files"
      className={cn(
        "scrollbar-none flex min-w-0 items-end gap-0.5 overflow-x-auto",
        className
      )}
    >
      {files.map((file) => {
        const isActive = file.path === activeFilePath;
        const dot = isDirty(file.path) || !!isModified?.(file.path);
        const fileName = file.path.split("/").pop() || file.path;

        return (
          <div
            key={file.path}
            ref={isActive ? activeTabRef : null}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            title={file.path}
            onClick={() => onSelect(file.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(file.path);
              }
            }}
            className={cn(
              // Tabs give way down to 96px, then the row scrolls
              "file-tab group min-w-[96px] cursor-pointer whitespace-nowrap",
              isActive ? "on" : "hover:text-foreground"
            )}
          >
            <span className="max-w-[180px] min-w-0 truncate font-mono">
              {fileName}
            </span>
            {dot && (
              <span
                className="dirty-dot"
                aria-label={isDirty(file.path) ? "Unsaved" : "Changed"}
              />
            )}
            <button
              type="button"
              aria-label={`Close ${fileName}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(file.path);
              }}
              className={cn(
                "-mr-1.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full hover:bg-[hsl(var(--foreground)/0.1)] focus-visible:opacity-100",
                "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100",
                !isActive && "pointer-coarse:hidden"
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
