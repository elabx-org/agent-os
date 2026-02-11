"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { pluginKeys } from "./keys";

export interface PluginInfo {
  name: string;
  description: string;
  author: string;
  marketplace: string;
  type: "internal" | "external";
  installed: boolean;
  enabled: boolean;
  version?: string;
  scope?: string;
  hasCommands: boolean;
  hasSkills: boolean;
  hasAgents: boolean;
  hasMcp: boolean;
  repository?: string;
  keywords?: string[];
}

interface PluginsResponse {
  plugins: PluginInfo[];
  marketplaces: { name: string; source: string; repo: string }[];
}

async function fetchPlugins(): Promise<PluginsResponse> {
  const res = await fetch("/api/plugins");
  if (!res.ok) throw new Error("Failed to fetch plugins");
  return res.json();
}

export function usePlugins() {
  return useQuery({
    queryKey: pluginKeys.list(),
    queryFn: fetchPlugins,
    staleTime: 30000,
  });
}

export function usePluginAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      action,
    }: {
      name: string;
      action: "install" | "uninstall" | "enable" | "disable" | "update";
    }) => {
      const res = await fetch(`/api/plugins/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${action} plugin`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}

export function useSyncMarketplaces() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/plugins/sync", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to sync marketplaces");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}
