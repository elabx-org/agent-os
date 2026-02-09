"use client";

import { useState, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { Save, Loader2, FilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ConfigScope } from "./ClaudeConfigDialog.types";

interface ClaudeMdTabProps {
  globalContent: string | null;
  projectContent: string | null;
  hasProject: boolean;
  loading: boolean;
  onSave: (path: string, content: string) => Promise<void>;
  onCreate: (scope: ConfigScope) => Promise<void>;
  globalPath: string;
  projectPath: string;
}

// Reuse same theme as ItemEditor
const editorTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    height: "100%",
    backgroundColor: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
  },
  ".cm-content": {
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
    padding: "8px 0",
    caretColor: "hsl(var(--primary))",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--background))",
    borderRight: "none",
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 16px" },
  ".cm-activeLineGutter": { backgroundColor: "hsl(var(--accent))" },
  ".cm-activeLine": { backgroundColor: "hsl(var(--accent) / 0.5)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "hsl(var(--primary) / 0.3) !important" },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "hsl(var(--primary))",
    borderLeftWidth: "2px",
  },
  ".cm-scroller": { overflow: "auto" },
});

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "hsl(var(--primary))" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "hsl(var(--foreground))" },
  { tag: [t.propertyName], color: "#7dd3fc" },
  { tag: [t.function(t.variableName), t.labelName], color: "#c4b5fd" },
  { tag: [t.meta, t.comment], color: "hsl(var(--muted-foreground))", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "#67e8f9", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: "hsl(var(--primary))" },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "#86efac" },
]);

export function ClaudeMdTab({
  globalContent,
  projectContent,
  hasProject,
  loading,
  onSave,
  onCreate,
  globalPath,
  projectPath,
}: ClaudeMdTabProps) {
  const [scope, setScope] = useState<ConfigScope>("global");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extensions, setExtensions] = useState<Extension[]>([]);

  const currentContent = scope === "global" ? globalContent : projectContent;
  const currentPath = scope === "global" ? globalPath : projectPath;
  const fileExists = currentContent !== null;

  // Reset content when scope changes or data loads
  useEffect(() => {
    setContent(currentContent ?? "");
    setDirty(false);
  }, [currentContent, scope]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(currentPath, content);
      setDirty(false);
      toast.success("Saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [content, currentPath, onSave]);

  useEffect(() => {
    setExtensions([
      editorTheme,
      syntaxHighlighting(highlightStyle),
      EditorView.lineWrapping,
      markdown(),
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            handleSave();
            return true;
          },
        },
      ]),
    ]);
  }, [handleSave]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Scope toggle + save */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex gap-1">
          <button
            onClick={() => setScope("global")}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              scope === "global"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            Global
          </button>
          {hasProject && (
            <button
              onClick={() => setScope("project")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                scope === "project"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              Project
            </button>
          )}
        </div>
        <span className="text-muted-foreground truncate text-xs">
          {currentPath}
        </span>
        <div className="flex-1" />
        {fileExists && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </Button>
        )}
      </div>

      {/* Editor or create prompt */}
      {fileExists ? (
        <div className="min-h-0 flex-1">
          <CodeMirror
            value={content}
            height="100%"
            theme="none"
            extensions={extensions}
            onChange={(val) => {
              setContent(val);
              if (!dirty) setDirty(true);
            }}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: true,
              indentOnInput: true,
              bracketMatching: true,
              closeBrackets: true,
              highlightSelectionMatches: true,
              searchKeymap: true,
            }}
            className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:!overflow-auto"
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
          <p className="text-muted-foreground text-sm">
            No CLAUDE.md file found at this scope.
          </p>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => onCreate(scope)}
          >
            <FilePlus className="h-4 w-4" />
            Create CLAUDE.md
          </Button>
        </div>
      )}
    </div>
  );
}
