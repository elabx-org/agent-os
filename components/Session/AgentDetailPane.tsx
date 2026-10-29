"use client";

import { Fragment, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  FileText,
  Globe,
  Pencil,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Session } from "@/lib/db";
import type {
  SubagentDetail,
  ToolCallSummary,
  TreeNode,
} from "@/lib/agent-tree-types";
import { STATE_TEXT_CLASS, STATE_WORD } from "@/lib/agent-state";
import { cn } from "@/lib/utils";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import { StateDot } from "@/components/a/StateDot";
import { confirmAction } from "@/components/ui/confirm";
import { stopTreeNode, useAgentDetail } from "@/hooks/useAgentTree";
import { formatTokens } from "./activity-format";
import {
  detailTitle,
  hasDetail,
  nodeAge,
  opensSession,
  shortTokens,
  splitPath,
  toolAge,
} from "./agent-tree-format";

const MAX_FILES = 5;

/** A tool call's glyph, by what Claude Code calls the tool */
function toolIcon(tool: string): LucideIcon {
  switch (tool) {
    case "Read":
      return FileText;
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return Pencil;
    case "Bash":
      return Terminal;
    case "Grep":
    case "Glob":
      return Search;
    case "WebFetch":
    case "WebSearch":
      return Globe;
    default:
      return Wrench;
  }
}

/** "Agent-OS redesign › agentos-feature-moc… › Design": the middle gives way */
function Crumbs({ crumbs }: { crumbs: string[] }) {
  return (
    <nav
      aria-label="Lineage"
      className="text-muted-foreground flex min-w-0 items-center gap-1 text-[13px] whitespace-nowrap"
    >
      {crumbs.map((crumb, i) => {
        const first = i === 0;
        const last = i === crumbs.length - 1 && i > 0;
        return (
          <Fragment key={i}>
            {i > 0 && (
              <ChevronRight aria-hidden className="h-3 w-3 flex-none" />
            )}
            <span
              className={cn(
                first || last
                  ? "flex-none"
                  : "min-w-0 truncate font-mono text-xs",
                last && "text-[#3A3A3F] dark:text-[#E5E5EA]",
                // One crumb alone, or a long first one, may still cut
                first && crumbs.length === 1 && "min-w-0 truncate"
              )}
            >
              {crumb}
            </span>
          </Fragment>
        );
      })}
    </nav>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-muted-foreground text-[13px] font-semibold">
      {children}
    </div>
  );
}

function ToolRow({ call, now }: { call: ToolCallSummary; now: number }) {
  const Icon = toolIcon(call.tool);
  return (
    <div className={cn("tool min-h-10", call.running && "text-foreground")}>
      {call.running ? (
        <span
          aria-hidden
          className="bg-work mx-1 h-2 w-2 flex-none rounded-full"
        />
      ) : (
        <Icon aria-hidden className="h-4 w-4 flex-none" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {call.verb}{" "}
        {call.target && (
          <span className="font-mono text-xs">{call.target}</span>
        )}
      </span>
      <span className="text-muted-foreground flex-none text-[13px] tabular-nums">
        {toolAge(call.at, call.running, now)}
      </span>
    </div>
  );
}

function ContextBar({
  tokens,
  limit,
}: {
  tokens: number;
  /** The model's context window; null when unknown */
  limit: number | null;
}) {
  const pct = limit ? Math.min(100, Math.round((tokens / limit) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-muted-foreground flex items-center justify-between text-[13px]">
        <span className="font-semibold">Context</span>
        <span className="tabular-nums">
          {limit
            ? `${shortTokens(tokens)} of ${shortTokens(limit)}`
            : formatTokens(tokens)}
        </span>
      </div>
      {limit ? (
        <div
          role="meter"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={tokens}
          className="bg-foreground/10 h-1.5 overflow-hidden rounded-[3px]"
        >
          <span
            className="bg-primary dark:bg-meter block h-full rounded-[3px]"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One agent in detail (O-Tree's right page, D-Tree's panel): the crumb,
 * its avatar, title and state line, "Asked to", the last four tool calls,
 * the files it wrote, the context bar, and Open transcript; Stop agent only
 * when the node has a stop API (workers, background agents), Message agent
 * (panel) only for a session it can open.
 */
export function AgentDetailPane({
  session,
  node,
  crumbs,
  variant,
  onOpenTranscript,
  onOpenSession,
  className,
}: {
  session: Session;
  node: TreeNode;
  /** crumbsFor(tree, node.id) */
  crumbs: string[];
  /** page: the open Duo's right page; panel: the desktop's right panel */
  variant: "page" | "panel";
  onOpenTranscript: (node: TreeNode) => void;
  /** Opens a fork's, handoff's or worker's own session */
  onOpenSession?: (sessionId: string) => void;
  className?: string;
}) {
  const { detail, isLoading } = useAgentDetail(
    session.id,
    hasDetail(node) ? node.agentId : null,
    true
  );
  const [stopping, setStopping] = useState(false);
  const now = Date.now();
  const panel = variant === "panel";

  const d: SubagentDetail | null = detail ?? null;
  const model = d?.model ?? node.model;
  const tokens = d?.tokens ?? node.tokens;
  const age = nodeAge(node, now);
  const stateLine = [
    model,
    age,
    !panel && tokens ? formatTokens(tokens) : null,
  ].filter(Boolean);
  const asked = d?.prompt ?? (hasDetail(node) ? null : node.subtitle);
  const files = d?.filesWritten ?? [];
  const sessionBacked = opensSession(node) && !!node.sessionId;
  const canTranscript = hasDetail(node) || sessionBacked;

  const stop = async () => {
    if (!node.stop || stopping) return;
    const ok = await confirmAction({
      title: `Stop ${node.title}?`,
      message:
        node.stop.kind === "worker"
          ? "The worker's session ends. Its changes stay in its folder."
          : "The background agent stops where it is.",
      confirmLabel: "Stop agent",
      destructive: true,
    });
    if (!ok) return;
    setStopping(true);
    try {
      await stopTreeNode(node.stop);
      toast(`Stopped ${node.title}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't stop it");
    } finally {
      setStopping(false);
    }
  };

  const stopButton = node.stop && (
    <button
      type="button"
      onClick={stop}
      disabled={stopping}
      className="pill pill-secondary flex-1 text-red-600 disabled:opacity-60 dark:text-[#FCA5A5]"
    >
      {stopping ? "Stopping…" : "Stop agent"}
    </button>
  );
  const transcriptButton = canTranscript && (
    <button
      type="button"
      onClick={() => onOpenTranscript(node)}
      className={cn("pill pill-primary", panel ? "w-full" : "flex-1")}
    >
      Open transcript
    </button>
  );
  const messageButton = panel && sessionBacked && onOpenSession && (
    <button
      type="button"
      onClick={() => onOpenSession(node.sessionId!)}
      className="pill pill-secondary flex-1"
    >
      Message agent
    </button>
  );

  return (
    <section
      aria-label="Selected agent"
      className={cn(
        "flex min-h-0 flex-col overflow-y-auto *:flex-none",
        panel ? "gap-4" : "gap-3",
        className
      )}
    >
      <Crumbs crumbs={crumbs} />

      <div className="flex items-center gap-3">
        <Avatar {...agentAvatar(node.agentType)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2
            className={cn(
              "truncate leading-tight font-bold",
              panel ? "text-lg font-semibold" : "text-xl"
            )}
          >
            {detailTitle(node, crumbs)}
          </h2>
          <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[13px]">
            <StateDot state={node.state} />
            <span className="truncate">
              <span
                className={cn("font-semibold", STATE_TEXT_CLASS[node.state])}
              >
                {STATE_WORD[node.state]}
              </span>
              {stateLine.length > 0 && ` · ${stateLine.join(" · ")}`}
            </span>
          </span>
        </div>
      </div>

      {asked && (
        <div className="bg-card flex flex-col gap-1 rounded-[20px] px-3.5 py-3">
          <span className="text-muted-foreground text-[13px] font-semibold">
            Asked to
          </span>
          <p className="line-clamp-6 text-sm leading-[1.45] text-[#3A3A3F] dark:text-[#E5E5EA]">
            {asked}
          </p>
        </div>
      )}

      {d && d.lastTools.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>
            {d.lastTools.length === 1
              ? "Last tool call"
              : `Last ${d.lastTools.length} tool calls`}
          </SectionLabel>
          <div className="tools">
            {d.lastTools.map((call, i) => (
              <ToolRow key={`${call.at}-${i}`} call={call} now={now} />
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Files it wrote</SectionLabel>
          {files.slice(0, MAX_FILES).map((file) => {
            const { name, dir } = splitPath(file.path);
            return (
              <div
                key={file.path}
                title={file.path}
                className="flex min-w-0 items-center gap-2 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  {name}
                </span>
                {dir && (
                  <span className="text-muted-foreground max-w-[45%] truncate">
                    {dir}
                  </span>
                )}
                {file.added > 0 && (
                  <span className="n-add flex-none font-mono">
                    +{file.added}
                  </span>
                )}
                {file.removed > 0 && (
                  <span className="n-del flex-none font-mono">
                    −{file.removed}
                  </span>
                )}
              </div>
            );
          })}
          {files.length > MAX_FILES && (
            <span className="text-muted-foreground text-[13px]">
              {files.length - MAX_FILES} more
            </span>
          )}
        </div>
      )}

      {tokens ? (
        <ContextBar tokens={tokens} limit={d?.contextWindow ?? null} />
      ) : null}

      {hasDetail(node) && isLoading && !d && (
        <p className="text-muted-foreground text-sm">Loading…</p>
      )}

      {panel ? (
        <div className="mt-auto flex flex-none flex-col gap-2 pt-2">
          {transcriptButton}
          {(messageButton || stopButton) && (
            <div className="flex gap-2">
              {messageButton}
              {stopButton}
            </div>
          )}
        </div>
      ) : (
        (stopButton || transcriptButton) && (
          <div className="mt-auto flex flex-none gap-2.5 pt-2">
            {stopButton}
            {transcriptButton}
          </div>
        )
      )}
    </section>
  );
}
