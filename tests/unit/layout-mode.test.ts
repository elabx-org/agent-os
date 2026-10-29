import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOpenDuoSize,
  throughKeyboard,
  layoutModeFor,
  type LayoutInputs,
} from "../../hooks/useLayoutMode";

const BASE: LayoutInputs = {
  width: 1440,
  height: 900,
  touch: false,
  sideRail: 0,
  openDuo: false,
  fold: null,
  native: false,
};

/** As useLayoutModeSource measures it */
function mode(inputs: Partial<LayoutInputs>) {
  const all = { ...BASE, ...inputs };
  return layoutModeFor({
    ...all,
    openDuo: isOpenDuoSize(all.width, all.height, all.touch, all.duo),
  });
}

const FOLD_H = { axis: "horizontal" as const, start: 463, end: 487 };
const FOLD_V = { axis: "vertical" as const, start: 463, end: 487 };

test("layoutModeFor: the e2e postures", () => {
  // closed: the app's object and ?siderail=86
  assert.equal(
    mode({ width: 466, height: 678, touch: true, native: true, sideRail: 86 }),
    "duo-closed"
  );
  // open: 951x669 with duo:true is the Duo, not a desktop (M1b relies on it)
  assert.equal(
    mode({ width: 951, height: 669, touch: true, native: true, duo: true }),
    "duo-open"
  );
  assert.equal(
    mode({ width: 951, height: 669, touch: false, native: true, duo: true }),
    "duo-open"
  );
  // tabletop: ?fold=h
  assert.equal(
    mode({ width: 669, height: 951, touch: true, fold: FOLD_H }),
    "tabletop"
  );
  assert.equal(mode({ width: 1440, height: 900 }), "desktop");
  assert.equal(mode({ width: 390, height: 844, touch: true }), "phone");
});

test("layoutModeFor: Safari on the Duo", () => {
  // Closed: the system column is a safe-area inset
  assert.equal(
    mode({ width: 466, height: 678, touch: true, sideRail: 86 }),
    "duo-closed"
  );
  // Too narrow an inset is no column
  assert.equal(
    mode({ width: 466, height: 678, touch: true, sideRail: 40 }),
    "phone"
  );
  // Open flat: guessed by size on a touch screen
  assert.equal(mode({ width: 951, height: 669, touch: true }), "duo-open");
  // Half open like a book
  assert.equal(
    mode({ width: 951, height: 669, touch: true, fold: FOLD_V }),
    "book"
  );
});

test("layoutModeFor: a desktop window the Duo's size stays a desktop", () => {
  assert.equal(mode({ width: 951, height: 669, touch: false }), "desktop");
  // An app build that says it isn't a Duo
  assert.equal(
    mode({ width: 951, height: 669, touch: true, native: true, duo: false }),
    "desktop"
  );
});

test("layoutModeFor: inside the app", () => {
  // A Duo build, closed (the app's own column, no web inset)
  assert.equal(
    mode({ width: 466, height: 678, touch: true, native: true, duo: true }),
    "duo-closed"
  );
  // 0.1.62 doesn't say: the closed Duo's squarer screen
  assert.equal(
    mode({ width: 466, height: 678, touch: true, native: true }),
    "duo-closed"
  );
  // A regular iPhone in the app
  assert.equal(
    mode({ width: 390, height: 844, touch: true, native: true }),
    "phone"
  );
  assert.equal(
    mode({ width: 390, height: 844, touch: true, native: true, duo: false }),
    "phone"
  );
  // The app's fold, half open
  assert.equal(
    mode({ width: 669, height: 951, touch: true, native: true, fold: FOLD_H }),
    "tabletop"
  );
});

test("isOpenDuoSize: only landscape, and the app's word first", () => {
  assert.equal(isOpenDuoSize(669, 951, true, true), false);
  assert.equal(isOpenDuoSize(1200, 800, false, true), true);
  assert.equal(isOpenDuoSize(951, 669, true, false), false);
  assert.equal(isOpenDuoSize(1024, 768, true, undefined), false);
});

test("throughKeyboard: a shorter screen at the same width keeps the answer", () => {
  const open = throughKeyboard((w, h) => isOpenDuoSize(w, h, true, undefined));
  assert.equal(open(951, 669), true);
  // The keyboard up on the open Duo
  assert.equal(open(951, 339), true);
  assert.equal(open(951, 669), true);
  // Turned: the width changes, so it asks again
  assert.equal(open(669, 951), false);
  assert.equal(open(669, 533), false);
});
