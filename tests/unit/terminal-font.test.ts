import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readTerminalFont,
  terminalFontFamily,
  terminalFontSpec,
} from "../../lib/terminal-font";

test("an unknown saved font falls back to JetBrains Mono", () => {
  assert.equal(readTerminalFont("plex"), "plex");
  assert.equal(readTerminalFont("menlo"), "jetbrains");
  assert.equal(readTerminalFont(null), "jetbrains");
});

test("the chosen font leads, the other follows", () => {
  assert.match(
    terminalFontFamily("plex"),
    /^"IBM Plex Mono", "JetBrains Mono"/
  );
  assert.match(
    terminalFontFamily("jetbrains"),
    /^"JetBrains Mono", "IBM Plex Mono"/
  );
  assert.equal(terminalFontSpec("plex"), '13px "IBM Plex Mono"');
});
