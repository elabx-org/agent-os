"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { FileTree, fetchListing, type TreeVariant } from "./FileTree";
import { FileEditor } from "./FileEditor";
import { FileTabs } from "./FileTabs";
import {
  FilesSearchField,
  FilesSearchResults,
  useFilesSearch,
} from "./FilesSearch";
import { RecentFiles, useRecentFiles } from "./RecentFiles";
import { NewFileDialog } from "./NewFileDialog";
import { baseName, breadcrumb, firstResult, relativeTo } from "./files-search";
import type { UseFileEditorReturn } from "@/hooks/useFileEditor";
import { useViewport } from "@/hooks/useViewport";
import { useFileDrop } from "@/hooks/useFileDrop";
import { uploadFileToTemp } from "@/lib/file-upload";
import { useGitStatus } from "@/data/git/queries";
import { registerNavHandlers } from "@/lib/nav-actions";
import { addQuote } from "@/stores/replyQuotes";
import { mobileNavActions } from "@/stores/mobileNav";
import { DiffModal } from "@/components/DiffViewer";
import {
  Loader2,
  AlertCircle,
  ChevronLeft,
  Folder,
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
import { cn } from "@/lib/utils";

interface FileExplorerProps {
  /** The session it shows: "Ask Claude about this file" quotes to it (M2b) */
  sessionId?: string;
  /** The focused pane's files view is showing: takes the column's New file and Upload (E-Files) */
  active?: boolean;
  workingDirectory: string;
  fileEditor: UseFileEditorReturn;
}

/** Below this the pane gets E-Files' single column even on a wide screen */
const WIDE_MIN = 640;

/** Where the editor should put the cursor after opening a file */
interface Jump {
  path: string;
  line: number;
}

/**
 * Files (E-Files narrow, D-Files wide): a tree with git letters, one search
 * for names and text, recent files, and the editor
 */
export function FileExplorer({
  sessionId,
  active,
  workingDirectory,
  fileEditor,
}: FileExplorerProps) {
  const { isMobile, isHydrated } = useViewport();
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [currentRoot, setCurrentRoot] = useState(workingDirectory);
  const [projectRoot, setProjectRoot] = useState(workingDirectory);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [jump, setJump] = useState<Jump | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [diff, setDiff] = useState<{ diff: string; name: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  // Only the shown view takes paste and ⌘P (Pane keeps hidden views mounted)
  const shown = active !== false;

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

  const { data: gitStatus } = useGitStatus(workingDirectory, {
    enabled: shown,
  });
  const { recent, add: addRecent } = useRecentFiles(projectRoot);
  const search = useFilesSearch(projectRoot, query);

  // Sync both roots when workingDirectory changes (session switch)
  useEffect(() => {
    setCurrentRoot(workingDirectory);
    setProjectRoot(workingDirectory);
  }, [workingDirectory]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width)
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [isHydrated]);

  const loadFiles = useCallback(
    async (dir: string, silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
        setFiles([]);
      }
      try {
        const res = await fetch(
          `/api/files?path=${encodeURIComponent(dir)}&git=1`
        );
        const data = await res.json();
        if (data.error) {
          if (!silent) setError(data.error);
        } else {
          setFiles(data.files || []);
          // Normalize the roots: the API expands ~ to an absolute path, and
          // a ~ kept in state would be split as a breadcrumb segment
          if (data.path && data.path !== dir) {
            setCurrentRoot(data.path);
            if (dir === workingDirectory) setProjectRoot(data.path);
          }
        }
      } catch {
        if (!silent) setError("Failed to load directory");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [workingDirectory]
  );

  useEffect(() => {
    loadFiles(currentRoot);
  }, [currentRoot, loadFiles]);

  /** Reload the listing and open folders in place (badges, new files) */
  const refresh = useCallback(() => {
    loadFiles(currentRoot, true);
    setRefreshKey((k) => k + 1);
  }, [currentRoot, loadFiles]);

  // Coming back to the view: the agent may have changed files meanwhile
  const wasShown = useRef(shown);
  useEffect(() => {
    if (shown && !wasShown.current) refresh();
    wasShown.current = shown;
  }, [shown, refresh]);

  const open = useCallback(
    (path: string, line?: number) => {
      addRecent(path);
      openFile(path);
      setJump(line ? { path, line } : null);
    },
    [addRecent, openFile]
  );

  const openFromSearch = useCallback(
    (rel: string, line?: number) => {
      open(`${projectRoot.replace(/\/+$/, "")}/${rel}`, line);
      setQuery("");
    },
    [open, projectRoot]
  );

  const submitSearch = useCallback(() => {
    const first = firstResult(search.results);
    if (first) openFromSearch(first.path, first.line);
  }, [search.results, openFromSearch]);

  const handleFilesUpload = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;
      setUploading(true);
      try {
        const saved = await Promise.all(
          fileList.map((file) => uploadFileToTemp(file, currentRoot))
        );
        if (saved.some((p) => !p)) toast.error("Upload failed");
        refresh();
      } catch {
        toast.error("Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [currentRoot, refresh]
  );

  // The column's New file and Upload (E-Files): the shown mount alone
  useEffect(() => {
    if (!active) return;
    return registerNavHandlers({
      newFile: () => setNewFileOpen(true),
      uploadFile: () => uploadRef.current?.click(),
    });
  }, [active]);

  // Clipboard paste: files pasted while the view is showing are uploaded
  useEffect(() => {
    if (!shown) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pasted = Array.from(items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (pasted.length > 0) {
        e.preventDefault();
        handleFilesUpload(pasted);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [shown, handleFilesUpload]);

  const { isDragging, dragHandlers } = useFileDrop(
    rootRef,
    (_file, dropped) => handleFilesUpload(dropped),
    { disabled: uploading }
  );

  const handleCloseFile = useCallback(
    (path: string) => {
      if (isDirty(path)) setPendingClose(path);
      else closeFile(path);
    },
    [isDirty, closeFile]
  );

  const handleConfirmClose = useCallback(() => {
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
    if (!activeFilePath) return;
    const result = await saveFile(activeFilePath);
    if (!result.success) toast.error(result.error || "Couldn't save");
    else refresh();
  }, [activeFilePath, saveFile, refresh]);

  // Files git counts as changed, by absolute path (status paths are from the
  // repository's top, which is the session folder in the usual case)
  const changed = useMemo(() => {
    const map = new Map<string, "untracked" | "tracked">();
    if (!gitStatus) return map;
    const base = workingDirectory.replace(/\/+$/, "");
    for (const f of [...gitStatus.staged, ...gitStatus.unstaged])
      map.set(`${base}/${f.path}`, "tracked");
    for (const f of gitStatus.untracked)
      map.set(`${base}/${f.path}`, "untracked");
    return map;
  }, [gitStatus, workingDirectory]);

  const showDiff = useCallback(async () => {
    if (!activeFilePath) return;
    const rel = relativeTo(workingDirectory, activeFilePath);
    const url = (extra: string) =>
      `/api/git/status?path=${encodeURIComponent(workingDirectory)}&file=${encodeURIComponent(rel)}${extra}`;
    const get = async (extra: string) => {
      try {
        const res = await fetch(url(extra));
        const data = await res.json();
        return typeof data.diff === "string" ? data.diff : "";
      } catch {
        return "";
      }
    };
    let text = "";
    if (changed.get(activeFilePath) === "untracked") {
      text = await get("&untracked=true");
    } else {
      text = (await get("")) || (await get("&staged=true"));
    }
    if (!text.trim()) {
      toast("No changes in this file");
      return;
    }
    setDiff({ diff: text, name: rel });
  }, [activeFilePath, workingDirectory, changed]);

  const askClaude = useCallback(() => {
    if (!activeFilePath || !sessionId) return;
    addQuote(sessionId, relativeTo(projectRoot, activeFilePath));
    mobileNavActions.requestViewMode("chat", sessionId);
  }, [activeFilePath, sessionId, projectRoot]);

  const wide = isHydrated && !isMobile && (width === null || width >= WIDE_MIN);

  // ⌘P / Ctrl-P: the sidebar's search (D-Files)
  useEffect(() => {
    if (!wide || !shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "p"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, shown]);

  if (!isHydrated) {
    return (
      <div className="bg-background flex h-full w-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  const activeFile = activeFilePath ? getFile(activeFilePath) : undefined;
  const crumbs = breadcrumb(projectRoot, currentRoot);
  const variant: TreeVariant = wide ? "wide" : "narrow";
  const searching = query.trim().length > 0;

  const tree = loading ? (
    <div className="flex h-24 items-center justify-center">
      <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
    </div>
  ) : error ? (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 p-6">
      <AlertCircle className="h-6 w-6" />
      <p className="text-center text-sm">{error}</p>
    </div>
  ) : files.length === 0 ? (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 p-6">
      <Folder className="h-6 w-6 opacity-40" />
      <p className="text-sm">Empty folder</p>
    </div>
  ) : (
    <FileTree
      key={currentRoot}
      nodes={files}
      variant={variant}
      selectedPath={activeFilePath}
      onFileClick={(path) => open(path)}
      onEnterFolder={setCurrentRoot}
      refreshKey={refreshKey}
    />
  );

  const results = (
    <FilesSearchResults
      results={search.results}
      loading={search.loading}
      onOpen={openFromSearch}
    />
  );

  const crumbTrail = (
    <nav
      aria-label="Folder"
      className="text-muted-foreground flex min-w-0 items-center overflow-hidden font-mono text-[13px] whitespace-nowrap"
    >
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.path} className="flex min-w-0 items-center">
            {i > 0 && c.label !== "/" && crumbs[i - 1].label !== "/" && (
              <span className="px-2">/</span>
            )}
            <button
              type="button"
              disabled={last}
              onClick={() => setCurrentRoot(c.path)}
              className={cn(
                "truncate",
                last ? "cursor-default" : "hover:text-foreground"
              )}
              title={c.path}
            >
              {c.label}
            </button>
          </span>
        );
      })}
    </nav>
  );

  const isModified = (path: string) => changed.has(path);
  const dirty = activeFilePath ? isDirty(activeFilePath) : false;

  const editor = fileLoading ? (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
    </div>
  ) : activeFile ? (
    <FileEditor
      content={activeFile.currentContent}
      language={activeFile.language}
      isBinary={activeFile.isBinary}
      onChange={(content) => updateContent(activeFile.path, content)}
      onSave={handleSave}
      jumpTo={jump?.path === activeFile.path ? jump : null}
    />
  ) : null;

  let body: React.ReactNode;
  if (wide) {
    body = (
      <div className="flex h-full w-full">
        {/* D-Files' sidebar: project, branch, search, tree */}
        <aside
          aria-label="Files"
          className="flex h-full w-[300px] flex-shrink-0 flex-col gap-2.5 border-r border-[var(--hair)] px-2 py-4"
        >
          <div className="flex min-w-0 items-center justify-between gap-2 px-2">
            <span className="t-head truncate">{baseName(projectRoot)}</span>
            {gitStatus?.branch && (
              <span className="chip h-6 min-w-0 truncate font-mono text-[11px]">
                {gitStatus.branch}
              </span>
            )}
          </div>
          <FilesSearchField
            ref={searchRef}
            small
            className="mx-1"
            value={query}
            onChange={setQuery}
            onSubmit={submitSearch}
            loading={search.loading}
            placeholder="Search files and text  ⌘P"
          />
          {currentRoot !== projectRoot && (
            <div className="px-2">{crumbTrail}</div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {searching ? results : tree}
          </div>
        </aside>

        {/* Tabs, actions, the code */}
        <main className="@container/code flex h-full min-w-0 flex-1 flex-col px-4 pt-3 pb-4">
          {activeFile ? (
            <>
              <div className="flex min-w-0 items-end gap-2">
                <FileTabs
                  className="flex-1"
                  files={openFiles}
                  activeFilePath={activeFilePath}
                  onSelect={setActiveFile}
                  onClose={handleCloseFile}
                  isDirty={isDirty}
                  isModified={isModified}
                />
                <div className="flex flex-shrink-0 items-center gap-2 pb-0.5">
                  <button
                    type="button"
                    className="pill pill-sm pill-secondary"
                    onClick={showDiff}
                  >
                    Show diff
                  </button>
                  {sessionId && (
                    <button
                      type="button"
                      className="pill pill-sm pill-secondary"
                      onClick={askClaude}
                      aria-label="Ask Claude about this file"
                    >
                      Ask Claude
                      {/* The tabs keep their room on a narrow page */}
                      <span className="hidden @min-[760px]/code:inline">
                        {" "}
                        about this file
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="pill pill-sm pill-primary disabled:opacity-50"
                    onClick={handleSave}
                    disabled={saving || !dirty}
                  >
                    {saving ? "Saving…" : "Save ⌘S"}
                  </button>
                </div>
              </div>
              <div
                className="code-view min-h-0 flex-1 overflow-hidden"
                style={{ borderRadius: "0 14px 14px 14px" }}
              >
                {editor}
              </div>
            </>
          ) : (
            <div className="code-view text-muted-foreground flex flex-1 flex-col items-center justify-center rounded-[14px] font-sans">
              <Folder className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-sm">
                {fileLoading ? "Opening…" : "Select a file to edit"}
              </p>
            </div>
          )}
        </main>
      </div>
    );
  } else if (activeFile || fileLoading) {
    // Narrow: the editor takes the view
    body = (
      <div className="flex h-full w-full flex-col">
        <div className="flex min-w-0 items-end gap-1 pt-2 pr-2 pl-1">
          <button
            type="button"
            aria-label="Back to files"
            onClick={() => setActiveFile(null as unknown as string)}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full hover:bg-[hsl(var(--foreground)/0.06)]"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <FileTabs
            className="flex-1"
            files={openFiles}
            activeFilePath={activeFilePath}
            onSelect={setActiveFile}
            onClose={handleCloseFile}
            isDirty={isDirty}
            isModified={isModified}
          />
          {dirty && (
            <button
              type="button"
              className="pill pill-sm pill-primary mb-0.5 flex-shrink-0"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
        <div className="code-view min-h-0 flex-1 overflow-hidden">{editor}</div>
      </div>
    );
  } else {
    // E-Files: title, folder, search, recent, the tree on a card
    body = (
      <div
        className="flex h-full w-full flex-col gap-3 overflow-y-auto"
        style={{ padding: "18px 8px 16px 20px" }}
      >
        <div className="min-w-0">
          <h1 className="t-large">Files</h1>
          <div className="mt-1">{crumbTrail}</div>
        </div>
        <FilesSearchField
          className="flex-shrink-0"
          value={query}
          onChange={setQuery}
          onSubmit={submitSearch}
          loading={search.loading}
          placeholder="Find a file or text in files"
        />
        {!searching && <RecentFiles files={recent} onOpen={(p) => open(p)} />}
        <div className="group-card" style={{ padding: "4px 0" }}>
          {searching ? results : tree}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="bg-background relative h-full w-full"
      {...dragHandlers}
    >
      {body}

      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          handleFilesUpload(picked);
        }}
      />

      {isDragging && (
        <div className="bg-primary/10 border-primary absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed">
          <FolderUp className="text-primary h-8 w-8" />
          <p className="text-primary text-sm font-medium">
            Drop to upload here
          </p>
          <p className="text-muted-foreground text-xs">{currentRoot}</p>
        </div>
      )}

      {uploading && !isDragging && (
        <div className="bg-background/60 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
            <span className="text-sm">Uploading…</span>
          </div>
        </div>
      )}

      <NewFileDialog
        open={newFileOpen}
        folder={currentRoot}
        folderLabel={crumbs.map((c) => c.label).join(" / ")}
        onClose={() => setNewFileOpen(false)}
        onCreated={(path) => {
          setNewFileOpen(false);
          refresh();
          open(path);
        }}
      />

      {diff && (
        <DiffModal
          diff={diff.diff}
          fileName={diff.name}
          onClose={() => setDiff(null)}
        />
      )}

      <UnsavedChangesDialog
        open={!!pendingClose}
        fileName={pendingClose?.split("/").pop() || ""}
        onCancel={() => setPendingClose(null)}
        onDiscard={handleConfirmClose}
        onSave={handleSaveAndClose}
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
