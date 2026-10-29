import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOOK, parseLook, type Look } from "../../lib/look";
import {
  lookDiffers,
  lookSummary,
  mergeLook,
  modeFromTheme,
  readSynced,
} from "../../lib/look-sync";
import { offsetLabel } from "../../lib/display-density";

const local: Look = {
  mode: "light",
  accent: "blue",
  textSize: 2,
  synced: true,
};

test("synced: the server's look wins on load", () => {
  const server = { mode: "dark", accent: "green", textSize: -1, synced: true };
  const merged = mergeLook(local, server, true);
  assert.deepEqual(merged, { ...parseLook(server), synced: true });
  assert.notDeepEqual(merged, local);
});

test("synced with no server look yet: this device's stays (and seeds it)", () => {
  assert.equal(mergeLook(local, null, true), local);
  assert.equal(mergeLook(local, undefined, true), local);
});

test("unsynced: this device keeps its own whatever the server has", () => {
  const own = { ...local, synced: false };
  const server = { mode: "dark", accent: "green", textSize: 0, synced: true };
  assert.equal(mergeLook(own, server, false), own);
});

test("an invalid server look falls back to the defaults, still synced", () => {
  for (const bad of ["garbage", 42, [], { mode: "sepia", accent: "pink" }]) {
    assert.deepEqual(mergeLook(local, bad, true), {
      ...DEFAULT_LOOK,
      synced: true,
    });
  }
});

test("lookDiffers ignores the sync choice", () => {
  assert.equal(lookDiffers(local, { ...local, synced: false }), false);
  assert.equal(lookDiffers(local, { ...local, accent: "orange" }), true);
  assert.equal(lookDiffers(local, { ...local, textSize: 0 }), true);
  assert.equal(lookDiffers(local, { ...local, mode: "system" }), true);
});

test("modeFromTheme passes the new modes through", () => {
  assert.equal(modeFromTheme("light"), "light");
  assert.equal(modeFromTheme("dark"), "dark");
  assert.equal(modeFromTheme("system"), "system");
});

test("readSynced: on unless this device turned it off", () => {
  assert.equal(readSynced(null), true);
  assert.equal(readSynced("1"), true);
  assert.equal(readSynced("0"), false);
  assert.equal(readSynced("false"), false);
});

test("lookSummary and the text size label read as Settings shows them", () => {
  assert.equal(
    lookSummary({ mode: "dark", accent: "purple" }),
    "Dark · Purple"
  );
  assert.equal(
    lookSummary({ mode: "system", accent: "graphite" }),
    "Automatic · Graphite"
  );
  assert.equal(offsetLabel(0), "Default");
  assert.equal(offsetLabel(2), "+2");
  assert.equal(offsetLabel(-1), "−1");
});
