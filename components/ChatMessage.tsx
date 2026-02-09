"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { User, Bot } from "lucide-react";
import hljs from "highlight.js";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

/**
 * Lightweight markdown renderer for Claude's output.
 * Handles code fences, headings, bold, italic, inline code, and lists.
 */
function renderMarkdown(content: string): React.ReactNode[] {
  // Split on fenced code blocks: ```lang\n...\n```
  const parts = content.split(/(```[\s\S]*?```)/g);
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("```")) {
      // Code block
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      if (match) {
        const lang = match[1];
        const code = match[2].replace(/\n$/, "");
        let highlighted: string;
        try {
          highlighted =
            lang && hljs.getLanguage(lang)
              ? hljs.highlight(code, { language: lang }).value
              : hljs.highlightAuto(code).value;
        } catch {
          highlighted = escapeHtml(code);
        }
        elements.push(
          <div key={i} className="my-2 overflow-x-auto rounded-md bg-zinc-900">
            {lang && (
              <div className="border-b border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                {lang}
              </div>
            )}
            <pre className="p-3 text-sm leading-relaxed">
              <code
                className="hljs"
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            </pre>
          </div>
        );
      } else {
        // Malformed code block — render as-is
        elements.push(<span key={i}>{part}</span>);
      }
    } else {
      // Regular text — render with inline formatting
      elements.push(
        <span key={i}>{renderTextBlock(part)}</span>
      );
    }
  }

  return elements;
}

/** Render a block of text (non-code-fence) with headings, lists, and inline formatting. */
function renderTextBlock(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: { ordered: boolean; content: string }[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const ordered = listItems[0].ordered;
    const Tag = ordered ? "ol" : "ul";
    elements.push(
      <Tag
        key={`list-${elements.length}`}
        className={cn(
          "my-1 space-y-0.5 pl-5",
          ordered ? "list-decimal" : "list-disc"
        )}
      >
        {listItems.map((item, j) => (
          <li key={j} className="text-sm">
            {renderInline(item.content)}
          </li>
        ))}
      </Tag>
    );
    listItems = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const sizes: Record<number, string> = {
        1: "text-xl font-bold mt-4 mb-2",
        2: "text-lg font-bold mt-3 mb-1.5",
        3: "text-base font-semibold mt-2 mb-1",
        4: "text-sm font-semibold mt-2 mb-1",
        5: "text-sm font-medium mt-1 mb-0.5",
        6: "text-sm font-medium mt-1 mb-0.5",
      };
      elements.push(
        <div key={`h-${i}`} className={sizes[level]}>
          {renderInline(text)}
        </div>
      );
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (listItems.length > 0 && listItems[0].ordered) flushList();
      listItems.push({ ordered: false, content: ulMatch[1] });
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (olMatch) {
      if (listItems.length > 0 && !listItems[0].ordered) flushList();
      listItems.push({ ordered: true, content: olMatch[1] });
      continue;
    }

    // Not a list item — flush any pending list
    flushList();

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(
        <hr key={`hr-${i}`} className="border-border my-2" />
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<br key={`br-${i}`} />);
      continue;
    }

    // Regular text line
    elements.push(
      <span key={`line-${i}`}>
        {renderInline(line)}
        {i < lines.length - 1 ? "\n" : ""}
      </span>
    );
  }

  flushList();
  return elements;
}

/** Render inline formatting: bold, italic, inline code. */
function renderInline(text: string): React.ReactNode[] {
  // Process inline code first (to avoid conflicts with * inside code)
  // Pattern: `code` | **bold** | *italic*
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      // Inline code
      parts.push(
        <code
          key={`ic-${match.index}`}
          className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      // Bold
      parts.push(
        <strong key={`b-${match.index}`}>
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*")) {
      // Italic
      parts.push(
        <em key={`i-${match.index}`}>
          {token.slice(1, -1)}
        </em>
      );
    }

    lastIndex = match.index + token.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ChatMessage({
  role,
  content,
  timestamp,
  isStreaming,
}: ChatMessageProps) {
  const isUser = role === "user";

  const rendered = useMemo(
    () => (isUser ? null : renderMarkdown(content)),
    [content, isUser]
  );

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg p-4",
        isUser ? "bg-muted/50" : "bg-card"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary" : "bg-muted"
        )}
      >
        {isUser ? (
          <User className="text-primary-foreground h-4 w-4" />
        ) : (
          <Bot className="text-muted-foreground h-4 w-4" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-medium">
            {isUser ? "You" : "Claude"}
          </span>
          <span className="text-muted-foreground text-xs">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
          {isStreaming && (
            <span className="text-primary animate-pulse text-xs">
              streaming...
            </span>
          )}
        </div>

        <div className="text-sm break-words whitespace-pre-wrap">
          {isUser ? content : rendered}
          {isStreaming && (
            <span className="bg-primary ml-0.5 inline-block h-4 w-2 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}
