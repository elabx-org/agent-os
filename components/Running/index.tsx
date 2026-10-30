"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { confirmAction } from "@/components/ui/confirm";
import { shortAge } from "@/components/MissionControl/now-summary";
import {
  useSpreadFold,
  useSpreadPages,
} from "@/components/views/SessionSpread";
import { useIsNative } from "@/hooks/useIsNative";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import { nativeCaps } from "@/lib/native-bridge";
import { registerPageBack, runNav } from "@/lib/nav-actions";
import type { RunningServer } from "@/lib/running";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;

/** The iframe's sandbox: the proxy's own CSP sandbox, never same-origin */
const FRAME_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-modals allow-downloads";

function useRunning() {
  return useQuery({
    queryKey: ["running"],
    queryFn: async (): Promise<RunningServer[]> => {
      const res = await fetch("/api/running");
      if (!res.ok) throw new Error("Couldn't list what's running");
      return ((await res.json()) as { servers: RunningServer[] }).servers;
    },
    refetchInterval: POLL_MS,
  });
}

/** The last folder of a path */
function folderName(dir: string): string {
  return dir.split("/").filter(Boolean).pop() ?? dir;
}

/** Who started it, and how long ago: "started by Session 3 · 12m" */
function startedLine(s: RunningServer): string {
  const who = s.sessionName
    ? `started by ${s.sessionName}`
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
export function RunningPage(_props: PageProps<"running">) {
  const { data: servers, isLoading, error } = useRunning();
  const ref = useRef<HTMLDivElement>(null);
  const pages = useSpreadPages(ref, useSpreadFold());
  const [picked, setPicked] = useState<number | null>(null);
  const [pushed, setPushed] = useState(false);
  // The open Duo's preview on both pages, the list put away
  const [full, setFull] = useState(false);

  const list = servers ?? [];
  const current =
    list.find((s) => s.port === picked) ?? (pages ? list[0] : undefined);

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
}: {
  servers: RunningServer[];
  loading: boolean;
  failed: boolean;
  selected?: number;
  onPick: (s: RunningServer) => void;
}) {
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
      <h1 className="t-large">Running</h1>
      {failed ? (
        <p className="text-muted-foreground text-sm">
          Couldn&apos;t list what&apos;s running.
        </p>
      ) : servers.length ? (
        <GroupCard aria-label="Servers">
          {servers.map((s) => (
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
      ) : (
        <Quiet loading={loading} />
      )}
    </div>
  );
}

function Quiet({ loading }: { loading: boolean }) {
  return (
    <div className="text-muted-foreground grid min-h-0 flex-1 place-items-center p-6 text-center text-sm">
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
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
  const queryClient = useQueryClient();
  const [reload, setReload] = useState(0);
  const [stopping, setStopping] = useState(false);
  const absolute = () => new URL(server.url, window.location.href).toString();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absolute());
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const stop = async () => {
    if (!server.pid || !server.sessionId) return;
    const ok = await confirmAction({
      title: `Stop :${server.port}?`,
      message: server.command || server.name,
      confirmLabel: "Stop",
      destructive: true,
    });
    if (!ok) return;
    setStopping(true);
    try {
      const res = await fetchAsUser(`/api/running/${server.pid}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        toast.error(refusalText(body));
        return;
      }
      toast.success(`Stopped :${server.port}`);
      await queryClient.invalidateQueries({ queryKey: ["running"] });
    } finally {
      setStopping(false);
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
        {server.pid && server.sessionId && (
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            className="text-destructive active:bg-accent hover:bg-accent min-h-[44px] shrink-0 rounded-full px-4 text-[15px] font-medium disabled:opacity-50"
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
      </footer>
    </div>
  );
}
