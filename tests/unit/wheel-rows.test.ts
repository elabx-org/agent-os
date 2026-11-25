import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWheelCounter,
  isFineClick,
  wheelTravel,
  type WheelLike,
} from "../../lib/wheel-rows";

// A terminal row on the Mac the numbers below were read on
const ROW = 21;
const ROWS = 39;

// What WKWebView on macOS 27 reports for a notched wheel (a Razer's): the
// lines macOS gives (0.1 turned slowly, more as it speeds up) times 40px
const macClick = (lines: number): WheelLike => {
  const px: Record<string, [number, number]> = {
    "0.1": [3.9996337890625, 11],
    "0.2": [7.9998779296875, 23],
    "0.3": [11.99951171875, 35],
    "0.4": [15.999755859375, 47],
    "0.5": [20, 60],
    "0.7": [27.9998779296875, 83],
    "1": [40, 120],
    "2.5": [100, 300],
  };
  const [deltaY, legacy] = px[String(Math.abs(lines))];
  const sign = Math.sign(lines);
  return { deltaY: sign * deltaY, deltaMode: 0, wheelDeltaY: -sign * legacy };
};
const trackpad = (px: number): WheelLike => ({
  deltaY: px,
  deltaMode: 0,
  wheelDeltaY: -3 * px,
});

/** Rows a run of events moves, each `gap` ms after the one before */
function run(events: WheelLike[], gap: number): number[] {
  const rowsOf = createWheelCounter();
  return events.map((ev, i) => rowsOf(ev, ROW, ROWS, 1000 + i * gap));
}
const sum = (rows: number[]) => rows.reduce((a, b) => a + b, 0);

test("each slow click of a Mac's wheel moves a row, either way", () => {
  assert.deepEqual(
    run(Array(10).fill(macClick(-0.1)), 150),
    Array(10).fill(-1)
  );
  assert.deepEqual(run(Array(10).fill(macClick(0.1)), 150), Array(10).fill(1));
  // By its 4px alone a click is a fifth of a row: ten moved one
  assert.equal(Math.trunc(10 * wheelTravel(macClick(0.1), ROW, ROWS)), 1);
});

test("a Mac's wheel turned faster is never under a row a click", () => {
  for (const lines of [0.2, 0.3, 0.4, 0.5, 0.7]) {
    assert.deepEqual(
      run(Array(4).fill(macClick(lines)), 60).slice(0, 2),
      [1, 1],
      String(lines)
    );
  }
  // A whole line and more is its pixels: 40px is nearly two rows
  assert.equal(sum(run(Array(4).fill(macClick(1)), 60)), 7);
  assert.equal(sum(run([macClick(2.5)], 60)), 4);
});

test("a trackpad still moves as far as the fingers went", () => {
  // A glide: 3px every frame, 90px in all
  assert.equal(sum(run(Array(30).fill(trackpad(3)), 16)), Math.trunc(90 / ROW));
  // Creeping: 1px now and then is not a click
  assert.equal(sum(run(Array(21).fill(trackpad(1)), 100)), 1);
  assert.equal(sum(run(Array(20).fill(trackpad(1)), 100)), 0);
  assert.equal(isFineClick(trackpad(1)), false);
  assert.equal(isFineClick(trackpad(7)), false);
});

test("fractions that are not a wheel's clicks add up as travel", () => {
  // A zoomed page's trackpad glide: only the event that begins it can be
  // taken for a click
  const zoomed = Array(30).fill({ deltaY: 2.7272727, deltaMode: 0 });
  assert.equal(sum(run(zoomed, 16)), 1 + Math.trunc((29 * 2.7272727) / ROW));
  // Pinching
  assert.equal(
    isFineClick({ deltaY: 1.37, deltaMode: 0, ctrlKey: true }),
    false
  );
  // Mac clicks that come faster than clicks do
  assert.equal(sum(run(Array(10).fill(macClick(0.1)), 10)), 2);
});

test("a notch elsewhere is three rows, and lines and pages are their own", () => {
  const notch = { deltaY: 100, deltaMode: 0, wheelDeltaY: -120 };
  assert.deepEqual(run([notch, notch], 200), [3, 3]);
  assert.deepEqual(run([{ deltaY: -3, deltaMode: 1 }], 200), [-3]);
  assert.deepEqual(run([{ deltaY: 1, deltaMode: 2 }], 200), [ROWS]);
});

test("turning back does not pay off what was left of the other way", () => {
  const rowsOf = createWheelCounter();
  // 20px up leaves most of a row owed
  assert.equal(rowsOf(trackpad(-20), ROW, ROWS, 0), -1);
  assert.equal(rowsOf(trackpad(-19), ROW, ROWS, 16), 0);
  // 12px down is not a row, whatever was left
  assert.equal(rowsOf(trackpad(12), ROW, ROWS, 32), 0);
  assert.equal(rowsOf(trackpad(12), ROW, ROWS, 48), 1);
});
