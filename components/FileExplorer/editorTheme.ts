import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * The editor as D-Files draws code: JetBrains Mono 13/1.75 on the true-black
 * code page, a 44px right-aligned gutter, and the --syn-* colours (light
 * values under the light theme)
 */
const theme = EditorView.theme({
  "&": {
    fontSize: "13px",
    height: "100%",
    backgroundColor: "var(--diff-bg)",
    color: "hsl(var(--foreground))",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
    lineHeight: "1.75",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "16px 0",
    caretColor: "hsl(var(--meter))",
  },
  ".cm-gutters": {
    backgroundColor: "var(--diff-bg)",
    borderRight: "none",
    color: "var(--code-gutter)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    boxSizing: "border-box",
    minWidth: "44px",
    padding: "0 16px 0 0",
    textAlign: "right",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "hsl(var(--foreground) / 0.7)",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--foreground) / 0.04)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "hsl(var(--primary) / 0.3) !important",
    },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "hsl(var(--meter))",
    borderLeftWidth: "2px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-tooltip": {
    backgroundColor: "hsl(var(--popover))",
    boxShadow: "0 4px 12px hsl(var(--foreground) / 0.15)",
    color: "hsl(var(--popover-foreground))",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "hsl(var(--accent))",
      color: "hsl(var(--accent-foreground))",
    },
  },
  ".cm-panels": {
    backgroundColor: "hsl(var(--card))",
  },
  ".cm-searchMatch": {
    backgroundColor: "hsl(var(--primary) / 0.2)",
    outline: "1px solid hsl(var(--primary) / 0.4)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "hsl(var(--primary) / 0.4)",
  },
});

const highlight = HighlightStyle.define([
  {
    tag: [
      t.keyword,
      t.operatorKeyword,
      t.controlKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.bool,
      t.null,
      t.atom,
      t.self,
    ],
    color: "var(--syn-key)",
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.inserted],
    color: "var(--syn-str)",
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.function(t.definition(t.variableName)),
      t.definition(t.function(t.variableName)),
      t.typeName,
      t.className,
      t.tagName,
    ],
    color: "var(--syn-fn)",
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta],
    color: "var(--syn-com)",
  },
  { tag: t.heading, fontWeight: "bold", color: "var(--syn-key)" },
  { tag: [t.link, t.url], color: "var(--syn-fn)", textDecoration: "underline" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "var(--del)" },
]);

export const editorTheme = [theme, syntaxHighlighting(highlight)];
