"use client";

import { useState } from "react";
import { Plus, Trash2, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExtensionItem, ConfigScope } from "./ClaudeConfigDialog.types";

interface ItemListProps {
  items: ExtensionItem[];
  type: "skill" | "agent";
  loading: boolean;
  hasProject: boolean;
  onEdit: (item: ExtensionItem) => void;
  onDelete: (item: ExtensionItem) => void;
  onCreate: (scope: ConfigScope, name: string) => void;
  onInstallFromGitHub?: () => void;
}

function ScopeSection({
  label,
  items,
  type,
  onEdit,
  onDelete,
  onCreate,
}: {
  label: string;
  items: ExtensionItem[];
  type: string;
  onEdit: (item: ExtensionItem) => void;
  onDelete: (item: ExtensionItem) => void;
  onCreate: (name: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const handleCreate = () => {
    const name = newName.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!name) return;
    onCreate(name);
    setNewName("");
    setCreating(false);
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCreating(!creating)}
          title={`New ${type}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {creating && (
        <div className="mb-2 flex gap-1.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`${type}-name`}
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            autoFocus
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleCreate}>
            Create
          </Button>
        </div>
      )}

      {items.length === 0 && !creating && (
        <p className="text-muted-foreground py-3 text-center text-xs">
          No {type}s installed
        </p>
      )}

      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.filePath}
            className="hover:bg-accent group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
            onClick={() => onEdit(item)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{item.name}</div>
              {item.description && (
                <div className="text-muted-foreground truncate text-xs">
                  {item.description}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive h-6 w-6 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${item.name}"?`)) {
                  onDelete(item);
                }
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ItemList({
  items,
  type,
  loading,
  hasProject,
  onEdit,
  onDelete,
  onCreate,
  onInstallFromGitHub,
}: ItemListProps) {
  const globalItems = items.filter((i) => i.scope === "global");
  const projectItems = items.filter((i) => i.scope === "project");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3">
      {/* Install from GitHub button */}
      {onInstallFromGitHub && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={onInstallFromGitHub}
        >
          <Download className="h-3.5 w-3.5" />
          Install from GitHub
        </Button>
      )}

      <ScopeSection
        label="Global"
        items={globalItems}
        type={type}
        onEdit={onEdit}
        onDelete={onDelete}
        onCreate={(name) => onCreate("global", name)}
      />

      {hasProject && (
        <ScopeSection
          label="Project"
          items={projectItems}
          type={type}
          onEdit={onEdit}
          onDelete={onDelete}
          onCreate={(name) => onCreate("project", name)}
        />
      )}
    </div>
  );
}
