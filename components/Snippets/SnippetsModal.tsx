"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SheetGrab } from "@/components/ui/sheet-grab";
import { SHEET_OVERLAY } from "@/components/Terminal/sheet-overlay";
import { useSnippets } from "@/data/snippets";
import type { Snippet } from "@/lib/snippets";

/**
 * The snippets sheet: tap one to put it in the message box; add, change or
 * delete them. The list is shared by every session and device.
 */
export function SnippetsModal({
  open,
  onClose,
  onInsert,
  onPickFile,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
  /** Adds an "Upload a file" row (the composer's "File or snippet") */
  onPickFile?: () => void;
}) {
  const { snippets, save } = useSnippets();
  /** The form: "new", the id of the one being changed, or closed */
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  const openForm = (snippet?: Snippet) => {
    setEditing(snippet ? snippet.id : "new");
    setName(snippet?.name ?? "");
    setContent(snippet?.content ?? "");
  };
  const closeForm = () => {
    setEditing(null);
    setName("");
    setContent("");
  };

  const handleSave = () => {
    if (!name.trim() || !content.trim()) return;
    const entry = { name: name.trim(), content: content.trim() };
    save(
      editing === "new"
        ? [...snippets, { id: Date.now().toString(), ...entry }]
        : snippets.map((s) => (s.id === editing ? { ...s, ...entry } : s))
    );
    closeForm();
  };

  const handleDelete = (id: string) => {
    if (editing === id) closeForm();
    save(snippets.filter((s) => s.id !== id));
  };

  const handleInsert = (text: string) => {
    onInsert(text);
    onClose();
  };

  if (!open) return null;

  return (
    <div className={cn(SHEET_OVERLAY, "items-end")} onClick={onClose}>
      <div
        className="bg-background flex max-h-[70vh] w-full flex-col rounded-t-xl pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <SheetGrab onClose={onClose} className="mx-0 mb-0 h-6" />
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 pb-1">
          <span className="text-sm font-medium">Snippets</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => (editing ? closeForm() : openForm())}
              aria-label="New snippet"
              className="hover:bg-muted active:bg-muted grid size-11 place-items-center rounded-full"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              aria-label="Close snippets"
              className="hover:bg-muted active:bg-muted grid size-11 place-items-center rounded-full"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* The form: a new snippet, or one being changed */}
        {editing && (
          <div className="border-border bg-muted/50 border-b px-4 py-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Snippet name..."
              aria-label="Snippet name"
              className="bg-background focus:ring-primary mb-2 w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Command or text..."
              aria-label="Snippet text"
              className="bg-background focus:ring-primary h-20 w-full resize-none rounded-lg px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
            />
            <button
              onClick={handleSave}
              disabled={!name.trim() || !content.trim()}
              className="bg-primary text-primary-foreground mt-2 w-full rounded-lg py-2 font-medium disabled:opacity-50"
            >
              {editing === "new" ? "Save Snippet" : "Save changes"}
            </button>
          </div>
        )}

        {/* Snippets list */}
        <div className="flex-1 overflow-y-auto">
          {onPickFile && (
            <button
              onClick={onPickFile}
              className="border-border active:bg-muted flex w-full items-center gap-3 border-b px-4 py-3 text-left"
            >
              <Upload className="text-muted-foreground h-4 w-4" />
              <span className="text-sm font-medium">Upload a file</span>
            </button>
          )}
          {snippets.length === 0 ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">
              No snippets yet. Tap + to add one.
            </div>
          ) : (
            snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="border-border active:bg-muted flex items-center gap-1 border-b px-4 py-3"
              >
                <button
                  onClick={() => handleInsert(snippet.content)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium">
                    {snippet.name}
                  </div>
                  <div className="text-muted-foreground truncate font-mono text-xs">
                    {snippet.content}
                  </div>
                </button>
                <button
                  onClick={() => openForm(snippet)}
                  aria-label={`Edit ${snippet.name}`}
                  className="hover:bg-muted text-muted-foreground grid size-9 place-items-center rounded-md"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(snippet.id)}
                  aria-label={`Delete ${snippet.name}`}
                  className="hover:bg-destructive/20 text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
