export const pluginKeys = {
  all: ["plugins"] as const,
  list: () => [...pluginKeys.all, "list"] as const,
};
