"use client";

import { Laptop, Server } from "lucide-react";
import type { MachineTag as Tag } from "@/lib/machine-now";
import { cn } from "@/lib/utils";

/** Where a row lives, on a row from another machine: a glyph and its name */
export function MachineTag({
  tag,
  className,
}: {
  tag: Pick<Tag, "kind" | "name">;
  className?: string;
}) {
  const Icon = tag.kind === "server" ? Server : Laptop;
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-[9rem] shrink-0 items-center gap-1 rounded-full bg-violet-500/15 px-2 text-[12px] font-semibold text-violet-700 dark:text-violet-300",
        className
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
