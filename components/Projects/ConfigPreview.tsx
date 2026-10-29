"use client";

import { useEffect, useMemo, useRef } from "react";
import { Code } from "lucide-react";
import { CONFIG_FILE, type AgentOsConfig } from "@/lib/project-config-types";
import { cn } from "@/lib/utils";
import {
  diffChip,
  jsonTokens,
  lineDiff,
  serializeConfig,
  type JsonTokenKind,
} from "./ProjectConfigText";

const TOKEN_CLASS: Record<JsonTokenKind, string> = {
  key: "text-violet-700 dark:text-[#C4B5FD]",
  string: "",
  number: "text-sky-700 dark:text-sky-300",
  literal: "text-sky-700 dark:text-sky-300",
  punct: "text-muted-foreground",
};

/**
 * M3 (U3.3): D-Config's right panel: `.agent-os.json` as it will be saved,
 * line-numbered and highlighted, the lines that differ from the file on
 * disk marked "+N" in green with an "N lines to add" chip.
 */
export function ConfigPreview({
  base,
  config,
  className,
}: {
  /** The file's text on disk ("" when it doesn't exist) */
  base: string;
  /** What will be written */
  config: AgentOsConfig;
  className?: string;
}) {
  const diff = useMemo(
    () => lineDiff(base, serializeConfig(config)),
    [base, config]
  );
  const chip = diffChip(diff);
  // The first added line in view, about a third down (D-Config)
  const pre = useRef<HTMLPreElement>(null);
  const firstAdded = diff.lines.findIndex((l) => l.added);
  useEffect(() => {
    const el = pre.current;
    const line = el?.querySelector<HTMLElement>("[data-added]");
    if (!el || !line) return;
    const top =
      line.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop;
    el.scrollTop = Math.max(0, top - el.clientHeight / 3);
  }, [firstAdded]);

  return (
    <section
      aria-label={`${CONFIG_FILE} preview`}
      className={cn("flex min-w-0 flex-col gap-3.5", className)}
    >
      <div className="flex min-w-0 items-center gap-2.5 pr-5 pl-3">
        <Code aria-hidden className="text-muted-foreground h-4 w-4 flex-none" />
        <span className="min-w-0 flex-1 truncate font-mono text-[14px]">
          {CONFIG_FILE}
        </span>
        {chip && (
          <span className="chip h-[26px] flex-none" aria-live="polite">
            <span
              aria-hidden
              className="bg-meter h-2 w-2 flex-none rounded-full"
            />
            {chip}
          </span>
        )}
      </div>
      <p className="text-muted-foreground pr-5 pl-3 text-[13px] leading-snug">
        Lives in the repo root. Agents read it too, so they know how to run and
        preview the app.
      </p>
      <pre
        ref={pre}
        className="min-h-0 overflow-auto rounded-l-2xl py-3 font-mono text-[12px] leading-[21px]"
        style={{ background: "var(--diff-bg)" }}
      >
        <code className="block min-w-max">
          {diff.lines.map((line, i) => (
            <span
              key={i}
              data-added={line.added ? "" : undefined}
              className={cn("flex pr-3", line.added && "bg-[var(--add-bg)]")}
            >
              <span
                aria-hidden
                className={cn(
                  "w-[46px] flex-none pr-3 text-right tabular-nums select-none",
                  line.added
                    ? "text-[var(--add)]"
                    : "text-[#AEAEB2] dark:text-[#48484A]"
                )}
              >
                {line.added ? `+${i + 1}` : i + 1}
              </span>
              {line.added && <span className="sr-only">Added: </span>}
              <span className="whitespace-pre">
                {jsonTokens(line.text).map((t, j) =>
                  t.kind ? (
                    <span key={j} className={TOKEN_CLASS[t.kind]}>
                      {t.text}
                    </span>
                  ) : (
                    t.text
                  )
                )}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}
