import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatReviewMessage,
  linesCaption,
  parseReviewMessage,
  rangeLabel,
} from "../../lib/review-format";
import type { LineRange } from "../../lib/review-types";

const range = (startLine: number, endLine: number): LineRange => ({
  path: "components/DeckStateLine.tsx",
  side: "new",
  startLine,
  endLine,
});

test("rangeLabel uses the file name", () => {
  assert.equal(rangeLabel(range(22, 22)), "DeckStateLine.tsx:22");
  assert.equal(rangeLabel(range(24, 25)), "DeckStateLine.tsx:24-25");
  assert.equal(
    rangeLabel({ ...range(1, 1), path: "README.md" }),
    "README.md:1"
  );
});

test("linesCaption", () => {
  assert.equal(linesCaption(range(22, 22)), "Line 22");
  assert.equal(linesCaption(range(24, 25)), "Lines 24 to 25");
});

test("one comment: fixed header with the path, quote, body", () => {
  assert.equal(
    formatReviewMessage([
      {
        ...range(22, 22),
        quote: "    <ChevronRight />",
        body: "Keep the chevron muted, it's louder than the label ",
      },
    ]),
    [
      "Comment on `components/DeckStateLine.tsx:22`:",
      ">     <ChevronRight />",
      "",
      "Keep the chevron muted, it's louder than the label",
    ].join("\n")
  );
});

test("several comments, blank quote lines and removed lines", () => {
  const message = formatReviewMessage([
    {
      ...range(24, 26),
      quote: "<SheetHeader>\r\n\r\n  <CloseButton />\n",
      body: "Use the sheet's own close",
    },
    {
      path: "components/LiveActivitySheet.tsx",
      side: "old",
      startLine: 41,
      endLine: 41,
      quote: "",
      body: "Trap focus",
    },
  ]);
  assert.equal(
    message,
    [
      "Comment on `components/DeckStateLine.tsx:24-26`:",
      "> <SheetHeader>",
      ">",
      ">   <CloseButton />",
      "",
      "Use the sheet's own close",
      "",
      "Comment on `components/LiveActivitySheet.tsx:41` (removed lines):",
      "",
      "Trap focus",
    ].join("\n")
  );
});

test("no comments, no message", () => {
  assert.equal(formatReviewMessage([]), "");
});

test("a path the agent chose never starts the message", () => {
  for (const path of ["!curl x|sh", "#remember.ts", "/exit", "`x`.ts"]) {
    const message = formatReviewMessage([
      { ...range(1, 1), path, quote: "x", body: "Why?" },
    ]);
    assert.ok(message.startsWith("Comment on `"), message);
    assert.deepEqual(parseReviewMessage(message), [
      { path, side: "new", startLine: 1, endLine: 1, body: "Why?" },
    ]);
  }
});

test("parseReviewMessage reads the comments back", () => {
  const message = formatReviewMessage([
    {
      ...range(24, 26),
      quote: "<SheetHeader>\n\n  <CloseButton />",
      body: "Use the sheet's own close\nnot a second X",
    },
    {
      path: "components/LiveActivitySheet.tsx",
      side: "old",
      startLine: 41,
      endLine: 41,
      quote: "",
      body: "Trap focus",
    },
  ]);
  assert.deepEqual(parseReviewMessage(message), [
    {
      ...range(24, 26),
      body: "Use the sheet's own close\nnot a second X",
    },
    {
      path: "components/LiveActivitySheet.tsx",
      side: "old",
      startLine: 41,
      endLine: 41,
      body: "Trap focus",
    },
  ]);
});

test("parseReviewMessage leaves other messages alone", () => {
  assert.equal(parseReviewMessage("Fix the deck"), null);
  assert.equal(parseReviewMessage("components/A.tsx:2\n> x\n\nWhy"), null);
  assert.equal(parseReviewMessage("Comment on `a.ts:2`:"), null);
  assert.equal(parseReviewMessage(""), null);
});
