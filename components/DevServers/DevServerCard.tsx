"use client";

import { useState } from "react";
import {
  Play,
  Square,
  RefreshCw,
  FileText,
  Trash2,
  Copy,
  Globe,
  MoreHorizontal,
} from "lucide-react";
import { afterMenuCloses, cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useViewport } from "@/hooks/useViewport";
import { useProxyUrl } from "@/hooks/useProxyConfig";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentRow } from "@/components/rows/AgentRow";
import {
  fromDevServerStatus,
  timeAgo,
  type AgentState,
} from "@/lib/agent-state";
import type { DevServer } from "@/lib/db";

interface DevServerCardProps {
  server: DevServer;
  projectName?: string;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRestart: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onViewLogs: (id: string) => void;
}

function primaryPortOf(server: DevServer): number | undefined {
  try {
    return (JSON.parse(server.ports || "[]") as number[])[0];
  } catch {
    return undefined;
  }
}

/** A stopped server reads "Stopped · <command>" rather than "Idle" */
function rowState(server: DevServer): AgentState {
  return server.status === "stopped"
    ? "stopped"
    : fromDevServerStatus(server.status);
}

// ":3099 · running 2h", or "npm run dev" when there's no port to show
function rowDetail(server: DevServer, port: number | undefined) {
  const portPart = port ? `:${port}` : null;
  switch (server.status) {
    case "running": {
      // updated_at is when it last changed status, i.e. when it came up
      const since = timeAgo(server.updated_at, { dateAfterDays: Infinity });
      const uptime =
        since === "just now" ? "just started" : since.replace(/ ago$/, "");
      return [portPart, `running ${uptime}`].filter(Boolean).join(" · ");
    }
    case "starting":
      return [portPart, "starting"].filter(Boolean).join(" · ");
    default:
      return server.command;
  }
}

const typeLabel = (server: DevServer) =>
  server.type === "docker" ? "Docker" : "Node";

/** The 32px buttons keep their size and reach 44px under a finger */
const TOUCH_HIT =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 pointer-coarse:after:content-['']";

function OpenButton({ port }: { port: number }) {
  const urlOf = useProxyUrl();
  return (
    <Button
      asChild
      variant="secondary"
      size="sm"
      className={cn("h-8", TOUCH_HIT)}
    >
      <a
        href={urlOf(port)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        <Globe className="h-3.5 w-3.5" />
        Open
      </a>
    </Button>
  );
}

function StartButton({
  onStart,
  disabled,
}: {
  onStart: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className={cn("text-primary h-8", TOUCH_HIT)}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onStart();
      }}
    >
      <Play className="h-3.5 w-3.5" />
      Start
    </Button>
  );
}

/** Open when it's up, Start when it's down; nothing while it's starting */
function primaryAction(
  server: DevServer,
  port: number | undefined,
  onStart: (() => void) | undefined,
  disabled: boolean
) {
  if (server.status === "running")
    return port ? <OpenButton port={port} /> : null;
  if ((server.status === "stopped" || server.status === "failed") && onStart)
    return <StartButton onStart={onStart} disabled={disabled} />;
  return null;
}

/**
 * A dev server on the shared row: Open or Start on the row, everything else
 * (Stop, Restart, Logs, Copy URL, Remove) under ⋯, a sheet on touch.
 */
export function DevServerCard({
  server,
  projectName,
  onStart,
  onStop,
  onRestart,
  onRemove,
  onViewLogs,
}: DevServerCardProps) {
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { isTouch } = useViewport();
  const { copy } = useCopyToClipboard();
  const urlOf = useProxyUrl();

  const port = primaryPortOf(server);
  const isRunning = server.status === "running";
  const canRemove = server.status === "stopped" || server.status === "failed";

  const handleAction = async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
    } finally {
      setLoading(false);
    }
  };

  const stop = async () => {
    const ok = await confirmAction({
      title: `Stop ${server.name}?`,
      confirmLabel: "Stop",
      destructive: true,
    });
    if (ok) handleAction(() => onStop(server.id));
  };
  const restart = () => handleAction(() => onRestart(server.id));
  const remove = () => handleAction(() => onRemove(server.id));
  const logs = () => onViewLogs(server.id);
  const copyUrl = () => port && copy(urlOf(port));

  const sheetGroups: SheetAction[][] = [
    isRunning
      ? [
          { label: "Restart", icon: RefreshCw, onSelect: restart },
          ...(port
            ? [{ label: "Copy URL", icon: Copy, onSelect: copyUrl }]
            : []),
        ]
      : [],
    [{ label: "Logs", icon: FileText, onSelect: logs }],
    [
      ...(isRunning
        ? [{ label: "Stop", icon: Square, onSelect: stop, destructive: true }]
        : []),
      ...(canRemove
        ? [
            {
              label: "Remove",
              icon: Trash2,
              onSelect: remove,
              destructive: true,
            },
          ]
        : []),
    ],
  ].map((group) => group.map((a) => ({ ...a, disabled: loading })));

  const more = isTouch ? (
    <Button
      variant="ghost"
      size="icon-sm"
      className={TOUCH_HIT}
      aria-label="Server actions"
      disabled={loading}
      onClick={(e) => {
        e.stopPropagation();
        setSheetOpen(true);
      }}
    >
      <MoreHorizontal className="h-4 w-4" />
    </Button>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Server actions"
          disabled={loading}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isRunning && (
          <DropdownMenuItem onSelect={restart}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Restart
          </DropdownMenuItem>
        )}
        {isRunning && !!port && (
          <DropdownMenuItem onSelect={copyUrl}>
            <Copy className="mr-2 h-3 w-3" />
            Copy URL
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={logs}>
          <FileText className="mr-2 h-3 w-3" />
          Logs
        </DropdownMenuItem>
        {(isRunning || canRemove) && <DropdownMenuSeparator />}
        {isRunning && (
          <DropdownMenuItem
            onSelect={() => afterMenuCloses(stop)}
            className="text-red-500 focus:text-red-500"
          >
            <Square className="mr-2 h-3 w-3" />
            Stop
          </DropdownMenuItem>
        )}
        {canRemove && (
          <DropdownMenuItem
            onSelect={remove}
            className="text-red-500 focus:text-red-500"
          >
            <Trash2 className="mr-2 h-3 w-3" />
            Remove
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <AgentRow
        as="div"
        kind="dev"
        state={rowState(server)}
        title={server.name}
        project={projectName}
        detail={`${rowDetail(server, port)} · ${typeLabel(server)}`}
        dense
        trailing={
          <span className="flex items-center gap-1">
            {primaryAction(
              server,
              port,
              () => handleAction(() => onStart(server.id)),
              loading
            )}
            {more}
          </span>
        }
      />
      {isTouch && (
        <ActionSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={server.name}
          description={[typeLabel(server), port && `:${port}`]
            .filter(Boolean)
            .join(" · ")}
          groups={sheetGroups}
        />
      )}
    </>
  );
}

/**
 * The home's dev-server row: just Open or Start; the full set of actions
 * lives on DevServerCard in the project list.
 */
export function DevServerRow({
  server,
  projectName,
  onStart,
  dense,
  selected,
  className,
}: {
  server: DevServer;
  projectName?: string;
  onStart?: (id: string) => Promise<void>;
  dense?: boolean;
  selected?: boolean;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const port = primaryPortOf(server);
  const start = onStart
    ? async () => {
        setLoading(true);
        try {
          await onStart(server.id);
        } finally {
          setLoading(false);
        }
      }
    : undefined;

  return (
    <AgentRow
      as="div"
      kind="dev"
      state={rowState(server)}
      title={server.name}
      project={projectName}
      detail={rowDetail(server, port)}
      dense={dense}
      selected={selected}
      className={className}
      trailing={primaryAction(server, port, start, loading)}
    />
  );
}
