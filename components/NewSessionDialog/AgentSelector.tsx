"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  Check,
  Download,
  Ellipsis,
  Loader2,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentType } from "@/lib/providers";
import { getProviderDefinition } from "@/lib/providers/registry";
import { useCliStatus, useInstallCli } from "@/data/cli-status";
import {
  Avatar,
  agentAvatar,
  agentName,
  type AvatarTone,
} from "@/components/a/Avatar";

/** E-New's 4x2 grid: these seven, then More for the rest */
const GRID_AGENTS: AgentType[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "minimax",
  "shell",
];

/** D-New's one row: every agent */
const ROW_AGENTS: AgentType[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "minimax",
  "aider",
  "cline",
  "shell",
];

/** What More reveals */
const MORE_AGENTS = ROW_AGENTS.filter((a) => !GRID_AGENTS.includes(a));

// The mocks' tiles: agents without a tone of their own get theirs here
const TILE: Partial<
  Record<
    AgentType,
    { tone?: AvatarTone; className?: string; icon?: LucideIcon }
  >
> = {
  opencode: { tone: "green" },
  minimax: { tone: "pink" },
  cursor: {
    className: "bg-[#E5E5EA] text-[#3A3A3F] dark:bg-[#222] dark:text-[#E5E5EA]",
  },
  aider: {
    className:
      "bg-[#F8EDD3] text-[#8A6414] dark:bg-[#262014] dark:text-[#E8C77A]",
  },
  cline: {
    className:
      "bg-[#DCEBF8] text-[#245F8F] dark:bg-[#14202A] dark:text-[#7FB8E8]",
  },
  shell: { icon: Terminal },
};

function AgentTile({
  agent,
  selected,
  installed,
  onPick,
}: {
  agent: AgentType;
  selected: boolean;
  installed: boolean;
  onPick: () => void;
}) {
  const { label, tone } = agentAvatar(agent);
  const tile = TILE[agent];
  const name = agentName(agent);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={installed ? undefined : `${name} (not installed)`}
      onClick={onPick}
      className={cn("pick min-w-0", selected && "on")}
    >
      <Avatar
        size="sm"
        label={label}
        tone={tile?.tone ?? tone}
        icon={tile?.icon}
        className={cn(tile?.className, !installed && "opacity-50")}
      />
      <span className={cn("max-w-full truncate", !installed && "opacity-60")}>
        {name}
      </span>
    </button>
  );
}

interface AgentSelectorProps {
  value: AgentType;
  onChange: (value: AgentType) => void;
  /** grid: E-New's 4x2 with More; row: D-New's nine in a line */
  layout?: "grid" | "row";
}

/**
 * New's agent tiles (.pick). An agent that isn't installed can still be
 * picked, and says so under the tiles with its install button
 */
export function AgentSelector({
  value,
  onChange,
  layout = "grid",
}: AgentSelectorProps) {
  const { data: cliStatus, isLoading: statusLoading } = useCliStatus();
  const installCli = useInstallCli();
  const [moreOpen, setMoreOpen] = useState(false);

  const selectedProvider = getProviderDefinition(value);
  const isInstalled = cliStatus?.[value]?.installed ?? true;
  const hasInstallCommand = !!selectedProvider.installCommand;

  const pick = (agent: AgentType) => {
    installCli.reset();
    onChange(agent);
  };

  const grid = layout === "grid";
  // The choice always shows: More stays open while one of its agents is it
  const more = grid && (moreOpen || MORE_AGENTS.includes(value));
  const agents = grid
    ? [...GRID_AGENTS, ...(more ? MORE_AGENTS : [])]
    : ROW_AGENTS;

  const tile = (agent: AgentType) => (
    <AgentTile
      key={agent}
      agent={agent}
      selected={agent === value}
      // Unknown until the status comes: shown as installed
      installed={statusLoading || cliStatus?.[agent]?.installed !== false}
      onPick={() => pick(agent)}
    />
  );

  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Agent"
        className={cn(
          "grid",
          // Nine across 720px leave ~62px of label: "OpenCode" needs the
          // tile's side padding and a hair less tracking (D-New)
          grid
            ? "grid-cols-4 gap-2"
            : "grid-cols-9 gap-1.5 [&>.pick]:px-0.5 [&>.pick]:tracking-[-0.01em]"
        )}
      >
        {agents.slice(0, grid ? 7 : agents.length).map(tile)}
        {grid && (
          <button
            type="button"
            aria-pressed={more}
            aria-label={`More agents: ${MORE_AGENTS.map(agentName).join(", ")}`}
            onClick={() => setMoreOpen(!more)}
            disabled={MORE_AGENTS.includes(value)}
            // Pressed is the open list, not a choice: no .on look
            className="pick min-w-0 aria-pressed:border-transparent aria-pressed:bg-[hsl(var(--card))]"
          >
            <Avatar size="sm" label="···" tone="shell" icon={Ellipsis} />
            <span className="max-w-full truncate">
              {more ? "Less" : "More"}
            </span>
          </button>
        )}
        {grid && agents.slice(7).map(tile)}
      </div>

      {!statusLoading && !isInstalled && (
        <div className="flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-yellow-500" />
          <span className="text-muted-foreground flex-1">
            {selectedProvider.name} is not installed.
          </span>
          {hasInstallCommand && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={installCli.isPending}
              onClick={() => installCli.mutate(value)}
            >
              {installCli.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="mr-1 h-3 w-3" />
                  Install
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {installCli.isSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-400">
          <Check className="h-4 w-4 shrink-0" />
          {selectedProvider.name} installed successfully.
        </div>
      )}

      {installCli.isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
          Installation failed: {installCli.error?.message}
        </div>
      )}
    </div>
  );
}
