import { test } from "node:test";
import assert from "node:assert/strict";
import { splitUndoNotice, undoNoticeText } from "../../lib/queue/types";
import {
  formatAttachmentBlock,
  splitAttachmentBlock,
  type AttachmentBlockEntry,
} from "../../lib/session-attach-types";

const health: AttachmentBlockEntry = {
  name: "Stack health check",
  projectName: "komodo-ai-operations",
  summary: "Checked every stack. Herald fails its healthcheck on /ready.",
};
const deck: AttachmentBlockEntry = {
  name: "Deck state line fix",
  projectName: null,
  summary: "Fixed the state line.\nTests pass.",
};

/** The chat's split, as Conversation does it */
function split(sent: string) {
  const notice = splitUndoNotice(sent);
  return {
    ...splitAttachmentBlock(notice.text),
    undoneTurn: notice.undoneTurn,
  };
}

test("the block comes off the user's text, its session named", () => {
  const sent = `${formatAttachmentBlock([health])}\n\nfix herald`;
  assert.deepEqual(splitAttachmentBlock(sent), {
    text: "fix herald",
    attached: ["Stack health check"],
  });
});

test("an undo notice in front, then the block, then the text", () => {
  const notice = undoNoticeText(2, ["src/a.ts"]);
  const block = formatAttachmentBlock([health]);
  for (const sep of [" ", "\n\n"]) {
    assert.deepEqual(split(`${notice}${sep}${block}${sep}carry on`), {
      text: "carry on",
      attached: ["Stack health check"],
      undoneTurn: 2,
    });
  }
});

test("several blocks, in order", () => {
  const sent = `${formatAttachmentBlock([health, deck])}\n\nuse both`;
  assert.deepEqual(splitAttachmentBlock(sent), {
    text: "use both",
    attached: ["Stack health check", "Deck state line fix"],
  });
});

test("a name with quotes or brackets can't break the block", () => {
  const odd: AttachmentBlockEntry = {
    name: 'Fix "quoted" [thing]\nnext',
    projectName: "proj] (x)",
    summary: "done",
  };
  const sent = `${formatAttachmentBlock([odd])}\n\nok`;
  const { text, attached } = splitAttachmentBlock(sent);
  assert.equal(text, "ok");
  assert.equal(attached.length, 1);
  assert.doesNotMatch(attached[0], /["\]\n]/);
  assert.equal(attached[0], "Fix 'quoted' [thing''next");
});

test("an empty name still makes a block", () => {
  const sent = `${formatAttachmentBlock([{ ...deck, name: ' "" ' }])}\n\nok`;
  const { text, attached } = splitAttachmentBlock(sent);
  assert.equal(text, "ok");
  assert.equal(attached.length, 1);
});

test("a summary with [AgentOS: …] lines of its own stays inside", () => {
  const nested: AttachmentBlockEntry = {
    name: "Outer",
    projectName: "p",
    summary: [
      "User: [AgentOS: the user undid turn 3; x is back.]",
      '[AgentOS: attached session "Inner" (p), a summary, not its full transcript]',
      "inner summary",
      '[AgentOS: end of attached session "Inner"]',
      "[AgentOS: something else]",
    ].join("\n"),
  };
  const sent = `${formatAttachmentBlock([nested])}\n\nreal text`;
  assert.deepEqual(splitAttachmentBlock(sent), {
    text: "real text",
    attached: ["Outer"],
  });
});

test("something that only looks like a block, with no end, is left as is", () => {
  const sent =
    '[AgentOS: attached session "Ghost" (p), a summary, not its full transcript]\nno end here\n\nhello';
  assert.deepEqual(splitAttachmentBlock(sent), { text: sent, attached: [] });
  // A good block then a broken one: the good one comes off
  const mixed = `${formatAttachmentBlock([health])}\n\n${sent}`;
  assert.deepEqual(splitAttachmentBlock(mixed), {
    text: sent,
    attached: ["Stack health check"],
  });
});

test("plain text and a block mid-message are left alone", () => {
  assert.deepEqual(splitAttachmentBlock("hi"), { text: "hi", attached: [] });
  const mid = `see this\n${formatAttachmentBlock([health])}`;
  assert.deepEqual(splitAttachmentBlock(mid), { text: mid, attached: [] });
});

test("only sessions, no text: the text is empty", () => {
  for (const tail of ["", "\n", "\n\n  "]) {
    assert.deepEqual(
      splitAttachmentBlock(formatAttachmentBlock([health]) + tail),
      {
        text: "",
        attached: ["Stack health check"],
      }
    );
  }
  const notice = undoNoticeText(1, []);
  assert.deepEqual(
    split(`${notice} ${formatAttachmentBlock([health, deck])}`),
    {
      text: "",
      attached: ["Stack health check", "Deck state line fix"],
      undoneTurn: 1,
    }
  );
});

test("no entries, no block", () => {
  assert.equal(formatAttachmentBlock([]), "");
});
