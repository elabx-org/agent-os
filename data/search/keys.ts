import type { SearchParams } from "@/lib/search/types";

export const searchKeys = {
  all: ["search"] as const,
  query: (params: SearchParams) =>
    [
      ...searchKeys.all,
      params.q,
      params.kind ?? "all",
      params.projectId ?? "",
      params.sessionId ?? "",
    ] as const,
};
