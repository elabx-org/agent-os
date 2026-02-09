"use client";

import { useState, useCallback } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMcpConfig, type McpScope } from "./hooks/useMcpConfig";
import { McpServerEditor } from "./McpServerEditor";
import type { McpServerConfig } from "./ClaudeConfigDialog.types";

interface McpServersTabProps {
  open: boolean;
  projectPath?: string;
}

export function McpServersTab({ open, projectPath }: McpServersTabProps) {
  const mcp = useMcpConfig({ open, projectPath });
  const [editingServer, setEditingServer] = useState<string | null>(null); // name or "__new__"

  const handleSave = useCallback(
    async (name: string, config: McpServerConfig, scope: McpScope) => {
      await mcp.saveServer(name, config, scope);
    },
    [mcp]
  );

  const handleBack = useCallback(() => {
    setEditingServer(null);
  }, []);

  if (mcp.loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  // Editing view
  if (editingServer !== null) {
    const existing = editingServer !== "__new__"
      ? mcp.servers.find((s) => s.name === editingServer)
      : undefined;

    return (
      <McpServerEditor
        name={existing?.name}
        config={existing?.config}
        scope={existing?.scope}
        onSave={handleSave}
        onBack={handleBack}
      />
    );
  }

  // List view
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          MCP Servers
        </span>
        <span className="text-muted-foreground text-xs">
          (via claude mcp)
        </span>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setEditingServer("__new__")}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Server
        </Button>
      </div>

      {mcp.servers.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-xs">
          No MCP servers configured
        </p>
      )}

      <div className="space-y-1">
        {mcp.servers.map((server) => {
          const argsPreview = server.config.args?.join(" ") || "";
          const envCount = server.config.env
            ? Object.keys(server.config.env).length
            : 0;

          return (
            <div
              key={server.name}
              className="hover:bg-accent group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition-colors"
              onClick={() => setEditingServer(server.name)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {server.name}
                  </span>
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] ${
                      server.scope === "user"
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-amber-500/10 text-amber-400"
                    }`}
                  >
                    {server.scope}
                  </span>
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {server.config.command}
                  {argsPreview ? ` ${argsPreview}` : ""}
                </div>
                {envCount > 0 && (
                  <span className="text-muted-foreground text-[10px]">
                    {envCount} env var{envCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Delete */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete MCP server "${server.name}"?`)) {
                    mcp.deleteServer(server.name);
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
