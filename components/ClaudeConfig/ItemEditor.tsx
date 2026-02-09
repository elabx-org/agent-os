"use client";

import { useState, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ItemEditorProps {
  filePath: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onBack: () => void;
}

// Theme matching the app's CSS variables (same as FileEditor)
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
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 16px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--accent))",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--accent) / 0.5)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "hsl(var(--primary) / 0.3) !important",
    },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "hsl(var(--primary))",
    borderLeftWidth: "2px",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "hsl(var(--primary))" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "hsl(var(--foreground))" },
  { tag: [t.propertyName], color: "#7dd3fc" },
  { tag: [t.function(t.variableName), t.labelName], color: "#c4b5fd" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "#fcd34d" },
  { tag: [t.definition(t.name), t.separator], color: "hsl(var(--foreground))" },
  {
    tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
    color: "#f9a8d4",
  },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.special(t.string)],
    color: "#67e8f9",
  },
  { tag: [t.meta, t.comment], color: "hsl(var(--muted-foreground))", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "#67e8f9", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: "hsl(var(--primary))" },
  { tag: [t.atom, t.bool], color: "#f9a8d4" },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "#86efac" },
  { tag: t.invalid, color: "#fca5a5" },
]);

export function ItemEditor({
  filePath,
  initialContent,
  onSave,
  onBack,
}: ItemEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [extensions, setExtensions] = useState<Extension[]>([]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(content);
      setDirty(false);
      toast.success("Saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [content, onSave]);

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

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      if (!dirty) setDirty(true);
    },
    [dirty]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-muted-foreground truncate text-xs">
          {filePath}
        </span>
        <div className="flex-1" />
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
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1">
        <CodeMirror
          value={content}
          height="100%"
          theme="none"
          extensions={extensions}
          onChange={handleChange}
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
    </div>
  );
}
