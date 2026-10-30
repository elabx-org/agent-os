import { useQuery } from "@tanstack/react-query";

export interface RecentImage {
  path: string;
  size: number;
  mtime: number;
}

/** The newest pictures uploaded from the app (app/api/files/recent-images) */
export function useRecentImages(enabled = true, limit = 12) {
  return useQuery({
    queryKey: ["recent-images", limit],
    queryFn: async (): Promise<RecentImage[]> => {
      const res = await fetch(`/api/files/recent-images?limit=${limit}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { images?: RecentImage[] };
      return data.images ?? [];
    },
    enabled,
    staleTime: 15_000,
  });
}
