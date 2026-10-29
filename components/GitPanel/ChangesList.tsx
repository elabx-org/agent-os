"use client";

import { useRef, useState } from "react";
import { FileDiff, Minus, MoreHorizontal, Plus, Undo2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLongPress } from "@/hooks/useLongPress";
import { useViewport } from "@/hooks/useViewport";
import { cn } from "@/lib/utils";
import { gitBadgeClass, gitBadgeOf } from "@/lib/git-types";
import type { AnyGitFile } from "./useGitModel";

interface ChangesListProps {
  files: AnyGitFile[];
  /** D-Git's rows: 48px with −N; E-Git's: 50px, +N only */
  wide?: boolean;
  /** The file whose diff is open (D-Git) */
  selected?: AnyGitFile | null;
  onOpen: (file: AnyGitFile) => void;
  onStage: (file: AnyGitFile) => void;
  onUnstage: (file: AnyGitFile) => void;
  onDiscard: (file: AnyGitFile) => void;
}

const keyOf = (f: AnyGitFile) =>
  `${"repoPath" in f ? f.repoPath : ""}:${f.staged ? "s" : "w"}:${f.path}`;

/**
 * The changed files on one card (E-Git, D-Git): letter, path, counts. A
 * tap opens the diff; hold (touch), right-click or ⋯ for stage, unstage
 * and discard. Staged files, when there are some, get a card of their own
 */
export function ChangesList(props: ChangesListProps) {
  const { files } = props;
  const staged = files.filter((f) => f.staged);
  if (!staged.length || staged.length === files.length)
    return <FileGroup {...props} />;
  const rest = files.filter((f) => !f.staged);
  return (
    <>
      <h3 className="t-sec">Staged · {staged.length}</h3>
      <FileGroup {...props} files={staged} />
      <h3 className="t-sec">Not staged · {rest.length}</h3>
      <FileGroup {...props} files={rest} />
    </>
  );
}

function FileGroup(props: ChangesListProps) {
  // A project's repos: each repo's name over its files
  const repos = new Map<string, AnyGitFile[]>();
  for (const f of props.files) {
    const name = "repoName" in f ? f.repoName : "";
    repos.set(name, [...(repos.get(name) ?? []), f]);
  }
  return (
    <div className="group-card">
      {[...repos].map(([repo, files], i) => (
        <div key={repo || "repo"}>
          {repo && (
            <div
              className={cn(
                "text-muted-foreground px-3.5 pt-2.5 pb-1 text-[12px] font-semibold",
                i > 0 && "border-hair border-t"
              )}
            >
              {repo}
            </div>
          )}
          {files.map((f) => (
            <FileRow
              key={keyOf(f)}
              {...props}
              file={f}
              selected={!!props.selected && keyOf(props.selected) === keyOf(f)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function FileRow({
  file,
  wide,
  selected,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
}: Omit<ChangesListProps, "files" | "selected"> & {
  file: AnyGitFile;
  selected: boolean;
}) {
  const { isTouch } = useViewport();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLongPress(ref, isTouch ? () => setMenu(true) : undefined);
  const badge = gitBadgeOf(file.status);
  const untracked = file.status === "untracked";

  return (
    <div
      ref={ref}
      onContextMenu={(e) => {
        if (isTouch) return;
        e.preventDefault();
        setMenu(true);
      }}
      className={cn(
        "group row data-[held]:bg-accent relative cursor-pointer gap-3 py-0 transition-colors select-none [-webkit-touch-callout:none]",
        wide ? "min-h-[48px]" : "min-h-[50px]",
        selected ? "sel" : "hover:bg-foreground/[0.03]"
      )}
      // The menu's items are portaled but their clicks bubble here in React
      onClick={(e) => {
        if (ref.current?.contains(e.target as Node)) onOpen(file);
      }}
    >
      <span className={cn("git-letter", gitBadgeClass(badge))}>{badge}</span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-[13px]"
        title={file.path}
      >
        {file.path}
      </span>
      {!!file.additions && (
        <span className="n-add flex-none text-[12px]">+{file.additions}</span>
      )}
      {wide && !!file.deletions && (
        <span className="n-del flex-none text-[12px]">−{file.deletions}</span>
      )}
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${file.path}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "text-muted-foreground hover:text-foreground -mr-1.5 flex h-7 w-7 flex-none items-center justify-center rounded-md",
              isTouch
                ? "pointer-events-none absolute right-2 opacity-0"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onOpen(file)}>
            <FileDiff className="mr-2 h-4 w-4" />
            Show diff
          </DropdownMenuItem>
          {file.staged ? (
            <DropdownMenuItem onSelect={() => onUnstage(file)}>
              <Minus className="mr-2 h-4 w-4" />
              Unstage
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onStage(file)}>
              <Plus className="mr-2 h-4 w-4" />
              Stage
            </DropdownMenuItem>
          )}
          {!file.staged && (
            <DropdownMenuItem
              onSelect={() => onDiscard(file)}
              className="text-destructive focus:text-destructive"
            >
              <Undo2 className="mr-2 h-4 w-4" />
              {untracked ? "Delete file" : "Discard changes"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
