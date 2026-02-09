"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConfigScope } from "./ClaudeConfigDialog.types";

interface InstallFromGitHubProps {
  hasProject: boolean;
  installing: boolean;
  error: string | null;
  onInstall: (url: string, scope: ConfigScope) => Promise<void>;
  onClose: () => void;
}

export function InstallFromGitHub({
  hasProject,
  installing,
  error,
  onInstall,
  onClose,
}: InstallFromGitHubProps) {
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<ConfigScope>("global");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    await onInstall(url.trim(), scope);
  };

  return (
    <div className="border-border rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Install from GitHub</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/user/repo"
          className="h-8 text-xs"
          disabled={installing}
        />

        {hasProject && (
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="scope"
                checked={scope === "global"}
                onChange={() => setScope("global")}
                disabled={installing}
              />
              Global
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="scope"
                checked={scope === "project"}
                onChange={() => setScope("project")}
                disabled={installing}
              />
              Project
            </label>
          </div>
        )}

        {error && (
          <p className="text-destructive text-xs">{error}</p>
        )}

        <Button
          type="submit"
          size="sm"
          className="w-full gap-1.5"
          disabled={installing || !url.trim()}
        >
          {installing && <Loader2 className="h-3 w-3 animate-spin" />}
          {installing ? "Installing..." : "Install"}
        </Button>
      </form>
    </div>
  );
}
