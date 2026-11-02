"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Mock, MockChange } from "@/lib/mock-types";

const KEY = ["mocks"];

/** The mocks sessions published (/api/mocks) */
export function useMocks() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Mock[]> => {
      const res = await fetch("/api/mocks");
      if (!res.ok) throw new Error("Couldn't list mocks");
      return ((await res.json()) as { mocks: Mock[] }).mocks;
    },
    refetchInterval: 15_000,
  });
}

/** A status, PR or archive for some mocks, shown at once */
export function useChangeMocks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      urls,
      change,
    }: {
      urls: string[];
      change: MockChange;
    }) => {
      const res = await fetch("/api/mocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, ...change }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Couldn't change it");
      }
    },
    onMutate: async ({ urls, change }) => {
      await client.cancelQueries({ queryKey: KEY });
      const before = client.getQueryData<Mock[]>(KEY);
      client.setQueryData<Mock[]>(KEY, (list) =>
        list?.map((m) =>
          urls.includes(m.url)
            ? {
                ...m,
                ...(change.status
                  ? {
                      status: change.status,
                      statusBy: "user",
                      statusNote: change.note ?? null,
                    }
                  : {}),
                ...(change.pr !== undefined ? { pr: change.pr } : {}),
                ...(change.archived !== undefined
                  ? { archived: change.archived }
                  : {}),
              }
            : m
        )
      );
      return { before };
    },
    onError: (error, _vars, context) => {
      if (context?.before) client.setQueryData(KEY, context.before);
      toast.error(
        error instanceof Error ? error.message : "Couldn't change it"
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });
}
