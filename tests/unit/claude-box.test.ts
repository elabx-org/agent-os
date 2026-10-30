import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Terminal as XTerm } from "@xterm/xterm";
import {
  boxWindow,
  cellWidth,
  fromHistory,
  isClaudeBusy,
  joinRows,
  paneSize,
  readClaudeBox,
  readClaudeInput,
} from "../../components/Terminal/queued-messages";

// Screens of real Claude Code (2.1.312) captured with tmux capture-pane -e,
// beside a .json with the pane's size and the keys that led there
const DIR = path.join(__dirname, "fixtures", "claude-box");

interface Cell {
  char: string;
  dim: boolean;
  inverse: boolean;
  width: number;
}

/** Just enough of xterm's buffer for the readers: SGR dim and inverse,
    OSC 8 links dropped, wide characters two columns. `cols`: a terminal
    narrower than the pane, which shows its left part */
function fakeTerm(name: string, narrower?: number): XTerm {
  const meta = JSON.parse(
    fs.readFileSync(path.join(DIR, `${name}.json`), "utf8")
  ) as { cols: number; rows: number; cursor?: [number, number] };
  const { rows } = meta;
  const cols = narrower ?? meta.cols;
  const text = fs.readFileSync(path.join(DIR, `${name}.ansi`), "utf8");
  const lines = text.replace(/\n$/, "").split("\n").slice(0, rows);
  const grid: Cell[][] = lines.map((line) => {
    const cells: Cell[] = [];
    let dim = false;
    let inverse = false;
    const raw = line.replace(/\x1b\]8;[^\x1b]*\x1b\\/g, "");
    for (let i = 0; i < raw.length; ) {
      const sgr = /^\x1b\[([\d;]*)m/.exec(raw.slice(i));
      if (sgr) {
        for (const code of (sgr[1] || "0").split(";").map(Number)) {
          if (code === 0) dim = inverse = false;
          else if (code === 2) dim = true;
          else if (code === 22) dim = false;
          else if (code === 7) inverse = true;
          else if (code === 27) inverse = false;
        }
        i += sgr[0].length;
        continue;
      }
      const char = String.fromCodePoint(raw.codePointAt(i)!);
      i += char.length;
      // A skin tone joins the emoji before it
      if (/[\u{1f3fb}-\u{1f3ff}]/u.test(char) && cells.length) {
        cells[cells.length - 2].char += char;
        continue;
      }
      const width = cellWidth(char);
      cells.push({ char, dim, inverse, width });
      if (width === 2) cells.push({ char: "", dim, inverse, width: 0 });
    }
    return cells.slice(0, cols);
  });
  const empty: Cell = { char: "", dim: false, inverse: false, width: 1 };
  const term = {
    cols,
    rows,
    buffer: {
      active: {
        baseY: 0,
        cursorY: meta.cursor?.[1] ?? rows - 1,
        getLine: (y: number) => {
          const cells = grid[y] ?? [];
          return {
            translateToString: () =>
              cells
                .filter((c) => c.width)
                .map((c) => c.char || " ")
                .join("")
                .trimEnd(),
            getCell: (x: number) => {
              const c = cells[x] ?? empty;
              return {
                getChars: () => c.char,
                getWidth: () => c.width,
                isDim: () => (c.dim ? 1 : 0),
                isInverse: () => (c.inverse ? 1 : 0),
              };
            },
          };
        },
      },
    },
  };
  return term as unknown as XTerm;
}

const LONG =
  "reply with only the word yes, this message is deliberately long so " +
  "that it wraps across several rows of the narrow box ok " +
  "https://example.com/a/very/long/path/that/does/not/fit/on/one/row/at/all/xyz end";
const LINES = "reply ok\nsecond line here\nthird";

const read = (name: string) => readClaudeInput(fakeTerm(name));

test("an empty box: the dim placeholder isn't text", () => {
  assert.equal(read("empty-placeholder-58"), "");
  assert.equal(read("down-back-to-empty-58"), "");
});

test("a typed line", () => {
  assert.equal(read("typed-single-58"), "say hi");
});

test("hard line breaks stay line breaks", () => {
  assert.equal(read("backslash-newline-58"), "reply ok\nsecond line here");
  assert.equal(read("meta-enter-newline-58"), LINES);
  assert.equal(read("up6-multiline-58"), LINES);
  assert.equal(read("rewind-restored-prompt-58"), LINES);
  assert.equal(read("ctrl-g-editor-back-58"), "from box and editor\nsecond");
  assert.equal(
    read("paste-again-58"),
    "line one of paste\nline two\nline three\nline four\nline five"
  );
});

test("wrapped rows join with the space the wrap took, none mid-URL", () => {
  assert.equal(read("long-wrapped-typed-58"), LONG);
  assert.equal(read("up1-long-58"), LONG);
  assert.equal(read("ctrl-r-tab-58"), LONG);
  // At 120 columns the same text takes two rows
  assert.equal(read("esc1-hint-120"), LONG);
});

test("the no-break space after ❯ doesn't make the first row full", () => {
  assert.equal(
    read("ctrl-u-multiline-first-58"),
    LONG.slice(LONG.indexOf("deliberately"))
  );
  const entry = read("hist-120-History614")!;
  assert.match(entry, /they appear as a link/);
  assert.match(entry, /IMG_7722\.jpeg when/);
  assert.match(entry, /after uploading an image$/);
  // A 54-column path, broken where it ran to the edge
  assert.match(read("ctrl-r-enter-58")!, /IMG_7722\.jpeg when/);
});

test("leading spaces are kept", () => {
  assert.equal(read("ctrl-k-58"), " wo");
  assert.equal(read("ctrl-y-yank-58"), " words my draft");
});

test("the dim argument hint after a slash command is left out", () => {
  assert.equal(read("slash-tab-complete-58"), "/model");
});

test("placeholders read as Claude holds them", () => {
  assert.equal(read("paste-5lines-58"), "[Pasted text #1 +4 lines]");
  assert.equal(read("image-placeholder-58"), "look [Image #3] please");
});

test("bash mode reads with its !", () => {
  assert.equal(read("bash-mode-typed-58"), "!ls -la");
  assert.equal(read("up-recall-bash-entry-58"), "!echo bashhist");
});

test("no box: search, rewind, an editor, a dialog", () => {
  assert.equal(read("ctrl-r-open-58"), null);
  assert.equal(read("rewind-menu-58"), null);
  assert.equal(read("ctrl-g-editor-open-58"), null);
  assert.equal(read("trust-dialog-58"), null);
  // Draft back after a cancelled search
  assert.equal(read("ctrl-r-esc-restores-draft-58"), "keepme");
});

test("a box under a dialog is still the box", () => {
  assert.equal(read("dialog-above-box-58"), "");
});

test("a box as tall as Claude draws one says so", () => {
  assert.equal(boxWindow(40), 15);
  assert.equal(boxWindow(30), 10);
  assert.equal(boxWindow(24), 7);
  // Claude never windows below 3 rows
  assert.equal(boxWindow(16), 3);
  assert.equal(boxWindow(12), 3);
  const box = readClaudeBox(fakeTerm("tall-box-clipped-58"))!;
  assert.equal(box.tall, true);
  assert.match(box.text, /^row 31 of a tall box\n/);
  assert.equal(readClaudeBox(fakeTerm("up1-long-58"))!.tall, false);
});

test("busy: working and holding a message", () => {
  assert.equal(isClaudeBusy(fakeTerm("busy-working-58")), true);
  assert.equal(isClaudeBusy(fakeTerm("busy-queued-58")), true);
  assert.equal(isClaudeBusy(fakeTerm("up1-long-58")), false);
  assert.equal(isClaudeBusy(fakeTerm("shift-tab-mode2-58")), false);
});

test("joinRows", () => {
  // The next word would have fit: a line break
  assert.equal(joinRows("reply ok", "second line", 54), "\n");
  assert.equal(joinRows("text", "", 54), "\n");
  // Didn't fit: a word wrap
  assert.equal(joinRows("a".repeat(50), "word", 54), " ");
  // A word longer than a row, broken at the edge or after a /
  // Two long words: the wrap took a space
  assert.equal(joinRows("x " + "a".repeat(30), "b".repeat(30), 54), " ");
  assert.equal(joinRows("a".repeat(54), "bbbb", 54), "");
  assert.equal(
    joinRows("ok https://e.com/" + "a/".repeat(17), "path/x/y/z/w/v/u", 54),
    ""
  );
});

test("fromHistory: the exact prompt for what the box shows", () => {
  const entries = ["newer", "reply ok\nsecond line here\nthird", "say hi"];
  const box = { text: "reply ok second line here third", rows: 3, tall: false };
  assert.equal(fromHistory(box, entries), entries[1]);
  assert.equal(fromHistory({ ...box, text: "unknown" }, entries), null);
  // A tall box shows a window of the prompt
  const tall = { text: "line 3\nline 4", rows: 15, tall: true };
  const long = "line 1\nline 2\nline 3\nline 4\nline 5";
  assert.equal(fromHistory(tall, [long]), long);
  assert.equal(fromHistory({ ...tall, tall: false }, [long]), null);
  assert.equal(fromHistory({ ...box, text: "" }, entries), null);
});

test("a short terminal: empty and short boxes aren't tall", () => {
  const empty = readClaudeBox(fakeTerm("empty-12rows-58"))!;
  assert.deepEqual([empty.text, empty.tall], ["", false]);
  const one = readClaudeBox(fakeTerm("typed-12rows-58"))!;
  assert.deepEqual([one.text, one.tall], ["one line typed", false]);
  const two = readClaudeBox(fakeTerm("two-lines-15rows-58"))!;
  assert.deepEqual([two.text, two.tall], ["one line typed\ntwo", false]);
  // 8 lines in Claude's 3-row window
  const eight = readClaudeBox(fakeTerm("eight-lines-14rows-58"))!;
  assert.deepEqual([eight.text, eight.tall], ["l6\nl7\nl8", true]);
});

test("a box run off the bottom of the screen is cut, not missing", () => {
  const box = readClaudeBox(fakeTerm("eight-lines-10rows-58"))!;
  assert.equal(box.tall, true);
  assert.match(box.text, /^l6\nl7\nl8/);
});

test("a terminal bigger than the window: only the pane is read", () => {
  const term = fakeTerm("bigger-client-120");
  assert.deepEqual(paneSize(term), { cols: 50, rows: 15 });
  const box = readClaudeBox(term)!;
  assert.doesNotMatch(box.text, /[│·]/);
  assert.equal(
    box.text,
    "hello there\nsecond this is some more text that will wrap across rows"
  );
  // A terminal the window fits is all pane
  assert.deepEqual(paneSize(fakeTerm("up1-long-58")), { cols: 58, rows: 40 });
});

test("a terminal narrower than the window: the box is cut off", () => {
  // The 120-column screen in a 70-column terminal
  const box = readClaudeBox(fakeTerm("esc1-hint-120", 70))!;
  assert.equal(box.tall, true);
  assert.equal(readClaudeBox(fakeTerm("esc1-hint-120"))!.tall, false);
});

test("wide characters wrap by columns, without a space", () => {
  assert.equal(
    read("cjk-wrapped-58"),
    "你好世界这是一个很长的中文句子用来测试换行是否正确处理宽字符的情况以及读取器是否正确"
  );
  assert.doesNotMatch(read("cjk-bash-120")!, /\n/);
  // A short row before Chinese text: a line break
  assert.match(read("mixed-cjk-recalled-58")!, /second line here\n中文/);
  assert.equal(joinRows("中".repeat(27), "文字", 54), "");
  assert.equal(joinRows("second line here", "中文测试", 54), "\n");
  assert.equal(cellWidth("a中👍🏽"), 5);
});

test("the row Claude's cursor is on", () => {
  assert.equal(readClaudeBox(fakeTerm("multiline-cursor-last-58"))!.cursor, 2);
});

test("fromHistory: a recalled paste comes back renumbered", () => {
  const box = readClaudeBox(fakeTerm("paste-recalled-renumbered-120"))!;
  assert.equal(box.text, "[Pasted text #2 +4 lines] say ok");
  const entries = ["[Pasted text #1 +4 lines]  say\nok"];
  // The box's numbers, history's line breaks
  assert.equal(
    fromHistory({ ...box, rows: 2 }, entries),
    "[Pasted text #2 +4 lines]  say\nok"
  );
});
