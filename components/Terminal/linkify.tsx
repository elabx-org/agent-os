import type { ReactNode } from "react";
import { openLink } from "./hooks/wrapped-links";

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g;

const URL_TAIL = /https?:\/\/[^\s<>"'`]+$/;
const URL_CHAR = /^[\w\-.~:/?#[\]@!$&'()*+,;=%]/;

/**
 * Puts URLs that Claude Code broke at the pane's edge back together, so they
 * copy and open whole (the terminal's link finder does the same on screen)
 */
export function joinWrappedUrls(text: string, cols: number): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const next = line.trimStart();
    if (
      prev !== undefined &&
      prev.trimEnd().length >= cols - 1 &&
      URL_TAIL.test(prev.trimEnd()) &&
      URL_CHAR.test(next)
    ) {
      out[out.length - 1] = prev.trimEnd() + next;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

/** Plain text with its URLs as tappable links (the select-mode copy view) */
export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0];
    out.push(text.slice(last, match.index));
    out.push(
      <a
        key={match.index}
        href={url}
        onClick={(e) => {
          e.preventDefault();
          openLink(url);
        }}
        className="text-primary underline underline-offset-2"
      >
        {url}
      </a>
    );
    last = match.index + url.length;
  }
  out.push(text.slice(last));
  return out;
}
