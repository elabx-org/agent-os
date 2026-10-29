"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { newFileNameError } from "./files-search";

interface NewFileDialogProps {
  open: boolean;
  /** The folder it is created in (absolute) */
  folder: string;
  /** Shown in the description: the folder as the breadcrumb names it */
  folderLabel: string;
  onClose: () => void;
  onCreated: (path: string) => void;
}

/**
 * The column's New file (E-Files): a name inside the current folder (it may
 * name subfolders), refused when it exists; saved empty through the editor's
 * own save endpoint
 */
export function NewFileDialog({
  open,
  folder,
  folderLabel,
  onClose,
  onCreated,
}: NewFileDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
    }
  }, [open]);

  const create = async () => {
    const invalid = newFileNameError(name);
    if (invalid) return setError(invalid);
    const path = `${folder.replace(/\/+$/, "")}/${name.trim()}`;
    setBusy(true);
    try {
      // Only a 404 means the name is free (a folder answers with an error)
      const probe = await fetch(
        `/api/files/content?path=${encodeURIComponent(path)}`
      );
      if (probe.status !== 404) {
        setError("That name is taken");
        return;
      }
      const res = await fetch("/api/files/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content: "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || "Couldn't create the file");
        return;
      }
      onCreated(data.path || path);
    } catch {
      setError("Couldn't create the file");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>New file</DialogTitle>
            <DialogDescription>
              In <span className="font-mono">{folderLabel}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Input
              autoFocus
              aria-label="File name"
              placeholder="name.ts"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              aria-invalid={!!error}
            />
            {error && (
              <p className="text-[13px] text-[var(--del)]" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
