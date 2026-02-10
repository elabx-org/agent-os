import { useState, useCallback, useEffect } from "react";
import type { McpServerConfig } from "../ClaudeConfigDialog.types";

export type McpScope = "user" | "local";

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  scope: McpScope;
}

interface UseMcpConfigOptions {
  open: boolean;
  projectPath?: string;
}

async function claudeMcpAdd(
  name: string,
  config: McpServerConfig,
  scope: McpScope
): Promise<{ success: boolean; output: string }> {
  const res = await fetch("/api/claude-cli", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "mcp-add",
      args: {
        name,
        scope,
        command: config.command,
        cmdArgs: config.args,
        env: config.env,
      },
    }),
  });
  return res.json();
}

async function claudeMcpRemove(
  name: string,
  scope: McpScope
): Promise<{ success: boolean; output: string }> {
  const res = await fetch("/api/claude-cli", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "mcp-remove",
      args: { name, scope },
    }),
  });
  return res.json();
}

interface ClaudeJsonMcpEntry {
  type?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

function parseEntry(
  name: string,
  raw: ClaudeJsonMcpEntry,
  scope: McpScope
): McpServerEntry {
  return {
    name,
    config: {
      command: raw.command || "",
      args: raw.args,
      cwd: raw.cwd,
      env: raw.env,
    },
    scope,
  };
}

async function readServers(projectPath?: string): Promise<McpServerEntry[]> {
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent("~/.claude.json")}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (data.isBinary || !data.content) return [];
    const parsed = JSON.parse(data.content);
    const entries: McpServerEntry[] = [];
    const seen = new Set<string>();

    // User-scope servers (root mcpServers)
    if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
      for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
        entries.push(parseEntry(name, cfg as ClaudeJsonMcpEntry, "user"));
        seen.add(name);
      }
    }

    // Local-scope servers: scan the active project first, then all other projects
    if (parsed.projects && typeof parsed.projects === "object") {
      // Active project first so its entries take priority
      const projectKeys = Object.keys(parsed.projects);
      if (projectPath) {
        projectKeys.sort((a, b) =>
          a === projectPath ? -1 : b === projectPath ? 1 : 0
        );
      }

      for (const key of projectKeys) {
        const proj = parsed.projects[key];
        if (!proj?.mcpServers || typeof proj.mcpServers !== "object") continue;
        for (const [name, cfg] of Object.entries(
          proj.mcpServers as Record<string, ClaudeJsonMcpEntry>
        )) {
          if (!seen.has(name)) {
            entries.push(parseEntry(name, cfg, "local"));
            seen.add(name);
          }
        }
      }
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  } catch {
    return [];
  }
}

// The `claude mcp add` CLI doesn't support a cwd flag,
// so we patch .claude.json directly after adding.
async function patchCwd(
  name: string,
  cwd: string,
  scope: McpScope,
  projectPath?: string
): Promise<void> {
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent("~/.claude.json")}`
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.isBinary || !data.content) return;
    const parsed = JSON.parse(data.content);

    if (scope === "user" && parsed.mcpServers?.[name]) {
      parsed.mcpServers[name].cwd = cwd;
    } else if (
      scope === "local" &&
      projectPath &&
      parsed.projects?.[projectPath]?.mcpServers?.[name]
    ) {
      parsed.projects[projectPath].mcpServers[name].cwd = cwd;
    } else {
      return;
    }

    await fetch("/api/files/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "~/.claude.json",
        content: JSON.stringify(parsed, null, 2),
      }),
    });
  } catch {
    // non-fatal
  }
}

export function useMcpConfig({ open, projectPath }: UseMcpConfigOptions) {
  const [loading, setLoading] = useState(false);
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const entries = await readServers(projectPath);
      if (cancelled) return;
      setServers(entries);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey, projectPath]);

  const saveServer = useCallback(
    async (
      name: string,
      config: McpServerConfig,
      scope: McpScope = "user"
    ) => {
      // Remove existing if present (handles edits)
      const existing = servers.find((s) => s.name === name);
      if (existing) {
        await claudeMcpRemove(name, existing.scope);
      }

      // Add via CLI
      const result = await claudeMcpAdd(name, config, scope);

      if (!result.success) {
        throw new Error(result.output || "Failed to add MCP server");
      }

      // Patch cwd if needed (CLI doesn't support cwd flag)
      if (config.cwd) {
        await patchCwd(name, config.cwd, scope, projectPath);
      }

      refresh();
    },
    [servers, projectPath, refresh]
  );

  const deleteServer = useCallback(
    async (name: string) => {
      const existing = servers.find((s) => s.name === name);
      const scope = existing?.scope || "user";
      await claudeMcpRemove(name, scope);
      refresh();
    },
    [servers, refresh]
  );

  return { loading, servers, saveServer, deleteServer, refresh };
}
