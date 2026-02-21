"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FileTree } from "./FileTree";
import { FileEditor } from "./FileEditor";
import { FileTabs } from "./FileTabs";
import type { UseFileEditorReturn } from "@/hooks/useFileEditor";
import { useViewport } from "@/hooks/useViewport";
import { useFileDrop } from "@/hooks/useFileDrop";
import { uploadFileToTemp } from "@/lib/file-upload";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Folder,
  Save,
  Home,
  ChevronRight,
  Upload,
  FolderUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FileNode } from "@/lib/file-utils";
import type { OpenFile } from "@/hooks/useFileEditor";
import { cn } from "@/lib/utils";

interface FileExplorerProps {
  workingDirectory: string;
  fileEditor: UseFileEditorReturn;
}

export function FileExplorer({
  workingDirectory,
  fileEditor,
}: FileExplorerProps) {
  const { isMobile, isHydrated } = useViewport();
  const [currentRoot, setCurrentRoot] = useState(workingDirectory);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const {
    openFiles,
    activeFilePath,
    loading: fileLoading,
    saving,
    openFile,
    closeFile,
    setActiveFile,
    updateContent,
    saveFile,
    isDirty,
    getFile,
  } = fileEditor;

  // Sync currentRoot when workingDirectory changes (session switch)
  useEffect(() => {
    setCurrentRoot(workingDirectory);
  }, [workingDirectory]);

  const loadFiles = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    setFiles([]);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setFiles(data.files || []);
        // Normalize currentRoot: the API expands ~ to an absolute path.
        // If we keep ~ in state the breadcrumb splits it as a segment and
        // re-constructs parent paths as /~/... which the API can't expand.
        if (data.path && data.path !== dir) {
          setCurrentRoot(data.path);
        }
      }
    } catch {
      setError("Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload when currentRoot changes
  useEffect(() => {
    loadFiles(currentRoot);
  }, [currentRoot, loadFiles]);

  // Upload one or more files to currentRoot
  const handleFilesUpload = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;
      setUploading(true);
      setUploadError(null);
      try {
        await Promise.all(
          fileList.map((file) => uploadFileToTemp(file, currentRoot))
        );
        // Refresh listing
        await loadFiles(currentRoot);
      } catch {
        setUploadError("Upload failed");
        setTimeout(() => setUploadError(null), 3000);
      } finally {
        setUploading(false);
      }
    },
    [currentRoot, loadFiles]
  );

  const handleFileClick = useCallback(
    (path: string) => {
      openFile(path);
    },
    [openFile]
  );

  const handleCloseFile = useCallback(
    (path: string) => {
      if (isDirty(path)) {
        setPendingClose(path);
      } else {
        closeFile(path);
      }
    },
    [isDirty, closeFile]
  );

  const handleConfirmClose = useCallback(async () => {
    if (!pendingClose) return;
    closeFile(pendingClose);
    setPendingClose(null);
  }, [pendingClose, closeFile]);

  const handleSaveAndClose = useCallback(async () => {
    if (!pendingClose) return;
    await saveFile(pendingClose);
    closeFile(pendingClose);
    setPendingClose(null);
  }, [pendingClose, saveFile, closeFile]);

  const handleSave = useCallback(async () => {
    if (activeFilePath) {
      await saveFile(activeFilePath);
    }
  }, [activeFilePath, saveFile]);

  const handleNavigateUp = useCallback(() => {
    const parts = currentRoot.replace(/\/$/, "").split("/");
    if (parts.length <= 1) return;
    const parent = parts.slice(0, -1).join("/") || "/";
    setCurrentRoot(parent);
  }, [currentRoot]);

  const handleNavigateTo = useCallback((path: string) => {
    setCurrentRoot(path);
  }, []);

  const activeFile = activeFilePath ? getFile(activeFilePath) : undefined;

  if (!isHydrated) {
    return (
      <div className="bg-background flex h-full w-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  const sharedProps = {
    files,
    loading,
    error,
    fileLoading,
    uploading,
    uploadError,
    currentRoot,
    workingDirectory,
    openFiles,
    activeFilePath,
    activeFile,
    saving,
    onFileClick: handleFileClick,
    onSelectTab: setActiveFile,
    onCloseTab: handleCloseFile,
    onSave: handleSave,
    onNavigateUp: handleNavigateUp,
    onNavigateTo: handleNavigateTo,
    onFilesUpload: handleFilesUpload,
    isDirty,
    updateContent,
    pendingClose,
    onCancelClose: () => setPendingClose(null),
    onConfirmClose: handleConfirmClose,
    onSaveAndClose: handleSaveAndClose,
  };

  if (isMobile) {
    return (
      <MobileFileExplorer
        {...sharedProps}
        onBack={() => setActiveFile(null as unknown as string)}
      />
    );
  }

  return <DesktopFileExplorer {...sharedProps} />;
}

// Clickable breadcrumb path navigator
function PathBreadcrumb({
  path,
  onNavigateTo,
}: {
  path: string;
  onNavigateTo: (path: string) => void;
}) {
  const segments = path.split("/").filter(Boolean);

  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
      <button
        onClick={() => onNavigateTo("/")}
        className="text-muted-foreground hover:text-foreground flex flex-shrink-0 items-center rounded px-1 py-0.5 text-xs transition-colors"
        title="/"
      >
        <Home className="h-3 w-3" />
      </button>

      {segments.map((seg, i) => {
        const segPath = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={segPath} className="flex flex-shrink-0 items-center">
            <ChevronRight className="text-muted-foreground/50 h-3 w-3 flex-shrink-0" />
            <button
              onClick={() => !isLast && onNavigateTo(segPath)}
              disabled={isLast}
              className={cn(
                "max-w-[120px] truncate rounded px-1 py-0.5 text-xs transition-colors",
                isLast
                  ? "text-foreground cursor-default font-medium"
                  : "text-muted-foreground hover:text-foreground cursor-pointer"
              )}
              title={segPath}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}

// Shared props
interface FileExplorerLayoutProps {
  files: FileNode[];
  loading: boolean;
  error: string | null;
  fileLoading: boolean;
  uploading: boolean;
  uploadError: string | null;
  currentRoot: string;
  workingDirectory: string;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  activeFile: OpenFile | undefined;
  saving: boolean;
  onFileClick: (path: string) => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSave: () => void;
  onNavigateUp: () => void;
  onNavigateTo: (path: string) => void;
  onFilesUpload: (files: File[]) => Promise<void>;
  isDirty: (path: string) => boolean;
  updateContent: (path: string, content: string) => void;
  pendingClose: string | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  onSaveAndClose: () => void;
}

// Tree panel: navigation header + drop zone + file listing
function TreePanel({
  files,
  loading,
  error,
  uploading,
  uploadError,
  currentRoot,
  onFileClick,
  onNavigateUp,
  onNavigateTo,
  onFilesUpload,
}: Pick<
  FileExplorerLayoutProps,
  | "files"
  | "loading"
  | "error"
  | "uploading"
  | "uploadError"
  | "currentRoot"
  | "onFileClick"
  | "onNavigateUp"
  | "onNavigateTo"
  | "onFilesUpload"
>) {
  const treePanelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop: any file onto the tree panel
  const { isDragging, dragHandlers } = useFileDrop(
    treePanelRef,
    (file) => onFilesUpload([file]),
    { disabled: uploading }
  );

  // Clipboard paste: any file pasted while file browser is visible
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
        onFilesUpload(fileItems);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [onFilesUpload]);

  const atRoot = currentRoot === "/" || currentRoot === "";

  return (
    <div
      ref={treePanelRef}
      className="relative flex h-full flex-col"
      {...dragHandlers}
    >
      {/* Hidden file input for device picker */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          if (picked.length > 0) onFilesUpload(picked);
          e.target.value = "";
        }}
      />

      {/* Header: up + breadcrumb + upload */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNavigateUp}
          disabled={atRoot}
          className="flex-shrink-0"
          title="Go up one level"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <div className="min-w-0 flex-1 overflow-hidden">
          <PathBreadcrumb path={currentRoot} onNavigateTo={onNavigateTo} />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex-shrink-0"
          title="Upload files to this folder"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Upload error toast */}
      {uploadError && (
        <div className="bg-destructive/10 text-destructive border-destructive/20 border-b px-3 py-1.5 text-xs">
          {uploadError}
        </div>
      )}

      {/* File listing */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-muted-foreground flex h-32 flex-col items-center justify-center p-4">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p className="text-center text-sm">{error}</p>
          </div>
        ) : files.length === 0 ? (
          <div className="text-muted-foreground flex h-32 flex-col items-center justify-center gap-2">
            <Folder className="h-8 w-8 opacity-40" />
            <p className="text-sm">Empty directory</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2 transition-colors"
            >
              Upload files
            </button>
          </div>
        ) : (
          <FileTree
            nodes={files}
            basePath={currentRoot}
            onFileClick={onFileClick}
          />
        )}
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className="bg-primary/10 border-primary absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed">
          <FolderUp className="text-primary h-8 w-8" />
          <p className="text-primary text-sm font-medium">
            Drop to upload here
          </p>
          <p className="text-muted-foreground text-xs">{currentRoot}</p>
        </div>
      )}

      {/* Upload progress overlay */}
      {uploading && !isDragging && (
        <div className="bg-background/60 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
            <span className="text-sm">Uploading…</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Desktop: Side-by-side tree + editor
function DesktopFileExplorer({
  files,
  loading,
  error,
  fileLoading,
  uploading,
  uploadError,
  currentRoot,
  openFiles,
  activeFilePath,
  activeFile,
  saving,
  onFileClick,
  onSelectTab,
  onCloseTab,
  onSave,
  onNavigateUp,
  onNavigateTo,
  onFilesUpload,
  isDirty,
  updateContent,
  pendingClose,
  onCancelClose,
  onConfirmClose,
  onSaveAndClose,
}: FileExplorerLayoutProps) {
  const [treeWidth, setTreeWidth] = useState(280);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setTreeWidth(Math.max(200, Math.min(500, newWidth)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  return (
    <div ref={containerRef} className="bg-background flex h-full w-full">
      {/* File tree panel */}
      <div className="flex h-full flex-col" style={{ width: treeWidth }}>
        <TreePanel
          files={files}
          loading={loading}
          error={error}
          uploading={uploading}
          uploadError={uploadError}
          currentRoot={currentRoot}
          onFileClick={onFileClick}
          onNavigateUp={onNavigateUp}
          onNavigateTo={onNavigateTo}
          onFilesUpload={onFilesUpload}
        />
      </div>

      {/* Resize handle */}
      <div
        className="bg-muted/50 hover:bg-primary/50 active:bg-primary w-1 flex-shrink-0 cursor-col-resize transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* Editor panel */}
      <div className="bg-muted/20 flex h-full min-w-0 flex-1 flex-col">
        {openFiles.length > 0 && (
          <div className="bg-background/50">
            <FileTabs
              files={openFiles}
              activeFilePath={activeFilePath}
              onSelect={onSelectTab}
              onClose={onCloseTab}
              isDirty={isDirty}
            />
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {fileLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : activeFile ? (
            <FileEditor
              content={activeFile.currentContent}
              language={activeFile.language}
              isBinary={activeFile.isBinary}
              onChange={(content) => updateContent(activeFile.path, content)}
              onSave={onSave}
            />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center">
              <Folder className="mb-4 h-12 w-12 opacity-50" />
              <p className="text-sm">Select a file to edit</p>
            </div>
          )}
        </div>
      </div>

      <UnsavedChangesDialog
        open={!!pendingClose}
        fileName={pendingClose?.split("/").pop() || ""}
        onCancel={onCancelClose}
        onDiscard={onConfirmClose}
        onSave={onSaveAndClose}
      />
    </div>
  );
}

// Mobile: Full-screen tree OR full-screen editor
interface MobileFileExplorerProps extends FileExplorerLayoutProps {
  onBack: () => void;
}

function MobileFileExplorer({
  files,
  loading,
  error,
  fileLoading,
  uploading,
  uploadError,
  currentRoot,
  openFiles,
  activeFilePath,
  activeFile,
  saving,
  onFileClick,
  onSelectTab,
  onCloseTab,
  onSave,
  onBack,
  onNavigateUp,
  onNavigateTo,
  onFilesUpload,
  isDirty,
  updateContent,
  pendingClose,
  onCancelClose,
  onConfirmClose,
  onSaveAndClose,
}: MobileFileExplorerProps) {
  if (activeFile) {
    const isCurrentDirty = activeFilePath ? isDirty(activeFilePath) : false;

    return (
      <div className="bg-background flex h-full w-full flex-col">
        <div className="bg-muted/30 flex items-center gap-2 p-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <FileTabs
              files={openFiles}
              activeFilePath={activeFilePath}
              onSelect={onSelectTab}
              onClose={onCloseTab}
              isDirty={isDirty}
            />
          </div>
          {isCurrentDirty && (
            <Button
              variant="default"
              size="sm"
              onClick={onSave}
              disabled={saving}
              className="flex-shrink-0"
            >
              <Save className="mr-1 h-4 w-4" />
              Save
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {fileLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : (
            <FileEditor
              content={activeFile.currentContent}
              language={activeFile.language}
              isBinary={activeFile.isBinary}
              onChange={(content) => updateContent(activeFile.path, content)}
              onSave={onSave}
            />
          )}
        </div>

        <UnsavedChangesDialog
          open={!!pendingClose}
          fileName={pendingClose?.split("/").pop() || ""}
          onCancel={onCancelClose}
          onDiscard={onConfirmClose}
          onSave={onSaveAndClose}
        />
      </div>
    );
  }

  return (
    <div className="bg-background flex h-full w-full flex-col">
      <TreePanel
        files={files}
        loading={loading}
        error={error}
        uploading={uploading}
        uploadError={uploadError}
        currentRoot={currentRoot}
        onFileClick={onFileClick}
        onNavigateUp={onNavigateUp}
        onNavigateTo={onNavigateTo}
        onFilesUpload={onFilesUpload}
      />
    </div>
  );
}

// Unsaved changes confirmation dialog
interface UnsavedChangesDialogProps {
  open: boolean;
  fileName: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

function UnsavedChangesDialog({
  open,
  fileName,
  onCancel,
  onDiscard,
  onSave,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen: boolean) => !isOpen && onCancel()}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            {fileName} has unsaved changes. What would you like to do?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            Discard
          </Button>
          <Button onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
