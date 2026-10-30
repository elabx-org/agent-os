"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { confirmAction } from "@/components/ui/confirm";
import { fetchAsUser, refusalText } from "@/lib/client/user-fetch";
import type { RunningServer } from "@/lib/running";

/** What runs in the container (/api/running), every `pollMs` */
export function useRunning(pollMs: number, enabled = true) {
  return useQuery({
    queryKey: ["running"],
    queryFn: async (): Promise<RunningServer[]> => {
      const res = await fetch("/api/running");
      if (!res.ok) throw new Error("Couldn't list what's running");
      return ((await res.json()) as { servers: RunningServer[] }).servers;
    },
    refetchInterval: pollMs,
    enabled,
  });
}

/** Stop, after asking: only what a session started (the server says so too) */
export function useStopServer() {
  const queryClient = useQueryClient();
  const [stopping, setStopping] = useState<number | null>(null);
  const stop = async (server: RunningServer) => {
    if (!server.pid || !server.sessionId) return;
    const ok = await confirmAction({
      title: `Stop :${server.port}?`,
      message: server.command || server.name,
      confirmLabel: "Stop",
      destructive: true,
    });
    if (!ok) return;
    setStopping(server.port);
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
      setStopping(null);
    }
  };
  return { stop, stopping };
}
