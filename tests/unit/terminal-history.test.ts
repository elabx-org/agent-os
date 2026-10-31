import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  color256,
  coast,
  historyCommand,
  nearest256,
  historyPalette,
  newHistoryStyle,
  parseHistory,
  rowsToHtml,
  rowToHtml,
} from "../../lib/terminal-history";

const palette = historyPalette({
  foreground: "#eeeeee",
  background: "#000000",
  red: "#ff0000",
  brightRed: "#ff8888",
});

test("the 256-colour palette: cube and greys", () => {
  assert.equal(color256(16), "#000000");
  assert.equal(color256(21), "#0000ff");
  assert.equal(color256(141), "#af87ff");
  assert.equal(color256(231), "#ffffff");
  assert.equal(color256(232), "#080808");
  assert.equal(color256(255), "#eeeeee");
});

test("plain text is escaped, unstyled", () => {
  assert.equal(
    rowToHtml("a <b> & c", newHistoryStyle(), palette),
    "a &lt;b&gt; &amp; c"
  );
});

const rgbPalette = { ...palette, rgb: true };

test("tmux's nearest 256 colour for RGB", () => {
  assert.equal(nearest256(0x87, 0x00, 0x5f), 89);
  // Claude's diff backgrounds, as tmux sends them without true colour
  assert.equal(nearest256(122, 41, 54), 89);
  assert.equal(nearest256(34, 92, 43), 237);
  assert.equal(nearest256(255, 255, 255), 231);
  assert.equal(nearest256(1, 1, 1), 16);
});

test("RGB as tmux sends it: true colour, or the nearest of 256", () => {
  assert.equal(
    rowToHtml("\x1b[48;2;122;41;54mx", newHistoryStyle(), palette),
    '<span style="background:#87005f">x</span>'
  );
  assert.equal(
    rowToHtml("\x1b[48;2;122;41;54mx", newHistoryStyle(), rgbPalette),
    '<span style="background:#7a2936">x</span>'
  );
});

test("colours: 16, 256 and true colour, then reset", () => {
  const html = rowToHtml(
    "\x1b[31mred\x1b[38;5;141mviolet\x1b[38;2;1;2;3mrgb\x1b[0m plain",
    newHistoryStyle(),
    rgbPalette
  );
  assert.equal(
    html,
    '<span style="color:#ff0000">red</span>' +
      '<span style="color:#af87ff">violet</span>' +
      '<span style="color:#010203">rgb</span> plain'
  );
});

test("bold draws the ANSI colours bright, as xterm does", () => {
  const html = rowToHtml("\x1b[1;31mx", newHistoryStyle(), palette);
  assert.equal(
    html,
    '<span style="color:#ff8888;font-weight:var(--bold)">x</span>'
  );
});

test("inverse swaps in the default colours", () => {
  const html = rowToHtml("\x1b[7mx", newHistoryStyle(), palette);
  assert.equal(html, '<span style="color:#000000;background:#eeeeee">x</span>');
});

test("backgrounds, dim, italic, underline", () => {
  const html = rowToHtml(
    "\x1b[48;2;34;92;43m+\x1b[49;2;3;4mz",
    newHistoryStyle(),
    rgbPalette
  );
  assert.equal(
    html,
    '<span style="background:#225c2b">+</span>' +
      '<span style="color:#eeeeee80;font-style:italic;text-decoration:underline">z</span>'
  );
});

test("style carries from one row to the next, as tmux prints it", () => {
  const [a, b] = rowsToHtml(["\x1b[31mone", "two\x1b[0m three"], palette);
  assert.equal(a, '<span style="color:#ff0000">one</span>');
  assert.equal(b, '<span style="color:#ff0000">two</span> three');
});

test("hyperlinks and other escapes don't show", () => {
  const html = rowToHtml(
    "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x07\x1b[?25h!",
    newHistoryStyle(),
    palette
  );
  assert.equal(html, "link!");
});

test("parseHistory: header, then rows as printed", () => {
  const parsed = parseHistory(
    "agentos-history 1804 0 1 12 -400\n\nrow 1\nrow 2\n\n"
  );
  assert.deepEqual(parsed?.header, {
    historySize: 1804,
    alternate: false,
    mouseApp: true,
    scrolled: 12,
    start: -400,
    rgb: false,
  });
  assert.equal(
    parseHistory("agentos-history 5 0 0 0 -5 1\nx")?.header.rgb,
    true
  );
  assert.deepEqual(parsed?.rows, ["", "row 1", "row 2", ""]);
  assert.equal(parseHistory(""), null);
  assert.deepEqual(parseHistory("agentos-history 0 1 0 0 0\n")?.rows, []);
});

// The command against a stand-in tmux that prints what it was asked
function run(command: string, historySize: number) {
  const fake =
    "tmux() { case $1 in " +
    'list-clients) echo "/dev/pts/9 %3 1"; echo "/dev/pts/2 %1 0";; ' +
    `display) echo "${historySize} 0 0 0 26";; ` +
    'capture-pane) shift; echo "capture $*";; esac; }; ';
  return execFileSync("bash", ["-c", fake + command], {
    env: { ...process.env, AGENT_OS_TTY: "/dev/pts/9" },
  }).toString();
}

test("historyCommand: the screen and the history above it, from a block's first row", () => {
  // 1804 + 26 rows; 300 asked for: from row 1500 (a multiple of 100)
  assert.equal(
    run(historyCommand({ last: 300, block: 100 }), 1804),
    "agentos-history 1804 0 0 0 -304 1\ncapture -t %3 -p -e -N -S -304 -E 25\n"
  );
  // Less history than asked for: all of it
  assert.equal(
    run(historyCommand({ last: 300, block: 100 }), 50),
    "agentos-history 50 0 0 0 -50 1\ncapture -t %3 -p -e -N -S -50 -E 25\n"
  );
});

test("historyCommand: rows counted from the oldest, wherever new output moved them", () => {
  // Opened at 1800 rows of history; 10 more came since
  assert.equal(
    run(historyCommand({ from: 1500, to: 1599 }), 1810),
    "agentos-history 1810 0 0 0 -310 1\ncapture -t %3 -p -e -N -S -310 -E -211\n"
  );
  assert.equal(
    run(historyCommand({ from: 0, to: 99 }), 1800),
    "agentos-history 1800 0 0 0 -1800 1\ncapture -t %3 -p -e -N -S -1800 -E -1701\n"
  );
  // None: the header only
  assert.equal(
    run(historyCommand({ from: 5, to: 4 }), 1800),
    "agentos-history 1800 0 0 0 -1795 1\n"
  );
});

test("coast: decays, and covers the integral of the velocity", () => {
  const { distance, v } = coast(2, 16);
  assert.ok(v < 2 && v > 1.8);
  assert.ok(distance > 1.8 * 16 && distance < 2 * 16);
  assert.equal(coast(0, 16).distance, 0);
});
