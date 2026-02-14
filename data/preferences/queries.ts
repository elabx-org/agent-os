import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { preferencesKeys } from "./keys";

async function fetchPreference<T>(key: string): Promise<T | null> {
  const res = await fetch(`/api/preferences?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error("Failed to fetch preference");
  const data = await res.json();
  return data.value;
}

export function usePreference<T>(key: string, defaultValue: T) {
  return useQuery({
    queryKey: preferencesKeys.detail(key),
    queryFn: () => fetchPreference<T>(key),
    staleTime: Infinity,
    select: (data) => data ?? defaultValue,
  });
}

export function useUpdatePreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error("Failed to save preference");
      return res.json();
    },
    onMutate: async ({ key, value }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: preferencesKeys.detail(key) });
      const previous = queryClient.getQueryData(preferencesKeys.detail(key));
      queryClient.setQueryData(preferencesKeys.detail(key), value);
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context) {
        queryClient.setQueryData(
          preferencesKeys.detail(context.key),
          context.previous
        );
      }
    },
  });
}
