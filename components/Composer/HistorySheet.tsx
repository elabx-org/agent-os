"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClaudeHistory } from "@/hooks/useComposerData";
import { GROUP_HEADING, POPOVER } from "./SuggestionPopover";

interface HistorySheetProps {
  cwd: string;
  onChoose: (text: string) => void;
  onClose: () => void;
}

const WHEN = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ago(timestamp: number): string {
  if (!timestamp) return "";
  const s = (timestamp - Date.now()) / 1000;
  if (s > -60) return "now";
  if (s > -3600) return WHEN.format(Math.round(s / 60), "minute");
  if (s > -86400) return WHEN.format(Math.round(s / 3600), "hour");
  return WHEN.format(Math.round(s / 86400), "day");
}

/** The first line, with what's searched for in bold */
function Line({ text, query }: { text: string; query: string }) {
  const line = text.split("\n")[0];
  const q = query.trim().toLowerCase();
  const at = q ? line.toLowerCase().indexOf(q) : -1;
  let shown: ReactNode = line;
  if (at >= 0)
    shown = (
      <>
        {line.slice(0, at)}
        <b className="text-foreground font-semibold">
          {line.slice(at, at + q.length)}
        </b>
        {line.slice(at + q.length)}
      </>
    );
  return <span className="min-w-0 flex-1 truncate">{shown}</span>;
}

/**
 * This project's earlier prompts from ~/.claude/history.jsonl, newest first,
 * filtered as you type: Claude Code's Ctrl-R
 */
export function HistorySheet({ cwd, onChoose, onClose }: HistorySheetProps) {
  const [query, setQuery] = useState("");
  const { entries, isLoading } = useClaudeHistory(cwd, query);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);

  // A touch outside puts it away
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  const project = cwd.replace(/\/+$/, "").split("/").pop() || cwd;

  return (
    <div ref={rootRef} className={POPOVER}>
      <label className="bg-muted text-foreground mx-0.5 mt-0.5 mb-1 flex items-center gap-2 rounded-[10px] px-2.5">
        <Search className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = entries.length;
              if (n)
                setSelected(
                  (i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n
                );
            } else if (e.key === "Enter" && entries[selected]) {
              e.preventDefault();
              onChoose(entries[selected].text);
            }
          }}
          enterKeyHint="search"
          placeholder="Search this project's prompts"
          aria-label="Search prompt history"
          className="placeholder:text-muted-foreground h-9 min-w-0 flex-1 bg-transparent text-base focus:outline-none"
        />
        <span className="text-muted-foreground shrink-0 text-[11px]">
          {entries.length}
        </span>
      </label>
      <div
        role="listbox"
        aria-label="Earlier prompts"
        className="max-h-[min(40vh,280px)] overflow-y-auto overscroll-contain"
      >
        {entries.map((entry, i) => (
          <button
            key={`${entry.timestamp}:${i}`}
            type="button"
            role="option"
            aria-selected={i === selected}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setSelected(i)}
            onClick={() => onChoose(entry.text)}
            className={cn(
              "text-muted-foreground flex min-h-9 w-full items-baseline gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-[13px]",
              i === selected ? "bg-muted" : "active:bg-muted"
            )}
          >
            <Line text={entry.text} query={query} />
            <em className="text-muted-foreground/70 shrink-0 text-[10px] not-italic">
              {ago(entry.timestamp)}
            </em>
          </button>
        ))}
        {!entries.length && (
          <div className="text-muted-foreground px-2.5 py-2 text-xs">
            {isLoading ? "Loading…" : "No earlier prompts match"}
          </div>
        )}
      </div>
      <div className={cn(GROUP_HEADING, "tracking-normal normal-case")}>
        ~/.claude/history.jsonl · {project}
      </div>
    </div>
  );
}
