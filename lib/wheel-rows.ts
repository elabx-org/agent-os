/**
 * How many terminal rows a wheel event is worth, for a mouse wheel or a
 * trackpad over a terminal whose scrolling tmux (or an app) does: the page
 * sends one wheel event per row (components/Terminal/hooks/wheel.ts).
 */

/** What of a WheelEvent this reads */
export interface WheelLike {
  deltaY: number;
  deltaMode: number;
  /** The legacy value: a notch is 120 on Windows and Linux */
  wheelDeltaY?: number;
  ctrlKey?: boolean;
}

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
// A mouse wheel's notch, as terminals scroll it
const NOTCH_ROWS = 3;
// Wheel events further apart than this are a wheel's clicks, or the first
// of a trackpad's glide (which then comes every frame)
const CLICK_GAP_MS = 40;

/**
 * A mouse wheel's click rather than a trackpad's glide: Chromium and Safari
 * report a notch as a multiple of 120 in the legacy wheelDeltaY (a trackpad
 * gives other values). Its pixels (about 100) have nothing to do with the
 * rows on screen, so a notch is NOTCH_ROWS whatever the row height
 */
function isNotch(ev: WheelLike): boolean {
  return (
    !!ev.wheelDeltaY && ev.wheelDeltaY % 120 === 0 && Math.abs(ev.deltaY) >= 50
  );
}

/**
 * macOS's click of a notched wheel. macOS gives it as a fraction of a line,
 * a tenth when the wheel turns slowly, and the browser makes a line 40px:
 * 4px, a fifth of a row, so five clicks moved one row and a few moved
 * nothing. The fraction comes out of fixed point a hair off a whole pixel
 * (3.99963 in WebKit, 4.00024 in Chromium), which a trackpad's whole pixels
 * never are, nor the plain fractions a zoomed page or a pinch (ctrl) gives.
 */
export function isFineClick(ev: WheelLike): boolean {
  if (ev.ctrlKey || ev.deltaMode !== 0) return false;
  const off = Math.abs(ev.deltaY - Math.round(ev.deltaY));
  return off > 0 && off < 0.01;
}

/** The rows of travel the event's own numbers say, fractions included */
export function wheelTravel(
  ev: WheelLike,
  rowPx: number,
  termRows: number
): number {
  if (ev.deltaMode === DOM_DELTA_LINE) return ev.deltaY;
  if (ev.deltaMode === DOM_DELTA_PAGE) return ev.deltaY * termRows;
  if (isNotch(ev)) return Math.sign(ev.deltaY) * NOTCH_ROWS;
  return ev.deltaY / rowPx;
}

/**
 * Counts whole rows over a run of wheel events: travel adds up, so a
 * trackpad moves the terminal as far as the fingers went. A wheel's click
 * is never less than a row.
 *
 * `now` is when the wheel moved, in ms: the event's own time stamp where it
 * has one, so clicks a busy page handles late and all at once still count
 * as the clicks they were.
 */
export function createWheelCounter(): (
  ev: WheelLike,
  rowPx: number,
  termRows: number,
  now: number
) => number {
  let carry = 0;
  let last = -Infinity;
  return (ev, rowPx, termRows, now) => {
    const gap = now - last;
    last = now;
    const travel = wheelTravel(ev, rowPx, termRows);
    // A click that is under a row moves one: macOS's fine clicks, and
    // any lone event that is most of a row already (macOS's half line)
    const small = Math.abs(travel) < 1;
    if (
      small &&
      gap >= CLICK_GAP_MS &&
      (isFineClick(ev) || Math.abs(travel) >= 0.5)
    ) {
      carry = 0;
      return Math.sign(travel);
    }
    // What is left of the other direction is not owed to this one
    if (carry !== 0 && Math.sign(carry) !== Math.sign(travel)) carry = 0;
    carry += travel;
    // Not -0, which a caller comparing with 0 would trip on
    const rows = Math.trunc(carry) || 0;
    carry -= rows;
    return rows;
  };
}
