import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cliStatusKeys } from "./keys";

export interface CliStatusMap {
  [providerId: string]: {
    installed: boolean;
  };
}

async function fetchCliStatus(): Promise<CliStatusMap> {
  const res = await fetch("/api/cli-status");
  if (!res.ok) throw new Error("Failed to fetch CLI status");
  return res.json();
}

export function useCliStatus() {
  return useQuery({
    queryKey: cliStatusKeys.status(),
    queryFn: fetchCliStatus,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useInstallCli() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (providerId: string) => {
      const res = await fetch("/api/cli-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Installation failed");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cliStatusKeys.all });
    },
  });
}
