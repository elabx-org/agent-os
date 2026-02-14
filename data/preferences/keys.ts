export const preferencesKeys = {
  all: ["preferences"] as const,
  detail: (key: string) => [...preferencesKeys.all, key] as const,
};
