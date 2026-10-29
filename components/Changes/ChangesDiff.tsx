"use client";

import type { DiffLine, ParsedDiff } from "@/lib/diff-parser";
import { cn } from "@/lib/utils";

const LINE_CLASS: Record<DiffLine["type"], string> = {
  addition: "dl-add",
  deletion: "dl-del",
  context: "",
  header: "",
};
const MARKER: Record<DiffLine["type"], string> = {
  addition: "+",
  deletion: "-",
  context: " ",
  header: "",
};

/**
 * One file's lines as Open-Changes shows them under the list: the hunk
 * headers and lines on the card itself (no file header, the row above is
 * one), wrapped so a narrow page never scrolls sideways
 */
export function ChangesDiff({
  diff,
  className,
}: {
  diff: ParsedDiff;
  className?: string;
}) {
  if (diff.isBinary || diff.hunks.length === 0)
    return (
      <p className="text-muted-foreground px-4 py-8 text-center text-[13px]">
        {diff.isBinary ? "Binary file not shown" : "No changes to show"}
      </p>
    );
  return (
    <div
      className={cn(
        "mini-diff bg-transparent py-2.5 [&>*]:[overflow-wrap:anywhere] [&>*]:whitespace-pre-wrap",
        className
      )}
    >
      {diff.hunks.map((hunk, h) => [
        <div key={`h${h}`} className="dl-ctx">
          {hunk.header}
        </div>,
        ...hunk.lines
          .filter((line) => line.type !== "header")
          .map((line, l) => (
            <div
              key={`${h}-${l}`}
              className={cn(LINE_CLASS[line.type] || "dl-ctx")}
            >
              {MARKER[line.type]}
              {line.content || " "}
            </div>
          )),
      ])}
    </div>
  );
}
