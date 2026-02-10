"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, Pencil, Download, Loader2 } from "lucide-react";
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
  onUpdateMetadata: (
    item: ExtensionItem,
    updates: Record<string, string>
  ) => void;
  onInstallFromGitHub?: () => void;
}

function InlineEdit({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-6 text-xs"
      />
    );
  }

  return (
    <span
      className="cursor-pointer truncate rounded px-1 py-0.5 hover:bg-accent"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title="Click to edit"
    >
      {value || <span className="text-muted-foreground italic">{placeholder}</span>}
    </span>
  );
}

function ScopeSection({
  label,
  items,
  type,
  onEdit,
  onDelete,
  onCreate,
  onUpdateMetadata,
}: {
  label: string;
  items: ExtensionItem[];
  type: string;
  onEdit: (item: ExtensionItem) => void;
  onDelete: (item: ExtensionItem) => void;
  onCreate: (name: string) => void;
  onUpdateMetadata: (
    item: ExtensionItem,
    updates: Record<string, string>
  ) => void;
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

      {items.length > 0 && (
        <div className="w-full overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="w-[25%] pb-1.5 pr-2 font-medium">Name</th>
                <th className="w-[45%] pb-1.5 pr-2 font-medium">Description</th>
                <th className="w-[15%] pb-1.5 pr-2 font-medium">Source</th>
                <th className="w-[15%] pb-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.filePath}
                  className="group border-b border-border/30 last:border-0"
                >
                  <td className="overflow-hidden py-1.5 pr-2">
                    <InlineEdit
                      value={item.name}
                      placeholder="Unnamed"
                      onSave={(v) => onUpdateMetadata(item, { name: v })}
                    />
                  </td>
                  <td className="overflow-hidden py-1.5 pr-2">
                    <InlineEdit
                      value={item.description}
                      placeholder="No description"
                      onSave={(v) =>
                        onUpdateMetadata(item, { description: v })
                      }
                    />
                  </td>
                  <td className="overflow-hidden py-1.5 pr-2">
                    <span className="text-muted-foreground bg-muted truncate rounded px-1.5 py-0.5 text-xs">
                      {item.source}
                    </span>
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={() => onEdit(item)}
                        title="Edit source"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={() => {
                          if (confirm(`Delete "${item.name}"?`)) {
                            onDelete(item);
                          }
                        }}
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  onUpdateMetadata,
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
        onUpdateMetadata={onUpdateMetadata}
      />

      {hasProject && (
        <ScopeSection
          label="Project"
          items={projectItems}
          type={type}
          onEdit={onEdit}
          onDelete={onDelete}
          onCreate={(name) => onCreate("project", name)}
          onUpdateMetadata={onUpdateMetadata}
        />
      )}
    </div>
  );
}
