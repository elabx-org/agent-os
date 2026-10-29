export const projectKeys = {
  all: ["projects"] as const,
  list: () => [...projectKeys.all, "list"] as const,
  mergedToday: (projectId: string) =>
    [...projectKeys.all, "mergedToday", projectId] as const,
};
