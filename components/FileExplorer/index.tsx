"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FileTree } from "./FileTree";
import { FileEditor } from "./FileEditor";
import { FileTabs } from "./FileTabs";
import type { UseFileEditorReturn } from "@/hooks/useFileEditor";
import { useViewport } from "@/hooks/useViewport";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Folder,
  Save,
  Home,
  ChevronRight,
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

  // Load directory contents whenever currentRoot changes
  useEffect(() => {
    const loadFiles = async () => {
      setLoading(true);
      setError(null);
      setFiles([]);
      try {
        const res = await fetch(
          `/api/files?path=${encodeURIComponent(currentRoot)}`
        );
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setFiles(data.files || []);
        }
      } catch {
        setError("Failed to load directory");
      } finally {
        setLoading(false);
      }
    };
    loadFiles();
  }, [currentRoot]);

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
    if (parts.length <= 1) return; // already at /
    const parent = parts.slice(0, -1).join("/") || "/";
    setCurrentRoot(parent);
  }, [currentRoot]);

  const handleNavigateTo = useCallback((path: string) => {
    setCurrentRoot(path);
  }, []);

  const activeFile = activeFilePath ? getFile(activeFilePath) : undefined;

  // Loading state before hydration
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

// Breadcrumb path navigator
function PathBreadcrumb({
  path,
  onNavigateTo,
}: {
  path: string;
  onNavigateTo: (path: string) => void;
}) {
  // Split into segments, filtering empty strings
  const segments = path.split("/").filter(Boolean);

  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {/* Root "/" */}
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
              className={cn(
                "max-w-[120px] truncate rounded px-1 py-0.5 text-xs transition-colors",
                isLast
                  ? "text-foreground font-medium cursor-default"
                  : "text-muted-foreground hover:text-foreground cursor-pointer"
              )}
              title={segPath}
              disabled={isLast}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}

// Shared props interface
interface FileExplorerLayoutProps {
  files: FileNode[];
  loading: boolean;
  error: string | null;
  fileLoading: boolean;
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
  isDirty: (path: string) => boolean;
  updateContent: (path: string, content: string) => void;
  pendingClose: string | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  onSaveAndClose: () => void;
}

// Desktop: Side-by-side tree + editor
function DesktopFileExplorer({
  files,
  loading,
  error,
  fileLoading,
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

  const atRoot = currentRoot === "/" || currentRoot === "";

  return (
    <div ref={containerRef} className="bg-background flex h-full w-full">
      {/* File tree panel */}
      <div className="flex h-full flex-col" style={{ width: treeWidth }}>
        {/* Header: up button + breadcrumb */}
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
        </div>

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
            <div className="text-muted-foreground flex h-32 items-center justify-center">
              <p className="text-sm">Empty directory</p>
            </div>
          ) : (
            <FileTree
              nodes={files}
              basePath={currentRoot}
              onFileClick={onFileClick}
            />
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="bg-muted/50 hover:bg-primary/50 active:bg-primary w-1 flex-shrink-0 cursor-col-resize transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* Editor panel */}
      <div className="bg-muted/20 flex h-full min-w-0 flex-1 flex-col">
        {/* Tabs */}
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

        {/* Editor or empty state */}
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

      {/* Unsaved changes dialog */}
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
  isDirty,
  updateContent,
  pendingClose,
  onCancelClose,
  onConfirmClose,
  onSaveAndClose,
}: MobileFileExplorerProps) {
  // Show editor when a file is active
  if (activeFile) {
    const isCurrentDirty = activeFilePath ? isDirty(activeFilePath) : false;

    return (
      <div className="bg-background flex h-full w-full flex-col">
        {/* Header */}
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

        {/* Editor */}
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

        {/* Unsaved changes dialog */}
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

  const atRoot = currentRoot === "/" || currentRoot === "";

  // Show file tree
  return (
    <div className="bg-background flex h-full w-full flex-col">
      {/* Header: up button + breadcrumb */}
      <div className="flex items-center gap-1 border-b px-2 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNavigateUp}
          disabled={atRoot}
          className="flex-shrink-0"
          title="Go up one level"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 overflow-hidden">
          <PathBreadcrumb path={currentRoot} onNavigateTo={onNavigateTo} />
        </div>
      </div>

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
          <div className="text-muted-foreground flex h-32 items-center justify-center">
            <p className="text-sm">Empty directory</p>
          </div>
        ) : (
          <FileTree
            nodes={files}
            basePath={currentRoot}
            onFileClick={onFileClick}
          />
        )}
      </div>

      {fileLoading && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <Loader2 className="text-primary h-8 w-8 animate-spin" />
        </div>
      )}
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
