"use client";

import { useState, useCallback } from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { McpServerConfig } from "./ClaudeConfigDialog.types";

interface EnvVarSpec {
  name: string;
  description: string;
  isRequired: boolean;
  isSecret?: boolean;
  defaultValue?: string;
}

interface McpInstallFormProps {
  serverName: string;
  registryType: "npm" | "pypi";
  packageIdentifier: string;
  envVars: EnvVarSpec[];
  onInstall: (name: string, config: McpServerConfig) => Promise<void>;
  onCancel: () => void;
  installing: boolean;
}

// Install an MCP server via the claude-cli API
export async function installMcpServer(
  name: string,
  config: McpServerConfig
): Promise<boolean> {
  const res = await fetch("/api/claude-cli", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "mcp-add",
      args: {
        name,
        scope: "user",
        command: config.command,
        cmdArgs: config.args,
        env: config.env,
      },
    }),
  });
  const data = await res.json();
  return data.success;
}

export function McpInstallForm({
  serverName: defaultName,
  registryType,
  packageIdentifier,
  envVars,
  onInstall,
  onCancel,
  installing,
}: McpInstallFormProps) {
  const [name, setName] = useState(defaultName);
  const [envValues, setEnvValues] = useState<Record<string, string>>(() => {
    const vals: Record<string, string> = {};
    for (const v of envVars) {
      vals[v.name] = v.defaultValue || "";
    }
    return vals;
  });
  const [showOptional, setShowOptional] = useState(false);

  const requiredVars = envVars.filter((v) => v.isRequired);
  const optionalVars = envVars.filter((v) => !v.isRequired);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName) return;

      // Build config
      const config: McpServerConfig = {
        command: registryType === "npm" ? "npx" : "uvx",
        args:
          registryType === "npm"
            ? ["-y", packageIdentifier]
            : [packageIdentifier],
      };

      // Add env vars
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(envValues)) {
        if (value.trim()) env[key] = value.trim();
      }
      if (Object.keys(env).length > 0) config.env = env;

      await onInstall(trimmedName, config);
    },
    [name, registryType, packageIdentifier, envValues, onInstall]
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="border-primary/20 bg-primary/5 space-y-2 rounded-lg border p-3"
    >
      <div className="text-xs font-medium">
        Install: {packageIdentifier}
      </div>

      {/* Server name */}
      <div>
        <label className="text-muted-foreground mb-0.5 block text-[10px]">
          Server name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 text-xs"
          disabled={installing}
        />
      </div>

      {/* Required env vars */}
      {requiredVars.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-muted-foreground text-[10px] font-medium">
            Required
          </span>
          {requiredVars.map((v) => (
            <div key={v.name}>
              <label className="text-muted-foreground mb-0.5 block text-[10px]">
                {v.name}
                {v.description && (
                  <span className="ml-1 font-normal opacity-70">
                    — {v.description}
                  </span>
                )}
              </label>
              <Input
                value={envValues[v.name] || ""}
                onChange={(e) =>
                  setEnvValues((prev) => ({
                    ...prev,
                    [v.name]: e.target.value,
                  }))
                }
                type={v.isSecret ? "password" : "text"}
                className="h-7 text-xs"
                placeholder={v.name}
                disabled={installing}
              />
            </div>
          ))}
        </div>
      )}

      {/* Optional env vars */}
      {optionalVars.length > 0 && (
        <div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px] font-medium transition-colors"
            onClick={() => setShowOptional(!showOptional)}
          >
            {showOptional ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            {optionalVars.length} optional env var
            {optionalVars.length !== 1 ? "s" : ""}
          </button>
          {showOptional && (
            <div className="mt-1.5 space-y-1.5">
              {optionalVars.map((v) => (
                <div key={v.name}>
                  <label className="text-muted-foreground mb-0.5 block text-[10px]">
                    {v.name}
                    {v.description && (
                      <span className="ml-1 font-normal opacity-70">
                        — {v.description}
                      </span>
                    )}
                  </label>
                  <Input
                    value={envValues[v.name] || ""}
                    onChange={(e) =>
                      setEnvValues((prev) => ({
                        ...prev,
                        [v.name]: e.target.value,
                      }))
                    }
                    type={v.isSecret ? "password" : "text"}
                    className="h-7 text-xs"
                    placeholder={v.name}
                    disabled={installing}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onCancel}
          disabled={installing}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={installing || !name.trim()}
        >
          {installing && <Loader2 className="h-3 w-3 animate-spin" />}
          {installing ? "Installing..." : "Install"}
        </Button>
      </div>
    </form>
  );
}
