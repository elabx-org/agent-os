import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { openSessionLink } from "@/lib/client/link-target";

/**
 * Links that run onto the next row. Claude Code wraps its own text, so a long
 * URL is broken at the edge of the pane and continues on the next row after
 * the paragraph's indent; tmux breaks raw output at the edge too. The rows are
 * separate lines to xterm, so its web-links addon sees two half links.
 *
 * A row continues into the next when its text reaches the right edge and the
 * next row carries on without a space (after its indent). This provider only
 * reports URLs that span rows; WebLinksAddon keeps the one-row ones.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
const URL_CHAR = /[\w\-.~:/?#[\]@!$&'()*+,;=%]/;
const MAX_ROWS = 8;
const SENTENCE_END = /[.,;:!?]['")\]]*$|[)\]]$/;
const PLAIN_WORD = /^[A-Za-z][a-z]*[.,;:!?'")\]]*$/;
const LIST_NUMBER = /^\d+[.)]$/;
/** How far short of the edge Claude Code wraps a tool's output */
const SHORT_WRAP_MARGIN = 10;

/**
 * A row's text runs on into the next row's: it reaches the right edge and
 * the next carries on without a space. Not when the row ends a sentence
 * (".", ")." …) and the next starts a plain word: a paragraph whose line
 * happens to fill the pane, not a URL broken at the edge.
 *
 * Claude Code wraps a tool's output a few columns short of the edge, so a
 * row ending in a URL near the edge runs on too, but only into a piece of
 * one: not a plain word, a list number or a lone character.
 */
export function rowRunsOn(row: string, next: string, cols: number): boolean {
  const line = row.trimEnd();
  if (!line || !URL_CHAR.test(line[line.length - 1])) return false;
  const rest = next.trimStart();
  if (!rest || !URL_CHAR.test(rest[0])) return false;
  const word = rest.split(/\s/)[0];
  // Claude Code leaves a column of margin; tmux fills the row
  if (line.length >= cols - 1)
    return !(SENTENCE_END.test(line) && PLAIN_WORD.test(word));
  if (line.length < cols - SHORT_WRAP_MARGIN) return false;
  const last = line.trimStart().split(/\s/).pop() ?? "";
  const inUrl = /^https?:\/\//.test(last) || last === line.trimStart();
  return (
    inUrl &&
    !SENTENCE_END.test(line) &&
    word.length > 1 &&
    !PLAIN_WORD.test(word) &&
    !LIST_NUMBER.test(word)
  );
}

/** A matched URL without the sentence's punctuation after it */
export function trimUrl(match: string): string {
  let uri = match.replace(/[.,;:!?'"]+$/, "");
  // A closing bracket belongs to the URL only when it opened one
  while (
    /[)\]]$/.test(uri) &&
    (uri.match(/[([]/g)?.length ?? 0) < (uri.match(/[)\]]/g)?.length ?? 0)
  ) {
    uri = uri.slice(0, -1);
  }
  return uri;
}

/**
 * The URL at column `col` of `rows[index]` (plain text rows of a pane
 * `cols` wide), following it onto the rows before and after when Claude
 * Code or tmux broke it at the edge. Null when there's none there.
 */
export function urlAt(
  rows: readonly string[],
  index: number,
  col: number,
  cols: number
): string | null {
  const row = rows[index];
  if (row === undefined) return null;
  let first = index;
  while (
    first > 0 &&
    index - first < MAX_ROWS &&
    rowRunsOn(rows[first - 1], rows[first], cols)
  )
    first--;
  let last = index;
  while (
    last + 1 < rows.length &&
    last - first < MAX_ROWS &&
    rowRunsOn(rows[last], rows[last + 1], cols)
  )
    last++;

  // The joined text, and where the tapped character falls in it
  let joined = "";
  let at = -1;
  for (let r = first; r <= last; r++) {
    const raw = rows[r];
    const trimmed = r === last ? raw : raw.trimEnd();
    const start = r === first ? 0 : raw.length - raw.trimStart().length;
    if (r === index) {
      // The indent before a broken URL's rest
      if (col < start) return null;
      at = joined.length + (col - start);
    }
    joined += trimmed.slice(start);
  }
  if (at < 0) return null;
  for (const match of joined.matchAll(URL_PATTERN)) {
    const uri = trimUrl(match[0]);
    if (at >= match.index && at < match.index + uri.length) return uri;
  }
  return null;
}

export function openLink(uri: string) {
  // localhost links go through the port proxy; the iOS app opens
  // window.open targets in Safari
  openSessionLink(uri);
}

export function registerWrappedLinks(term: Terminal) {
  const text = (row: number) =>
    term.buffer.active.getLine(row)?.translateToString(true) ?? "";

  /** Row (0-based) runs into row + 1 */
  const continues = (row: number) =>
    row + 1 < term.buffer.active.length &&
    rowRunsOn(text(row), text(row + 1), term.cols);

  const provider: ILinkProvider = {
    provideLinks(y, callback) {
      const row = y - 1;
      let first = row;
      while (first > 0 && row - first < MAX_ROWS && continues(first - 1))
        first--;
      let last = row;
      while (last - first < MAX_ROWS && continues(last)) last++;
      if (first === last) return callback(undefined);

      // The joined text, and where each of its characters sits on screen
      let joined = "";
      const cells: { row: number; col: number }[] = [];
      for (let r = first; r <= last; r++) {
        const raw = text(r);
        const trimmed = r === last ? raw : raw.trimEnd();
        const start = r === first ? 0 : raw.length - raw.trimStart().length;
        for (let c = start; c < trimmed.length; c++) {
          joined += trimmed[c];
          cells.push({ row: r, col: c });
        }
      }

      const links: ILink[] = [];
      for (const match of joined.matchAll(URL_PATTERN)) {
        const uri = trimUrl(match[0]);
        const from = cells[match.index];
        const to = cells[match.index + uri.length - 1];
        if (!from || !to || from.row === to.row) continue;
        if (row < from.row || row > to.row) continue;
        links.push({
          range: {
            start: { x: from.col + 1, y: from.row + 1 },
            end: { x: to.col + 1, y: to.row + 1 },
          },
          text: uri,
          activate: () => openLink(uri),
        });
      }
      callback(links.length ? links : undefined);
    },
  };
  return term.registerLinkProvider(provider);
}
