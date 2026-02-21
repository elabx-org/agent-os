"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Folder,
  File,
  ChevronLeft,
  Loader2,
  Home,
  ChevronRight,
  Upload,
  Clipboard,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/file-utils";
import { uploadFileToTemp } from "@/lib/file-upload";
import { useFileDrop } from "@/hooks/useFileDrop";

interface FilePickerProps {
  /** Directory to upload/copy files into */
  destinationDir: string;
  /** Called after one or more files are successfully added */
  onFilesAdded: () => void;
  onClose: () => void;
}

/** Copy a server-side file into destinationDir */
async function copyServerFile(
  source: string,
  destinationDir: string
): Promise<boolean> {
  const res = await fetch("/api/files/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, destinationDir }),
  });
  return res.ok;
}

export function FilePicker({
  destinationDir,
  onFilesAdded,
  onClose,
}: FilePickerProps) {
  const [currentPath, setCurrentPath] = useState(destinationDir);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Flash green checkmark on a path, then clear */
  const flashAdded = useCallback((p: string) => {
    setJustAdded((prev) => new Set(prev).add(p));
    setTimeout(
      () =>
        setJustAdded((prev) => {
          const next = new Set(prev);
          next.delete(p);
          return next;
        }),
      1500
    );
  }, []);

  /** Upload device files to destinationDir */
  const handleDeviceFiles = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;
      setUploading(true);
      try {
        const paths = await Promise.all(
          fileList.map((f) => uploadFileToTemp(f, destinationDir))
        );
        paths.forEach((p) => p && flashAdded(p));
        onFilesAdded();
      } catch {
        // silently ignore — user can retry
      } finally {
        setUploading(false);
      }
    },
    [destinationDir, onFilesAdded, flashAdded]
  );

  /** Copy a server-side file to destinationDir */
  const handleServerFileCopy = useCallback(
    async (node: FileNode) => {
      setUploading(true);
      try {
        const ok = await copyServerFile(node.path, destinationDir);
        if (ok) {
          flashAdded(node.path);
          onFilesAdded();
        }
      } catch {
        // silently ignore
      } finally {
        setUploading(false);
      }
    },
    [destinationDir, onFilesAdded, flashAdded]
  );

  // Drag-and-drop
  const { isDragging, dragHandlers } = useFileDrop(
    dropZoneRef,
    (file) => handleDeviceFiles([file]),
    { disabled: uploading }
  );

  // Clipboard paste (any file type)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const fileItems = Array.from(items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (fileItems.length > 0) {
        e.preventDefault();
        handleDeviceFiles(fileItems);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleDeviceFiles]);

  // Load directory listing
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setFiles([]);
      } else {
        const sorted = (data.files || []).sort((a: FileNode, b: FileNode) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(sorted);
        setCurrentPath(data.path || path);
      }
    } catch {
      setError("Failed to load directory");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateTo = (path: string) => loadDirectory(path);

  const navigateUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length > 1) {
      navigateTo("/" + parts.slice(0, -1).join("/"));
    } else {
      navigateTo("/");
    }
  };

  const handleItemClick = (node: FileNode) => {
    if (node.type === "directory") {
      navigateTo(node.path);
    } else {
      handleServerFileCopy(node);
    }
  };

  const pathSegments = currentPath.split("/").filter(Boolean);
  const isInDestination = currentPath === destinationDir;

  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col">
      {/* Header */}
      <div className="border-border bg-background/95 flex items-center gap-2 border-b p-3 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="h-9 w-9"
        >
          <X className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Add Files</h3>
          <p className="text-muted-foreground truncate text-xs">
            → {destinationDir}
          </p>
        </div>
      </div>

      {/* Breadcrumb navigation */}
      <div className="border-border flex items-center gap-1 overflow-x-auto border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigateTo("~")}
          className="h-8 w-8 shrink-0"
          title="Home"
        >
          <Home className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={navigateUp}
          className="h-8 w-8 shrink-0"
          title="Go up"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-muted-foreground flex items-center gap-0.5 overflow-x-auto text-xs">
          <span>/</span>
          {pathSegments.map((segment, i) => (
            <button
              key={i}
              onClick={() =>
                navigateTo("/" + pathSegments.slice(0, i + 1).join("/"))
              }
              className="hover:text-foreground flex shrink-0 items-center transition-colors"
            >
              <span className="max-w-[100px] truncate">{segment}</span>
              {i < pathSegments.length - 1 && (
                <ChevronRight className="mx-0.5 h-3 w-3" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          if (picked.length > 0) handleDeviceFiles(picked);
          e.target.value = "";
        }}
      />

      {/* Upload zone */}
      <div
        ref={dropZoneRef}
        {...dragHandlers}
        className={cn(
          "border-border mx-3 mt-3 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors",
          isDragging && "border-primary bg-primary/10",
          uploading && "opacity-50"
        )}
      >
        {uploading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Adding file…</span>
          </div>
        ) : isDragging ? (
          <div className="flex items-center gap-2">
            <Upload className="text-primary h-5 w-5" />
            <span className="text-primary text-sm font-medium">
              Drop files here
            </span>
          </div>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload from device
            </Button>
            <div className="text-muted-foreground flex items-center gap-1 text-xs">
              <Clipboard className="h-3 w-3" />
              <span>or drag & drop / paste (⌘V)</span>
            </div>
          </>
        )}
      </div>

      {/* File browser — select from server filesystem */}
      <div className="border-border mt-3 border-t px-3 py-2">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {isInDestination
            ? "Current folder"
            : "Browse and copy from server filesystem"}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-muted-foreground flex h-32 flex-col items-center justify-center p-4">
            <p className="text-center text-sm">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={navigateUp}
              className="mt-2"
            >
              Go back
            </Button>
          </div>
        ) : files.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center">
            <p className="text-sm">Empty directory</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {files.map((node) => {
              const isDir = node.type === "directory";
              const added = justAdded.has(node.path);

              return (
                <button
                  key={node.path}
                  onClick={() => !uploading && handleItemClick(node)}
                  disabled={uploading}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors",
                    "hover:bg-muted/50 hover:border-primary/50 cursor-pointer",
                    added && "border-green-500/50 bg-green-500/10"
                  )}
                >
                  {added ? (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20">
                      <Check className="h-6 w-6 text-green-500" />
                    </div>
                  ) : isDir ? (
                    <Folder className="text-primary/70 h-10 w-10" />
                  ) : (
                    <FileTypeIcon name={node.name} extension={node.extension} />
                  )}
                  <span className="w-full truncate text-xs">{node.name}</span>
                  {!isDir && !added && (
                    <span className="text-muted-foreground text-[10px]">
                      Copy here
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-border border-t p-3 text-center">
        <p className="text-muted-foreground text-xs">
          Click a file to copy it into{" "}
          <span className="font-mono">{destinationDir.split("/").pop()}/</span>,
          or upload from your device above
        </p>
      </div>
    </div>
  );
}

/** File icon with colour coding by extension */
function FileTypeIcon({
  name,
  extension,
}: {
  name: string;
  extension?: string;
}) {
  const ext = (extension || name.split(".").pop() || "").toLowerCase();

  const colorMap: Record<string, string> = {
    js: "text-yellow-400",
    jsx: "text-yellow-400",
    ts: "text-blue-400",
    tsx: "text-blue-400",
    css: "text-pink-400",
    scss: "text-pink-400",
    html: "text-orange-400",
    xml: "text-orange-400",
    json: "text-green-400",
    yaml: "text-purple-400",
    yml: "text-purple-400",
    md: "text-blue-300",
    toml: "text-gray-400",
    png: "text-emerald-400",
    jpg: "text-emerald-400",
    jpeg: "text-emerald-400",
    gif: "text-emerald-400",
    webp: "text-emerald-400",
    svg: "text-emerald-400",
    pdf: "text-red-400",
    zip: "text-amber-400",
    tar: "text-amber-400",
    gz: "text-amber-400",
    sh: "text-cyan-400",
    py: "text-yellow-300",
    rb: "text-red-400",
    go: "text-cyan-400",
    rs: "text-orange-500",
  };

  const color = colorMap[ext] || "text-muted-foreground";

  return (
    <div className="bg-muted flex h-10 w-10 items-center justify-center rounded">
      <File className={cn("h-6 w-6", color)} />
    </div>
  );
}
