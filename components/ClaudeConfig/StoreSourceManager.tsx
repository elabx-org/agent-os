"use client";

import { useState, useCallback } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StoreSource } from "./ClaudeConfigDialog.types";

interface StoreSourceManagerProps {
  sources: StoreSource[];
  onAdd: (source: Omit<StoreSource, "id">) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
}

const BUILT_IN_SOURCES = [
  { label: "anthropics/skills", type: "skill" as const },
  { label: "daymade/claude-code-skills", type: "skill" as const },
  { label: "VoltAgent/awesome-claude-code-subagents", type: "agent" as const },
  { label: "MCP Registry", type: "mcp" as const },
];

export function StoreSourceManager({
  sources,
  onAdd,
  onRemove,
  onClose,
}: StoreSourceManagerProps) {
  const [repo, setRepo] = useState("");
  const [type, setType] = useState<"skill" | "agent">("skill");
  const [label, setLabel] = useState("");
  const [branch, setBranch] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedRepo = repo.trim();
      if (!trimmedRepo) return;

      setAdding(true);
      try {
        await onAdd({
          repo: trimmedRepo,
          type,
          label: label.trim() || trimmedRepo.split("/").pop() || trimmedRepo,
          branch: branch.trim() || undefined,
        });
        setRepo("");
        setLabel("");
        setBranch("");
      } finally {
        setAdding(false);
      }
    },
    [repo, type, label, branch, onAdd]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Store Sources</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Built-in sources */}
      <div className="space-y-1">
        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
          Built-in
        </span>
        {BUILT_IN_SOURCES.map((s) => (
          <div
            key={s.label}
            className="text-muted-foreground flex items-center gap-2 px-1 py-0.5 text-xs"
          >
            <span
              className={cn(
                "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none",
                s.type === "skill"
                  ? "bg-blue-500/10 text-blue-500"
                  : s.type === "agent"
                    ? "bg-purple-500/10 text-purple-500"
                    : "bg-green-500/10 text-green-500"
              )}
            >
              {s.type}
            </span>
            <span className="truncate">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Custom sources */}
      {sources.length > 0 && (
        <div className="space-y-1">
          <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
            Custom
          </span>
          {sources.map((s) => (
            <div
              key={s.id}
              className="group flex items-center gap-2 px-1 py-0.5 text-xs"
            >
              <span
                className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none",
                  s.type === "skill"
                    ? "bg-blue-500/10 text-blue-500"
                    : "bg-purple-500/10 text-purple-500"
                )}
              >
                {s.type}
              </span>
              <span className="truncate">{s.label}</span>
              <span className="text-muted-foreground truncate text-[10px]">
                {s.repo}
                {s.branch ? `@${s.branch}` : ""}
              </span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                onClick={() => onRemove(s.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <form onSubmit={handleAdd} className="space-y-1.5">
        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
          Add source
        </span>
        <div className="flex gap-1.5">
          <Input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            className="h-7 flex-1 text-xs"
            disabled={adding}
          />
          <div className="flex shrink-0 overflow-hidden rounded-md border">
            {(["skill", "agent"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  "px-2 py-1 text-[10px] font-medium transition-colors",
                  type === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1.5">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="h-7 flex-1 text-xs"
            disabled={adding}
          />
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Branch (main)"
            className="h-7 w-28 shrink-0 text-xs"
            disabled={adding}
          />
          <Button
            type="submit"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={adding || !repo.trim()}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
      </form>
    </div>
  );
}
