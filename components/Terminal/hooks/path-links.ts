import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { showFile, showImage } from "@/lib/client/image-view";

/**
 * Paths in the terminal are links: a picture opens full screen (the paths
 * of images sent to Claude, its "Reading …" lines), a source file opens in
 * Files at its line ("components/Foo.tsx:42", "Update(lib/db.ts)"). Claude
 * Code wraps a long path onto the next row, at the pane's edge or at a "/",
 * so a path that ends a row and isn't whole yet takes the next row's first
 * word.
 */

const IMAGE = /^(?:~|\/)\S*\.(?:png|jpe?g|gif|webp|heic|heif|bmp)$/i;
const FILE =
  /^((?:~\/|\.{1,2}\/|\/)?(?:[\w@.+\-[\]]+\/)*[\w@+\-[\]][\w@.+\-[\]]*\.(?:tsx?|jsx?|mjs|cjs|json|md|mdx|py|go|rs|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|css|scss|html|vue|svelte|ya?ml|toml|sh|sql|txt|xml|gradle|dart|lua|ex|exs|prisma|graphql|conf|ini|lock))(?::(\d+))?(?::\d+)?$/i;
const MAX_ROWS = 4;

export interface Cell {
  row: number;
  col: number;
}

export interface FoundPath {
  kind: "image" | "file";
  path: string;
  /** A file's line, from "path:42" */
  line?: number;
  start: Cell;
  /** The path's last character */
  end: Cell;
}

interface Word {
  text: string;
  col: number;
}

// Brackets of a call or a sentence end a word; [] stays (Next's [id] folders)
const words = (line: string): Word[] =>
  [...line.matchAll(/[^\s()"'`<>,]+/g)].map((m) => ({
    text: m[0],
    col: m.index,
  }));

/** Punctuation after a path, and a bracket that isn't one of its own */
function trim(word: Word): Word {
  let { text, col } = word;
  text = text.replace(/[.;:!?]+$/, "");
  if (text.startsWith("[") && !text.includes("]")) {
    text = text.slice(1);
    col++;
  }
  if (text.endsWith("]") && !text.includes("[")) text = text.slice(0, -1);
  return { text, col };
}

function match(path: string): Pick<FoundPath, "kind" | "line"> | null {
  if (IMAGE.test(path)) return { kind: "image" };
  const file = path.match(FILE);
  if (!file) return null;
  return { kind: "file", line: file[2] ? Number(file[2]) : undefined };
}

/** Starts like a path: may carry on onto the next row */
const pathLike = (text: string) => /^(?:~|\.{0,2}\/)|\//.test(text);

/** Paths in these rows (row numbers count from `first`) */
export function findPaths(rows: string[], first = 0): FoundPath[] {
  const lines = rows.map(words);
  const found: FoundPath[] = [];
  // Rows whose first word went on the end of a path above
  const taken = new Set<number>();
  lines.forEach((row, r) => {
    row.forEach((raw, w) => {
      if (w === 0 && taken.has(r)) return;
      const word = trim(raw);
      if (!word.text) return;
      let path = word.text;
      let end: Cell = { row: r, col: word.col + path.length - 1 };
      let hit = match(path);
      // Ends its row without being whole: carry on onto the next rows
      let last = w === row.length - 1 && raw.text === word.text;
      let next = r + 1;
      while (
        !hit &&
        last &&
        pathLike(path) &&
        next < lines.length &&
        next - r < MAX_ROWS &&
        lines[next].length
      ) {
        const piece = trim(lines[next][0]);
        if (piece.col !== lines[next][0].col) break;
        path += piece.text;
        end = { row: next, col: piece.col + piece.text.length - 1 };
        hit = match(path);
        last = lines[next].length === 1 && piece.text === lines[next][0].text;
        next++;
      }
      if (!hit) return;
      for (let t = r + 1; t <= end.row; t++) taken.add(t);
      found.push({
        ...hit,
        // Without its ":42"
        path: hit.kind === "file" ? path.replace(/(?::\d+){1,2}$/, "") : path,
        start: { row: first + r, col: word.col },
        end: { row: first + end.row, col: end.col },
      });
    });
  });
  return found;
}

export function registerPathLinks(term: Terminal) {
  const text = (row: number) =>
    term.buffer.active.getLine(row)?.translateToString(true) ?? "";

  const provider: ILinkProvider = {
    provideLinks(y, callback) {
      const row = y - 1;
      const first = Math.max(0, row - (MAX_ROWS - 1));
      const last = Math.min(term.buffer.active.length - 1, row + MAX_ROWS - 1);
      const rows: string[] = [];
      for (let r = first; r <= last; r++) rows.push(text(r));
      const links: ILink[] = findPaths(rows, first)
        .filter((f) => f.start.row <= row && f.end.row >= row)
        .map((f) => ({
          range: {
            start: { x: f.start.col + 1, y: f.start.row + 1 },
            end: { x: f.end.col + 1, y: f.end.row + 1 },
          },
          text: f.path,
          activate: () =>
            f.kind === "image"
              ? showImage(term.element, f.path)
              : showFile(term.element, f.path, f.line),
        }));
      callback(links.length ? links : undefined);
    },
  };
  return term.registerLinkProvider(provider);
}
