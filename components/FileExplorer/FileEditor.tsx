"use client";

import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { FileCode } from "lucide-react";
import { editorTheme } from "./editorTheme";

interface FileEditorProps {
  content: string;
  language: string;
  isBinary: boolean;
  readOnly?: boolean;
  onChange: (content: string) => void;
  onSave?: () => void;
  /** Put the cursor on this line (1-based) and scroll to it; a new object jumps again */
  jumpTo?: { line: number } | null;
}

function getLanguageExtension(language: string): Extension | null {
  switch (language) {
    case "javascript":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "python":
      return python();
    case "json":
      return json();
    case "css":
    case "scss":
      return css();
    case "html":
    case "xml":
      return html();
    case "markdown":
      return markdown();
    default:
      return null;
  }
}

export function FileEditor({
  content,
  language,
  isBinary,
  readOnly = false,
  onChange,
  onSave,
  jumpTo,
}: FileEditorProps) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [view, setView] = useState<EditorView | null>(null);

  // A search hit's line: after CodeMirror has taken the content (child
  // effects run first)
  useEffect(() => {
    if (!view || !jumpTo) return;
    const n = Math.min(Math.max(1, jumpTo.line), view.state.doc.lines);
    const line = view.state.doc.line(n);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  }, [jumpTo, view]);

  useEffect(() => {
    const langExt = getLanguageExtension(language);
    const baseExtensions: Extension[] = [editorTheme, EditorView.lineWrapping];

    if (onSave) {
      baseExtensions.push(
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              onSave();
              return true;
            },
          },
        ])
      );
    }

    if (langExt) {
      baseExtensions.push(langExt);
    }

    setExtensions(baseExtensions);
  }, [language, onSave]);

  if (isBinary) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center p-8">
        <FileCode className="mb-4 h-12 w-12 opacity-50" />
        <p className="text-center text-sm">Binary file cannot be displayed</p>
      </div>
    );
  }

  return (
    <div className="code-view h-full w-full overflow-hidden">
      <CodeMirror
        onCreateEditor={setView}
        value={content}
        height="100%"
        theme="none"
        extensions={extensions}
        onChange={onChange}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: false,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
        className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:!overflow-auto"
      />
    </div>
  );
}
