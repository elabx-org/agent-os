import { useState, useCallback, useEffect } from "react";
import type { McpServerConfig, McpConfigFile } from "../ClaudeConfigDialog.types";

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  disabled: boolean;
}

interface UseMcpConfigOptions {
  open: boolean;
}

async function readMcpConfig(): Promise<McpConfigFile> {
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent("~/.claude/mcp.json")}`
    );
    if (!res.ok) return { mcpServers: {} };
    const data = await res.json();
    if (data.isBinary || !data.content) return { mcpServers: {} };
    const parsed = JSON.parse(data.content);
    if (!parsed.mcpServers) parsed.mcpServers = {};
    return parsed;
  } catch {
    return { mcpServers: {} };
  }
}

async function writeMcpConfig(config: McpConfigFile): Promise<boolean> {
  await fetch("/api/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "mkdir -p ~/.claude" }),
  });
  const res = await fetch("/api/files/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "~/.claude/mcp.json",
      content: JSON.stringify(config, null, 2),
    }),
  });
  return res.ok;
}

export function useMcpConfig({ open }: UseMcpConfigOptions) {
  const [loading, setLoading] = useState(false);
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const config = await readMcpConfig();
      if (cancelled) return;

      const entries: McpServerEntry[] = [];

      for (const [name, cfg] of Object.entries(config.mcpServers)) {
        entries.push({ name, config: cfg, disabled: false });
      }

      if (config._disabledServers) {
        for (const [name, cfg] of Object.entries(config._disabledServers)) {
          entries.push({ name, config: cfg, disabled: true });
        }
      }

      entries.sort((a, b) => a.name.localeCompare(b.name));
      setServers(entries);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  const saveServer = useCallback(
    async (name: string, config: McpServerConfig) => {
      const file = await readMcpConfig();
      file.mcpServers[name] = config;
      // Remove from disabled if it was there
      if (file._disabledServers?.[name]) {
        delete file._disabledServers[name];
      }
      await writeMcpConfig(file);
      refresh();
    },
    [refresh]
  );

  const deleteServer = useCallback(
    async (name: string) => {
      const file = await readMcpConfig();
      delete file.mcpServers[name];
      if (file._disabledServers) {
        delete file._disabledServers[name];
      }
      await writeMcpConfig(file);
      refresh();
    },
    [refresh]
  );

  const toggleServer = useCallback(
    async (name: string, disable: boolean) => {
      const file = await readMcpConfig();

      if (disable) {
        // Move from mcpServers → _disabledServers
        const cfg = file.mcpServers[name];
        if (cfg) {
          if (!file._disabledServers) file._disabledServers = {};
          file._disabledServers[name] = cfg;
          delete file.mcpServers[name];
        }
      } else {
        // Move from _disabledServers → mcpServers
        const cfg = file._disabledServers?.[name];
        if (cfg) {
          file.mcpServers[name] = cfg;
          delete file._disabledServers![name];
        }
      }

      await writeMcpConfig(file);
      refresh();
    },
    [refresh]
  );

  return { loading, servers, saveServer, deleteServer, toggleServer, refresh };
}
