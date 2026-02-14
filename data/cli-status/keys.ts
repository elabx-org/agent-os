export const cliStatusKeys = {
  all: ["cli-status"] as const,
  status: () => [...cliStatusKeys.all, "status"] as const,
};
