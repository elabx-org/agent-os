"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";
import type { Element, ElementContent } from "hast";
import { Check, ChevronRight, Copy, Globe, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { linkTarget, loadLinkProxy } from "@/lib/client/link-target";

/** A link in a reply: localhost:<port> opens through the port proxy */
function LinkOut({
  href,
  children,
}: {
  href?: string;
  children: React.ReactNode;
}) {
  const [, loaded] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    loadLinkProxy().then(loaded);
  }, []);
  const target =
    href && typeof window !== "undefined"
      ? linkTarget(href, window.location.origin)
      : href;
  return (
    <a
      href={target}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary break-words underline underline-offset-2"
    >
      {children}
    </a>
  );
}

/**
 * Claude's replies as GitHub-flavoured markdown: tables, links, quotes,
 * task lists, strikethrough and highlighted code. Raw HTML in the text is
 * shown as text, never rendered.
 */
export const Markdown = React.memo(function Markdown({
  text,
  className,
  quotable,
  sourceId,
}: {
  text: string;
  className?: string;
  /** Each block carries its source in `data-quote`, for "Reply to this" */
  quotable?: boolean;
  /** The chat item it renders, which a quote remembers */
  sourceId?: string;
}) {
  return (
    <div
      className={cn("markdown min-w-0 text-sm leading-relaxed", className)}
      data-quotable={quotable || undefined}
      data-source-id={sourceId}
    >
      <SourceContext.Provider value={quotable ? text : null}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {text}
        </ReactMarkdown>
      </SourceContext.Provider>
    </div>
  );
});

/** The Markdown being rendered, while its blocks can be quoted */
const SourceContext = React.createContext<string | null>(null);

/**
 * A block's own Markdown, so a quote keeps its `code` and **bold**: list
 * markers, heading hashes, a list item's sub-list and the indent or `>` of
 * an enclosing list or quote are left out.
 */
function useQuoteSource(node: Element | undefined, kind: "p" | "h" | "li") {
  const source = React.useContext(SourceContext);
  if (source == null || !node?.position) return undefined;
  const start = node.position.start.offset;
  let end = node.position.end.offset;
  if (start == null || end == null) return undefined;
  if (kind === "li") {
    const sub = node.children.find(
      (c) => c.type === "element" && (c.tagName === "ul" || c.tagName === "ol")
    );
    const subStart = sub?.position?.start.offset;
    if (subStart != null) end = subStart;
  }
  let raw = source.slice(start, end);
  if (kind === "li")
    raw = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "");
  if (kind === "h")
    raw = raw
      .replace(/^#{1,6}\s+/, "")
      .replace(/\s+#+\s*$/, "")
      .replace(/\n\s*[=-]+\s*$/, "");
  const text = raw
    .split("\n")
    .map((line) => line.replace(/^\s*(?:>\s?)*/, "").trimEnd())
    .join("\n")
    .trim();
  return text || undefined;
}

function CodeBlock({
  lang,
  code,
  quotable,
}: {
  lang: string;
  code: string;
  quotable?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const html = React.useMemo(() => {
    try {
      return lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
    } catch {
      return null;
    }
  }, [lang, code]);

  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="border-border/60 my-3 overflow-hidden rounded-xl border bg-zinc-950/60"
      // Quoted whole, fenced, wherever it sits in the source
      data-quote={
        quotable ? `${fence(code)}${lang}\n${code}\n${fence(code)}` : undefined
      }
    >
      <div className="border-border/60 flex items-center justify-between border-b py-1 pr-1 pl-3 text-xs text-zinc-400">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="active:bg-accent hover:bg-accent flex h-8 items-center gap-1 rounded-md px-2"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        {html == null ? (
          <code>{code}</code>
        ) : (
          <code
            className="hljs !bg-transparent !p-0"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </pre>
    </div>
  );
}

/** A code fence longer than any run of backticks in the code */
function fence(code: string) {
  const runs = code.match(/`+/g) ?? [];
  return "`".repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
}

// claude.ai artifacts sit behind a login (claude.site ones are public)
const ARTIFACT_RE =
  /^https:\/\/(?:(?:www\.)?claude\.ai\/(?:code\/)?artifacts?|claude\.site\/artifacts)\/[\w-]+/i;

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

/** The artifact link a paragraph holds and nothing else, if it does. */
function loneArtifactLink(p?: Element) {
  const kids = p?.children.filter(
    (c) => !(c.type === "text" && !c.value.trim())
  );
  const a = kids?.length === 1 ? kids[0] : null;
  if (a?.type !== "element" || a.tagName !== "a") return null;
  const href = a.properties.href;
  if (typeof href !== "string" || !ARTIFACT_RE.test(href)) return null;
  const text = textOf(a).trim();
  // A bare URL has no title to show
  return { href, title: text && text !== href ? text : "Artifact" };
}

// Nothing is fetched: the artifact is private, so the thumbnail is a sketch
function ArtifactCard({ href, title }: { href: string; title: string }) {
  const priv = !/claude\.site\//i.test(href);
  const Icon = priv ? Lock : Globe;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-secondary/40 border-border/60 hover:bg-secondary/70 active:bg-secondary/70 my-2 flex max-w-sm items-center gap-3 rounded-2xl border p-2.5 no-underline transition-colors first:mt-0 last:mb-0"
    >
      <span
        aria-hidden
        className="grid h-[50px] w-[66px] flex-none content-start gap-[3px] rounded-[9px] bg-[#0a0b0d] p-1.5 ring-1 ring-white/10 ring-inset"
      >
        <i className="block h-1.5 w-3/5 rounded-sm bg-[#cfd4db]" />
        <i className="block h-1 rounded-sm bg-[#3a3f48]" />
        <i className="block h-1 w-4/5 rounded-sm bg-[#3a3f48]" />
        <span className="mt-0.5 grid grid-cols-3 gap-[3px]">
          <i className="block h-3.5 rounded-[3px] bg-[#1b1f24]" />
          <i className="block h-3.5 rounded-[3px] bg-[#1b1f24]" />
          <i className="block h-3.5 rounded-[3px] bg-[#1b1f24]" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate font-semibold">
          {title}
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Icon className="h-3 w-3 flex-none" />
          {priv ? "claude.ai artifact · private" : "claude.site artifact"}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground h-4 w-4 flex-none" />
    </a>
  );
}

const components: Components = {
  p: function P({ children, node }) {
    const quote = useQuoteSource(node, "p");
    const link = loneArtifactLink(node);
    if (link) return <ArtifactCard {...link} />;
    return (
      <p className="my-2 first:mt-0 last:mb-0" data-quote={quote}>
        {children}
      </p>
    );
  },
  h1: function H1({ children, node }) {
    const quote = useQuoteSource(node, "h");
    return (
      <h1 className="mt-5 mb-2 text-xl font-bold first:mt-0" data-quote={quote}>
        {children}
      </h1>
    );
  },
  h2: function H2({ children, node }) {
    const quote = useQuoteSource(node, "h");
    return (
      <h2 className="mt-4 mb-2 text-lg font-bold first:mt-0" data-quote={quote}>
        {children}
      </h2>
    );
  },
  h3: function H3({ children, node }) {
    const quote = useQuoteSource(node, "h");
    return (
      <h3
        className="mt-3 mb-1.5 text-base font-semibold first:mt-0"
        data-quote={quote}
      >
        {children}
      </h3>
    );
  },
  h4: function H4({ children, node }) {
    const quote = useQuoteSource(node, "h");
    return (
      <h4 className="mt-3 mb-1 font-semibold first:mt-0" data-quote={quote}>
        {children}
      </h4>
    );
  },
  h5: function H5({ children, node }) {
    const quote = useQuoteSource(node, "h");
    return (
      <h5 className="mt-2 mb-1 font-medium" data-quote={quote}>
        {children}
      </h5>
    );
  },
  h6: function H6({ children, node }) {
    const quote = useQuoteSource(node, "h");
    return (
      <h6 className="mt-2 mb-1 font-medium" data-quote={quote}>
        {children}
      </h6>
    );
  },
  a: ({ href, children }) => <LinkOut href={href}>{children}</LinkOut>,
  ul: ({ children, className }) => (
    <ul
      className={cn(
        "my-2 space-y-1 pl-5",
        className?.includes("contains-task-list")
          ? "list-none pl-1"
          : "list-disc"
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className="my-2 list-decimal space-y-1 pl-5">
      {children}
    </ol>
  ),
  li: function Li({ children, node }) {
    const quote = useQuoteSource(node, "li");
    return (
      <li
        className="marker:text-muted-foreground pl-0.5 [&>ol]:my-1 [&>ul]:my-1"
        data-quote={quote}
      >
        {children}
      </li>
    );
  },
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={!!checked}
        readOnly
        disabled
        className="accent-primary mr-2 h-3.5 w-3.5 translate-y-0.5"
      />
    ) : null,
  blockquote: ({ children }) => (
    <blockquote className="border-primary/50 text-muted-foreground my-3 border-l-2 pl-3">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-4" />,
  strong: ({ children }) => (
    <strong className="text-foreground font-semibold">{children}</strong>
  ),
  del: ({ children }) => (
    <del className="text-muted-foreground">{children}</del>
  ),
  // A link rather than an image, so a reply can't load remote content
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {alt || "image"}
      </a>
    ) : null,
  table: ({ children }) => (
    // Wide tables scroll sideways instead of squashing the columns
    <div className="border-border/60 my-3 overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-left text-[13px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-secondary/70 text-foreground">{children}</thead>
  ),
  tr: ({ children }) => (
    <tr className="border-border/60 even:bg-secondary/25 border-t first:border-t-0">
      {children}
    </tr>
  ),
  th: ({ children, style }) => (
    <th
      style={style}
      className="px-3 py-2 align-bottom font-semibold whitespace-nowrap"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="min-w-[8rem] px-3 py-2 align-top">
      {children}
    </td>
  ),
  pre: ({ children }) => <>{children}</>,
  code: function Code({ className, children }) {
    const quotable = React.useContext(SourceContext) != null;
    const text = String(children ?? "");
    const lang = /language-([\w+#.-]+)/.exec(className ?? "")?.[1];
    // Fenced blocks end in a newline or carry a language; inline code doesn't
    if (lang || text.includes("\n"))
      return (
        <CodeBlock
          lang={lang ?? ""}
          code={text.replace(/\n$/, "")}
          quotable={quotable}
        />
      );
    return (
      <code className="bg-secondary rounded px-1.5 py-0.5 font-mono text-[0.85em] break-words">
        {children}
      </code>
    );
  },
};
