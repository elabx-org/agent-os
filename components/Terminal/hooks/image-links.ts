import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { showImage } from "@/lib/client/image-view";

/**
 * Picture paths in the terminal open the picture (the paths of images sent
 * to Claude, and its "Reading …" lines). Claude Code wraps a long path onto
 * the next row, at the pane's edge or at a "/", so a path that ends a row
 * and isn't a picture yet takes the next row's first word.
 */

const IMAGE = /^(?:~|\/)\S*\.(?:png|jpe?g|gif|webp|heic|heif|bmp)$/i;
const PATH_START = /^(?:~\/|\/)/;
const MAX_ROWS = 4;

export interface Cell {
  row: number;
  col: number;
}

export interface FoundImage {
  path: string;
  start: Cell;
  /** The path's last character */
  end: Cell;
}

interface Word {
  text: string;
  col: number;
}

const words = (line: string): Word[] =>
  [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0], col: m.index }));

/** Quotes or brackets around a path aren't part of it */
function trim(word: Word): Word {
  const lead = word.text.match(/^[("'`[<]+/)?.[0].length ?? 0;
  const text = word.text.slice(lead).replace(/[)"'`\]>.,;:!?]+$/, "");
  return { text, col: word.col + lead };
}

/** Picture paths in these rows (row numbers count from `first`) */
export function findImagePaths(rows: string[], first = 0): FoundImage[] {
  const lines = rows.map(words);
  const found: FoundImage[] = [];
  // Rows whose first word went on the end of a path above
  const taken = new Set<number>();
  lines.forEach((row, r) => {
    row.forEach((raw, w) => {
      if (w === 0 && taken.has(r)) return;
      const word = trim(raw);
      if (!PATH_START.test(word.text)) return;
      let path = word.text;
      let end: Cell = { row: r, col: word.col + path.length - 1 };
      // Ends its row without being a picture: carry on onto the next rows
      let last = w === row.length - 1 && raw.text === word.text;
      let next = r + 1;
      while (
        !IMAGE.test(path) &&
        last &&
        next < lines.length &&
        next - r < MAX_ROWS &&
        lines[next].length
      ) {
        const piece = trim(lines[next][0]);
        if (piece.col !== lines[next][0].col) break;
        path += piece.text;
        end = { row: next, col: piece.col + piece.text.length - 1 };
        last = lines[next].length === 1 && piece.text === lines[next][0].text;
        next++;
      }
      if (!IMAGE.test(path)) return;
      for (let t = r + 1; t <= end.row; t++) taken.add(t);
      found.push({
        path,
        start: { row: first + r, col: word.col },
        end: { row: first + end.row, col: end.col },
      });
    });
  });
  return found;
}

export function registerImageLinks(term: Terminal) {
  const text = (row: number) =>
    term.buffer.active.getLine(row)?.translateToString(true) ?? "";

  const provider: ILinkProvider = {
    provideLinks(y, callback) {
      const row = y - 1;
      const first = Math.max(0, row - (MAX_ROWS - 1));
      const last = Math.min(term.buffer.active.length - 1, row + MAX_ROWS - 1);
      const rows: string[] = [];
      for (let r = first; r <= last; r++) rows.push(text(r));
      const links: ILink[] = findImagePaths(rows, first)
        .filter((f) => f.start.row <= row && f.end.row >= row)
        .map((f) => ({
          range: {
            start: { x: f.start.col + 1, y: f.start.row + 1 },
            end: { x: f.end.col + 1, y: f.end.row + 1 },
          },
          text: f.path,
          activate: () => showImage(term.element, f.path),
        }));
      callback(links.length ? links : undefined);
    },
  };
  return term.registerLinkProvider(provider);
}
