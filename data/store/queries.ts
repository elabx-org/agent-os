import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type { StoreItem, StoreSource } from "@/lib/db/types";
import { storeKeys } from "./keys";

interface StoreResponse {
  items: StoreItem[];
  total: number;
  syncStatus: {
    syncing: boolean;
    lastSynced: string | null;
    counts: { skills: number; agents: number; mcps: number };
  };
}

interface SourcesResponse {
  sources: StoreSource[];
}

async function fetchStoreItems(params?: {
  type?: string;
  search?: string;
}): Promise<StoreResponse> {
  const sp = new URLSearchParams();
  if (params?.type) sp.set("type", params.type);
  if (params?.search) sp.set("search", params.search);
  const res = await fetch(`/api/store?${sp}`);
  if (!res.ok) throw new Error("Failed to fetch store");
  return res.json();
}

async function fetchStoreSources(): Promise<SourcesResponse> {
  const res = await fetch("/api/store/sources");
  if (!res.ok) throw new Error("Failed to fetch store sources");
  return res.json();
}

export function useStoreItems(params?: { type?: string; search?: string }) {
  return useQuery({
    queryKey: storeKeys.items(params),
    queryFn: () => fetchStoreItems(params),
    staleTime: 30000,
    placeholderData: keepPreviousData,
  });
}

export function useStoreSources() {
  return useQuery({
    queryKey: storeKeys.sources(),
    queryFn: fetchStoreSources,
    staleTime: 30000,
  });
}

export function useSyncStore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/store/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to trigger sync");
      return res.json();
    },
    onSuccess: () => {
      // Invalidate after a delay to let sync start
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: storeKeys.all });
      }, 2000);
    },
  });
}

export function useAddStoreSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (source: {
      repo: string;
      type: "skill" | "agent";
      label?: string;
      branch?: string;
    }) => {
      const res = await fetch("/api/store/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source),
      });
      if (!res.ok) throw new Error("Failed to add source");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storeKeys.all });
    },
  });
}

export function useRemoveStoreSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/store/sources?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove source");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storeKeys.all });
    },
  });
}
