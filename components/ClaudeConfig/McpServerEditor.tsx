"use client";

import { useState, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { json } from "@codemirror/lang-json";
import type { Extension } from "@codemirror/state";
import { ArrowLeft, Save, Loader2, Plus, X, Code, FormInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { McpServerConfig } from "./ClaudeConfigDialog.types";

interface McpServerEditorProps {
  name?: string; // undefined = creating new
  config?: McpServerConfig;
  onSave: (name: string, config: McpServerConfig) => Promise<void>;
  onBack: () => void;
}

// Reuse the same CodeMirror theme as ItemEditor
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
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "#fcd34d" },
  { tag: [t.definition(t.name), t.separator], color: "hsl(var(--foreground))" },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: "#f9a8d4" },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.special(t.string)], color: "#67e8f9" },
  { tag: [t.meta, t.comment], color: "hsl(var(--muted-foreground))", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "#67e8f9", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: "hsl(var(--primary))" },
  { tag: [t.atom, t.bool], color: "#f9a8d4" },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "#86efac" },
  { tag: t.invalid, color: "#fca5a5" },
]);

export function McpServerEditor({
  name: initialName,
  config: initialConfig,
  onSave,
  onBack,
}: McpServerEditorProps) {
  const isNew = !initialName;

  // Form state
  const [serverName, setServerName] = useState(initialName || "");
  const [command, setCommand] = useState(initialConfig?.command || "");
  const [args, setArgs] = useState<string[]>(initialConfig?.args || []);
  const [cwd, setCwd] = useState(initialConfig?.cwd || "");
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>(
    () => {
      if (!initialConfig?.env) return [];
      return Object.entries(initialConfig.env).map(([key, value]) => ({
        key,
        value,
      }));
    }
  );

  // JSON mode
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonContent, setJsonContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [extensions, setExtensions] = useState<Extension[]>([]);

  // Sync form → JSON when switching to JSON mode
  const formToJson = useCallback(() => {
    const cfg: McpServerConfig = { command };
    if (args.length > 0) cfg.args = args;
    if (cwd.trim()) cfg.cwd = cwd.trim();
    const env: Record<string, string> = {};
    for (const { key, value } of envVars) {
      if (key.trim()) env[key.trim()] = value;
    }
    if (Object.keys(env).length > 0) cfg.env = env;
    return JSON.stringify(cfg, null, 2);
  }, [command, args, cwd, envVars]);

  // Sync JSON → form when switching to form mode
  const jsonToForm = useCallback(() => {
    try {
      const cfg = JSON.parse(jsonContent) as McpServerConfig;
      setCommand(cfg.command || "");
      setArgs(cfg.args || []);
      setCwd(cfg.cwd || "");
      setEnvVars(
        cfg.env
          ? Object.entries(cfg.env).map(([key, value]) => ({ key, value }))
          : []
      );
    } catch {
      // invalid JSON, keep current form state
    }
  }, [jsonContent]);

  const handleToggleMode = useCallback(() => {
    if (jsonMode) {
      jsonToForm();
    } else {
      setJsonContent(formToJson());
    }
    setJsonMode(!jsonMode);
  }, [jsonMode, jsonToForm, formToJson]);

  const handleSave = useCallback(async () => {
    const name = serverName.trim();
    if (!name) {
      toast.error("Server name is required");
      return;
    }

    let cfg: McpServerConfig;
    if (jsonMode) {
      try {
        cfg = JSON.parse(jsonContent);
      } catch {
        toast.error("Invalid JSON");
        return;
      }
    } else {
      cfg = { command };
      if (args.length > 0) cfg.args = args.filter((a) => a !== "");
      if (cwd.trim()) cfg.cwd = cwd.trim();
      const env: Record<string, string> = {};
      for (const { key, value } of envVars) {
        if (key.trim()) env[key.trim()] = value;
      }
      if (Object.keys(env).length > 0) cfg.env = env;
    }

    if (!cfg.command) {
      toast.error("Command is required");
      return;
    }

    setSaving(true);
    try {
      await onSave(name, cfg);
      toast.success(`Saved "${name}"`);
      onBack();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [serverName, jsonMode, jsonContent, command, args, cwd, envVars, onSave, onBack]);

  useEffect(() => {
    setExtensions([
      editorTheme,
      syntaxHighlighting(highlightStyle),
      EditorView.lineWrapping,
      json(),
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {isNew ? "Add MCP Server" : `Edit: ${initialName}`}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={handleToggleMode}
        >
          {jsonMode ? (
            <FormInput className="h-3 w-3" />
          ) : (
            <Code className="h-3 w-3" />
          )}
          {jsonMode ? "Form" : "JSON"}
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Server name (always shown) */}
        <div className="border-b px-3 py-2">
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            Server Name
          </label>
          <Input
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            placeholder="my-server"
            className="h-8 text-xs"
            disabled={!isNew}
          />
        </div>

        {jsonMode ? (
          /* JSON Editor */
          <div className="min-h-0 flex-1">
            <CodeMirror
              value={jsonContent}
              height="100%"
              theme="none"
              extensions={extensions}
              onChange={setJsonContent}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                highlightActiveLine: true,
                foldGutter: true,
                indentOnInput: true,
                bracketMatching: true,
                closeBrackets: true,
              }}
              className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:!overflow-auto"
            />
          </div>
        ) : (
          /* Form Editor */
          <div className="space-y-4 p-3">
            {/* Command */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Command
              </label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx, uvx, python, node..."
                className="h-8 text-xs"
              />
            </div>

            {/* Arguments */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Arguments
              </label>
              <div className="space-y-1">
                {args.map((arg, i) => (
                  <div key={i} className="flex gap-1">
                    <Input
                      value={arg}
                      onChange={(e) => {
                        const next = [...args];
                        next[i] = e.target.value;
                        setArgs(next);
                      }}
                      className="h-7 text-xs"
                      placeholder={`arg ${i + 1}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setArgs(args.filter((_, j) => j !== i))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setArgs([...args, ""])}
                >
                  <Plus className="h-3 w-3" />
                  Add argument
                </Button>
              </div>
            </div>

            {/* Working Directory */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Working Directory{" "}
                <span className="text-muted-foreground/60 font-normal">(optional)</span>
              </label>
              <Input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                className="h-8 text-xs"
              />
            </div>

            {/* Environment Variables */}
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Environment Variables
              </label>
              <div className="space-y-1">
                {envVars.map((ev, i) => (
                  <div key={i} className="flex gap-1">
                    <Input
                      value={ev.key}
                      onChange={(e) => {
                        const next = [...envVars];
                        next[i] = { ...next[i], key: e.target.value };
                        setEnvVars(next);
                      }}
                      className="h-7 w-1/3 text-xs"
                      placeholder="KEY"
                    />
                    <span className="text-muted-foreground flex items-center text-xs">
                      =
                    </span>
                    <Input
                      value={ev.value}
                      onChange={(e) => {
                        const next = [...envVars];
                        next[i] = { ...next[i], value: e.target.value };
                        setEnvVars(next);
                      }}
                      className="h-7 flex-1 text-xs"
                      placeholder="value"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-7 w-7 shrink-0"
                      onClick={() =>
                        setEnvVars(envVars.filter((_, j) => j !== i))
                      }
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() =>
                    setEnvVars([...envVars, { key: "", value: "" }])
                  }
                >
                  <Plus className="h-3 w-3" />
                  Add env var
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
