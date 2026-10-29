"use client";

import { Download, Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { confirmAction } from "@/components/ui/confirm";
import { useStashAction } from "@/data/git/queries";
import type { StashEntry } from "@/lib/git-status";
import { shortAge } from "./git-format";

interface StashRowsProps {
  workingDirectory: string;
  stashes: StashEntry[];
}

const DONE = { apply: "Applied", pop: "Popped", drop: "Dropped" } as const;

/** The stashes on one card (D-Git): message and age; a tap to apply, pop or drop */
export function StashRows({ workingDirectory, stashes }: StashRowsProps) {
  const action = useStashAction(workingDirectory);
  const run = async (index: number, kind: "apply" | "pop" | "drop") => {
    if (
      kind === "drop" &&
      !(await confirmAction({
        title: "Drop this stash?",
        message: stashes.find((s) => s.index === index)?.message,
        confirmLabel: "Drop",
        destructive: true,
      }))
    )
      return;
    action.mutate(
      { index, action: kind },
      {
        onSuccess: () => toast.success(`${DONE[kind]} the stash`),
        onError: (err) => toast.error(err.message || "Stash action failed"),
      }
    );
  };

  if (!stashes.length)
    return <p className="text-muted-foreground px-1 text-[14px]">No stashes</p>;

  return (
    <div className="group-card">
      {stashes.map((s) => (
        <DropdownMenu key={s.index}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={action.isPending}
              className="row hover:bg-foreground/[0.03] min-h-[48px] w-full min-w-0 py-0 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-[14px]">
                {s.message}
              </span>
              <span className="text-muted-foreground flex-none text-[13px]">
                {s.date ? shortAge(s.date) : ""}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => run(s.index, "apply")}>
              <Download className="mr-2 h-4 w-4" />
              Apply
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(s.index, "pop")}>
              <Archive className="mr-2 h-4 w-4" />
              Pop
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => run(s.index, "drop")}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Drop
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </div>
  );
}
