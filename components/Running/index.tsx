"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  Copy,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  MonitorPlay,
  RotateCw,
} from "lucide-react";
import type { PageProps } from "@/components/WorkspacePage";
import { GroupCard, GroupRow } from "@/components/a/GroupCard";
import { shortAge } from "@/components/MissionControl/now-summary";
import {
  useSpreadFold,
  useSpreadPages,
} from "@/components/views/SessionSpread";
import { useIsNative } from "@/hooks/useIsNative";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { nativeCaps } from "@/lib/native-bridge";
import { registerPageBack, runNav } from "@/lib/nav-actions";
import type { RunningServer } from "@/lib/running";
import { cn } from "@/lib/utils";
import { workspacePageStore } from "@/stores/workspacePage";
import { canStop, useRunning, useStopServer } from "./data";

const POLL_MS = 3000;

/** Servers no session started: the user's own, the container's */
const OTHER = "Other";

/** The iframe's sandbox: the proxy's own CSP sandbox, never same-origin */
const FRAME_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-modals allow-downloads";

/** The last folder of a path */
function folderName(dir: string): string {
  return dir.split("/").filter(Boolean).pop() ?? dir;
}

/** Who started it, and how long ago: "started by Session 3 · 12m" */
function startedLine(s: RunningServer): string {
  const who = s.sessionName
    ? `started by ${s.sessionName}`
    : s.script
      ? `script ${s.script.scriptId}`
      : s.devServer
        ? `dev server ${s.devServer.name}`
        : s.cwd
          ? folderName(s.cwd)
          : s.name || "outside AgentOS";
  return s.startedAt ? `${who} · ${shortAge(s.startedAt)}` : who;
}

/**
 * M16's Running view: the servers sessions left running in the container,
 * each with a live preview through the port proxy. The closed Duo lists
 * them and pushes the preview; the open Duo keeps the list on the left
 * page and the preview on the right, nothing across the fold.
 */
export function RunningPage({ page, view }: PageProps<"running">) {
  const { data: servers, isLoading, error } = useRunning(POLL_MS);
  const ref = useRef<HTMLDivElement>(null);
  const pages = useSpreadPages(ref, useSpreadFold());
  // A chat card's Open preview comes with its server picked
  const [picked, setPicked] = useState<number | null>(page.port ?? null);
  const [pushed, setPushed] = useState(page.port !== undefined);
  // The open Duo's preview on both pages, the list put away
  const [full, setFull] = useState(false);

  // From a session's More: only what that session started
  const only = page.sessionId;
  const list = (servers ?? []).filter((s) => !only || s.sessionId === only);
  const sessionName = only
    ? (view.sessions.find((s) => s.id === only)?.name ?? "this session")
    : null;
  const current =
    list.find((s) => s.port === picked) ?? (pages ? list[0] : undefined);
  // Grouped by the project of what started each (N-Ports)
  const groupOf = (s: RunningServer) => {
    if (!canStop(s)) return OTHER;
    const project = view.projects.find((p) => p.id === s.projectId);
    return project && !project.is_uncategorized ? project.name : "Sessions";
  };

  // Back off a pushed preview to the list, before leaving the page
  useEffect(() => {
    if (pages || !pushed) return;
    return registerPageBack(() => {
      setPushed(false);
      return true;
    });
  }, [pages, pushed]);
  // Back off the expanded preview to the list beside it
  useEffect(() => {
    if (!pages || !full) return;
    return registerPageBack(() => {
      setFull(false);
      return true;
    });
  }, [pages, full]);
  // A server that stopped takes its preview with it
  useEffect(() => {
    if (pushed && servers && !current) setPushed(false);
  }, [pushed, servers, current]);

  const pick = (s: RunningServer) => {
    setPicked(s.port);
    if (!pages) setPushed(true);
  };

  const listView = (
    <ServerList
      servers={list}
      loading={isLoading}
      failed={!!error}
      selected={pages ? current?.port : undefined}
      sessionName={sessionName}
      groupOf={groupOf}
      onPick={pick}
    />
  );

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {pages ? (
        <div className="flex min-h-0 flex-1">
          {/* Hidden, not unmounted: the preview keeps its page */}
          {!full && (
            <>
              <aside
                className="flex shrink-0 flex-col"
                style={{ width: pages.left }}
              >
                {listView}
              </aside>
              <div aria-hidden="true" style={{ width: pages.gutter }} />
            </>
          )}
          <main className="flex min-w-0 flex-1 flex-col">
            {current ? (
              <Preview
                key={current.port}
                server={current}
                expanded={full}
                onExpand={() => setFull((f) => !f)}
              />
            ) : (
              <Quiet loading={isLoading} />
            )}
          </main>
        </div>
      ) : pushed && current ? (
        <Preview
          key={current.port}
          server={current}
          onBack={() => setPushed(false)}
        />
      ) : (
        listView
      )}
    </div>
  );
}

function ServerList({
  servers,
  loading,
  failed,
  selected,
  onPick,
  sessionName,
  groupOf,
}: {
  servers: RunningServer[];
  loading: boolean;
  failed: boolean;
  selected?: number;
  onPick: (s: RunningServer) => void;
  /** Filtered to one session: its name, and Show all */
  sessionName?: string | null;
  groupOf: (s: RunningServer) => string;
}) {
  // In the list's order (what sessions started first), Other last
  const groups: [string, RunningServer[]][] = [];
  for (const s of servers) {
    const name = groupOf(s);
    const group = groups.find(([g]) => g === name);
    if (group) group[1].push(s);
    else groups.push([name, [s]]);
  }
  groups.sort(([a], [b]) => Number(a === OTHER) - Number(b === OTHER));
  const fromSessions = servers.filter(canStop).length;
  const mode = useLayoutMode();
  const native = useIsNative();
  // Where no column holds back, the title does
  const back = native ? !nativeCaps().column : mode === "phone";
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
        mode === "duo-closed" ? "pt-[18px] pr-2 pl-5" : "px-5 pt-5"
      )}
    >
      {back && (
        <button
          type="button"
          onClick={() => runNav("back")}
          aria-label="Back"
          className="text-muted-foreground active:bg-accent -ml-2 flex h-[44px] w-[44px] items-center justify-center rounded-full"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <header className="flex shrink-0 flex-col">
        <h1 className="t-large">Running</h1>
        {!sessionName && servers.length > 0 && (
          <p className="text-muted-foreground mt-1 text-[14px]">
            {servers.length} {servers.length === 1 ? "port" : "ports"}
            {fromSessions > 0 && ` · ${fromSessions} started in AgentOS`}
          </p>
        )}
        {sessionName && (
          <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-2 text-[14px]">
            <span className="min-w-0 flex-1 truncate">
              Started by {sessionName}
            </span>
            <button
              type="button"
              onClick={() => {
                workspacePageStore.page = { kind: "running" };
              }}
              className="text-primary active:bg-accent min-h-[44px] shrink-0 rounded-full px-3 text-[15px] font-medium"
            >
              Show all
            </button>
          </div>
        )}
      </header>
      {failed ? (
        <p className="text-muted-foreground text-sm">
          Couldn&apos;t list what&apos;s running.
        </p>
      ) : servers.length ? (
        <div className="flex flex-col gap-4" aria-label="Servers">
          {groups.map(([name, list]) => (
            <section key={name} className="flex flex-col gap-2">
              {groups.length > 1 && (
                <h2 className="text-muted-foreground px-1 text-[13px] font-semibold">
                  {name}
                </h2>
              )}
              <GroupCard aria-label={name}>
                {list.map((s) => (
                  <GroupRow
                    key={s.port}
                    leading={
                      <span className="bg-primary/15 text-primary grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg">
                        <MonitorPlay className="h-4 w-4" />
                      </span>
                    }
                    title={
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="font-mono">:{s.port}</span>
                        <span className="text-muted-foreground truncate text-[13px]">
                          {s.name}
                        </span>
                      </span>
                    }
                    subtitle={startedLine(s)}
                    chevron={selected === undefined}
                    selected={selected === s.port}
                    onClick={() => onPick(s)}
                  />
                ))}
              </GroupCard>
            </section>
          ))}
        </div>
      ) : (
        <Quiet loading={loading} filtered={!!sessionName} />
      )}
    </div>
  );
}

function Quiet({
  loading,
  filtered,
}: {
  loading: boolean;
  filtered?: boolean;
}) {
  return (
    <div className="text-muted-foreground grid min-h-0 flex-1 place-items-center p-6 text-center text-sm">
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : filtered ? (
        "Nothing this session started is running."
      ) : (
        "Nothing is running. Servers a session starts show here."
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="text-muted-foreground active:bg-accent hover:bg-accent grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full"
    >
      {children}
    </button>
  );
}

/** One server's page: its address bar, the app itself, who started it */
function Preview({
  server,
  onBack,
  expanded,
  onExpand,
}: {
  server: RunningServer;
  /** The closed Duo's pushed preview: back to the list */
  onBack?: () => void;
  /** The open Duo: across both pages, the list put away */
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const [reload, setReload] = useState(0);
  const { stop: stopServer, stopping } = useStopServer();
  const absolute = () => new URL(server.url, window.location.href).toString();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absolute());
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-2">
        {onBack && (
          <IconButton label="Back to Running" onClick={onBack}>
            <ChevronLeft className="h-5 w-5" />
          </IconButton>
        )}
        <div
          className="bg-muted text-muted-foreground min-w-0 flex-1 truncate rounded-full px-3 py-2 font-mono text-[13px]"
          aria-label="Address"
        >
          {server.url}
        </div>
        <IconButton label="Reload" onClick={() => setReload((n) => n + 1)}>
          <RotateCw className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton
          label="Open in Safari"
          onClick={() => window.open(absolute(), "_blank", "noopener")}
        >
          <ExternalLink className="h-[18px] w-[18px]" />
        </IconButton>
        {onExpand && (
          <IconButton
            label={expanded ? "Show the list" : "Expand"}
            onClick={onExpand}
          >
            {expanded ? (
              <Minimize2 className="h-[18px] w-[18px]" />
            ) : (
              <Maximize2 className="h-[18px] w-[18px]" />
            )}
          </IconButton>
        )}
        <IconButton label="Copy link" onClick={copy}>
          <Copy className="h-[18px] w-[18px]" />
        </IconButton>
      </header>
      <iframe
        key={reload}
        src={server.url}
        title={`Preview of :${server.port}`}
        sandbox={FRAME_SANDBOX}
        className="border-border min-h-0 w-full flex-1 border-y bg-white"
      />
      <footer className="flex shrink-0 items-center gap-3 px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <p className="text-muted-foreground min-w-0 flex-1 truncate text-[13px]">
          {startedLine(server)}
          {server.pid ? ` · pid ${server.pid}` : ""}
        </p>
        {server.pid && canStop(server) && (
          <button
            type="button"
            onClick={() => stopServer(server)}
            disabled={stopping === server.port}
            className="text-destructive active:bg-accent hover:bg-accent min-h-[44px] shrink-0 rounded-full px-4 text-[15px] font-medium disabled:opacity-50"
          >
            {stopping === server.port ? "Stopping…" : "Stop"}
          </button>
        )}
      </footer>
    </div>
  );
}
