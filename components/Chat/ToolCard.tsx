"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  FilePlus,
  FileText,
  Globe,
  ListChecks,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { ImageThumb } from "@/components/Composer/ImagePill";
import { imagePaths } from "@/components/Composer/text";
import { showImage } from "@/lib/client/image-view";
import { cn } from "@/lib/utils";
import { StateDot } from "@/components/a/StateDot";
import { AgentRow, StateWord } from "@/components/rows/AgentRow";
import { WorkflowCard } from "@/components/WorkflowPhases";
import { fromSubagentStatus } from "@/lib/agent-state";
import type { SubagentInfo } from "@/lib/claude-subagents";
import type { WorkflowInfo } from "@/lib/claude-workflows";
import {
  baseName,
  checkLabel,
  patchPeek,
  PATCH_PEEK,
  shortElapsed,
  toolLines,
  type ResultItem,
  type ToolItem,
  type ToolLine,
} from "./rows";

/** Runs longer than this many lines collapse to their last few */
const TOOL_RUN_VISIBLE = 4;

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: SquareTerminal,
  Agent: Bot,
  Task: Bot,
  Workflow: Bot,
  WebFetch: Globe,
  WebSearch: Globe,
};

const ICON = "h-4 w-4 shrink-0";

/** The running line's time so far, ticking */
function Elapsed({ since }: { since: string }) {
  const start = Date.parse(since);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (Number.isNaN(start)) return null;
  return (
    <span className="text-muted-foreground shrink-0 font-mono text-xs">
      {shortElapsed(now - start)}
    </span>
  );
}

/** +38 −9 */
export function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 gap-2">
      <span className="n-add text-xs">+{added}</span>
      <span className="n-del text-xs">−{removed}</span>
    </span>
  );
}

/** What ends a line: the running dot and time, Failed, or the counts */
function LineEnd({ line, children }: { line: ToolLine; children?: ReactNode }) {
  if (line.running)
    return (
      <span className="flex shrink-0 items-center gap-2">
        <StateDot state="work" className="animate-pulse" />
        <Elapsed since={line.ts} />
      </span>
    );
  if (line.error)
    return (
      <span className="shrink-0 text-xs font-medium text-[var(--del)]">
        Failed
      </span>
    );
  return <>{children}</>;
}

/** The mini-diff under an edit: a few lines, all on "Show all" */
function MiniDiff({ lines }: { lines: string[] }) {
  const [all, setAll] = useState(false);
  const shown = patchPeek(lines, all);
  return (
    <>
      <div className={cn("mini-diff", all && "max-h-[60vh] overflow-y-auto")}>
        {shown.map((line, i) =>
          line === "@" ? (
            <div key={i} className="dl-ctx">
              ⋯
            </div>
          ) : (
            <div
              key={i}
              className={
                line[0] === "+"
                  ? "dl-add"
                  : line[0] === "-"
                    ? "dl-del"
                    : "dl-ctx"
              }
            >
              {line[0] === "-" ? "−" : line[0] === "+" ? "+" : " "}{" "}
              {line.slice(1) || " "}
            </div>
          )
        )}
      </div>
      {lines.length > PATCH_PEEK && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="tool text-muted-foreground hover:text-foreground w-full text-left text-xs"
        >
          {all ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </>
  );
}

/** A line whose result can be read: Bash, a web fetch, any other tool */
function PlainLine({ line }: { line: ToolLine & { kind: "tool" | "agent" } }) {
  const [open, setOpen] = useState(false);
  const { tool, result } = line;
  const Icon = TOOL_ICONS[tool.name] ?? Wrench;
  const preview = result?.preview;
  return (
    <>
      <button
        type="button"
        onClick={() => preview && setOpen((o) => !o)}
        aria-expanded={preview ? open : undefined}
        className="tool w-full text-left"
      >
        <Icon className={ICON} />
        {tool.name === "Bash" ? (
          <span className="min-w-0 flex-1 truncate">
            Ran <span className="font-mono text-[13px]">{tool.summary}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {tool.name}{" "}
            <span className="text-muted-foreground font-mono text-[13px]">
              {tool.summary}
            </span>
          </span>
        )}
        <LineEnd line={line} />
      </button>
      {open && preview && (
        <pre className="mini-diff text-muted-foreground max-h-56 overflow-auto !whitespace-pre-wrap">
          {preview}
        </pre>
      )}
    </>
  );
}

function Line({ line }: { line: ToolLine }) {
  switch (line.kind) {
    case "read": {
      // Pictures Claude looked at: a thumbnail to tap instead of the icon
      const pictures = imagePaths(line.files.join(" "));
      return (
        <div className="tool" title={line.files.join("\n")}>
          {pictures.length ? (
            <span className="flex flex-none -space-x-2">
              {pictures.slice(0, 3).map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    showImage(e.currentTarget, path);
                  }}
                  aria-label={`View ${baseName(path)}`}
                  className="ring-card relative rounded-md ring-2 after:absolute after:-inset-2 after:content-['']"
                >
                  <ImageThumb path={path} className="h-6 w-6 rounded-md" />
                </button>
              ))}
            </span>
          ) : (
            <FileText className={ICON} />
          )}
          <span className="min-w-0 flex-1 truncate">
            Read{" "}
            {line.files.length === 1 ? (
              <span className="font-mono text-[13px]">
                {baseName(line.files[0])}
              </span>
            ) : (
              `${line.files.length} files`
            )}
          </span>
          <LineEnd line={line} />
        </div>
      );
    }
    case "search":
      return (
        <div className="tool" title={line.patterns.join("\n")}>
          <Search className={ICON} />
          <span className="min-w-0 flex-1 truncate">
            {line.patterns.length === 1 ? (
              <>
                Searched for{" "}
                <span className="font-mono text-[13px]">
                  {line.patterns[0]}
                </span>
              </>
            ) : (
              `Searched ${line.patterns.length} patterns`
            )}
          </span>
          <LineEnd line={line} />
        </div>
      );
    case "edit": {
      const Icon = line.verb === "Wrote" ? FilePlus : Pencil;
      return (
        <>
          <div className="tool" title={line.file}>
            <Icon className={ICON} />
            <span className="min-w-0 flex-1 truncate">
              {line.verb}{" "}
              <span className="font-mono text-[13px]">
                {baseName(line.file)}
              </span>
            </span>
            <LineEnd line={line}>
              {line.counted && (
                <Counts added={line.added} removed={line.removed} />
              )}
            </LineEnd>
          </div>
          {!line.running && line.patch.length > 0 && (
            <MiniDiff lines={line.patch} />
          )}
        </>
      );
    }
    case "check":
      return (
        <div className="tool" title={line.command}>
          {line.running ? (
            <SquareTerminal className={ICON} />
          ) : line.error ? (
            <X className={cn(ICON, "text-[var(--del)]")} strokeWidth={2.6} />
          ) : (
            <Check
              className={cn(ICON, "text-[var(--add)]")}
              strokeWidth={2.6}
            />
          )}
          <span className="min-w-0 flex-1 truncate">{checkLabel(line)}</span>
          {line.running && <LineEnd line={line} />}
        </div>
      );
    case "plan":
      return (
        <div className="tool">
          <ListChecks className={ICON} />
          <span className="min-w-0 flex-1 truncate">Updated the plan</span>
          <LineEnd line={line} />
        </div>
      );
    default:
      return <PlainLine line={line} />;
  }
}

/** A subagent the session started: what it's doing, and a way into it */
export function SubagentRow({
  agent,
  onOpen,
}: {
  agent: SubagentInfo;
  onOpen: (agentId: string) => void;
}) {
  const state = fromSubagentStatus(agent.status);
  return (
    <AgentRow
      kind="subagent"
      state={state}
      title={agent.description}
      subtitle={
        <>
          <StateWord state={state} />
          {[
            agent.agentType,
            agent.steps !== null
              ? `${agent.steps} ${agent.steps === 1 ? "step" : "steps"}`
              : null,
          ]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join("")}
        </>
      }
      trailing={
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground h-4 w-4"
        />
      }
      onClick={() => onOpen(agent.agentId)}
      className="bg-card rounded-2xl"
    />
  );
}

/**
 * A run of tool calls (Closed-Chat): one card of grouped lines ("Read 3
 * files", "Edited X +38 −9" over its mini-diff, "✓ Type check passed");
 * a subagent or workflow the session knows breaks out as its own row
 */
export function ToolRun({
  tools,
  results,
  agents,
  onOpenAgent,
  workflows,
  onShowWorkflow,
}: {
  tools: ToolItem[];
  results: Map<string, ResultItem>;
  agents?: Map<string, SubagentInfo>;
  onOpenAgent?: (agentId: string) => void;
  workflows?: Map<string, WorkflowInfo>;
  onShowWorkflow?: (runId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // The plan chip shows the plan, and a question still open is the
  // needs-you card: neither is a line here
  const lines = toolLines(tools, results).filter(
    (line) =>
      line.kind !== "plan" &&
      !(
        line.kind === "tool" &&
        line.running &&
        line.tool.name === "AskUserQuestion"
      )
  );
  const hidden = expanded ? 0 : Math.max(0, lines.length - TOOL_RUN_VISIBLE);

  // Consecutive card lines share a card; a known agent stands alone
  const blocks: (ToolLine[] | ReactNode)[] = [];
  for (const line of lines.slice(hidden)) {
    let own: ReactNode = null;
    if (line.kind === "agent") {
      const agent = agents?.get(line.tool.id);
      const runId =
        line.tool.name === "Workflow" ? line.result?.runId : undefined;
      const run = runId ? workflows?.get(runId) : undefined;
      if (run && onOpenAgent && onShowWorkflow)
        own = (
          <WorkflowCard
            key={line.id}
            run={run}
            onOpenAgent={onOpenAgent}
            onShowAll={() => onShowWorkflow(run.runId)}
          />
        );
      else if (agent && onOpenAgent)
        own = <SubagentRow key={line.id} agent={agent} onOpen={onOpenAgent} />;
    }
    const last = blocks[blocks.length - 1];
    if (own) blocks.push(own);
    else if (Array.isArray(last)) last.push(line);
    else blocks.push([line]);
  }

  return (
    <div className="flex flex-col gap-2">
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-muted-foreground hover:text-foreground self-start px-1 text-xs"
        >
          {hidden} earlier {hidden === 1 ? "step" : "steps"}
        </button>
      )}
      {blocks.map((block, i) =>
        Array.isArray(block) ? (
          <div key={(block[0] as ToolLine).id} className="tools">
            {(block as ToolLine[]).map((line) => (
              <Line key={line.id} line={line} />
            ))}
          </div>
        ) : (
          <div key={i}>{block}</div>
        )
      )}
    </div>
  );
}
