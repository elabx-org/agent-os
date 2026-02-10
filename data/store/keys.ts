export const storeKeys = {
  all: ["store"] as const,
  items: (params?: { type?: string; search?: string }) =>
    [...storeKeys.all, "items", params] as const,
  sources: () => [...storeKeys.all, "sources"] as const,
};
