import { describe, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

// lib/db reads DB_PATH when it loads; nothing here opens it
process.env.DB_PATH = path.join(os.tmpdir(), "agentos-attach-unused.db");

import type { Session } from "../../lib/db/types";
import {
  MAX_SESSION_ATTACHMENTS,
  formatAttachmentBlock,
  splitAttachmentBlock,
} from "../../lib/session-attach-types";
import {
  composeOutgoing,
  parseSessionRefs,
  resolveAttachmentBlockWith,
  type AttachDeps,
} from "../../lib/session-attach";
import { splitUndoNotice, undoNoticeText } from "../../lib/queue/types";

const session = (id: string, name = id, project: string | null = null) =>
  ({ id, name, project_id: project }) as Session;

function deps(sessions: Session[], over: Partial<AttachDeps> = {}) {
  const asked: string[] = [];
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const d: AttachDeps = {
    getSession: (id) => byId.get(id) ?? null,
    projectName: (s) => (s.project_id ? `proj-${s.project_id}` : null),
    summary: async (s) => {
      asked.push(s.id);
      return {
        text: `summary of ${s.name}`,
        tokens: 4,
        basis: "t:1:1",
        source: "transcript",
        empty: false,
      };
    },
    ...over,
  };
  return { d, asked };
}

describe("block format", () => {
  test("one part per session, the project in brackets", () => {
    const block = formatAttachmentBlock([
      {
        name: "Stack health check",
        projectName: "komodo-ai-operations",
        summary: "  It found herald.\n",
      },
      { name: 'Bad "name"]', projectName: null, summary: "x" },
    ]);
    assert.equal(
      block,
      [
        '[AgentOS: attached session "Stack health check" (komodo-ai-operations), a summary, not its full transcript]',
        "It found herald.",
        '[AgentOS: end of attached session "Stack health check"]',
        "",
        "[AgentOS: attached session \"Bad 'name''\", a summary, not its full transcript]",
        "x",
        "[AgentOS: end of attached session \"Bad 'name''\"]",
      ].join("\n")
    );
    assert.equal(formatAttachmentBlock([]), "");
  });

  test("splitAttachmentBlock round-trips formatAttachmentBlock", () => {
    const entries = [
      { name: "A", projectName: "p", summary: "# Session\n\n- [x] one" },
      { name: "B", projectName: null, summary: "two\n[AgentOS: other]" },
    ];
    const text = "Use what it found\nand fix herald. @";
    const sent = composeOutgoing(null, formatAttachmentBlock(entries), text);
    assert.deepEqual(splitAttachmentBlock(sent), {
      text,
      attached: ["A", "B"],
    });
    assert.deepEqual(splitAttachmentBlock(text), { text, attached: [] });
  });

  test("after the undo notice: notice, block, text, each split off", () => {
    const notice = undoNoticeText(3, ["a.ts"]);
    const block = formatAttachmentBlock([
      { name: "A", projectName: null, summary: "s" },
    ]);
    const sent = composeOutgoing(notice, block, "go /tmp/x.png");
    assert.ok(sent.startsWith(notice + "\n\n" + block + "\n\n"));
    const unnoticed = splitUndoNotice(sent);
    assert.equal(unnoticed.undoneTurn, 3);
    assert.deepEqual(splitAttachmentBlock(unnoticed.text), {
      text: "go /tmp/x.png",
      attached: ["A"],
    });
  });

  test("without a block the text is as before M9", () => {
    assert.equal(composeOutgoing("[n]", null, "hi"), "[n] hi");
    assert.equal(composeOutgoing(null, "", "hi"), "hi");
    assert.equal(composeOutgoing(null, null, "hi"), "hi");
  });
});

describe("resolveAttachmentBlock", () => {
  test("drops the target, unknown and repeated sessions", async () => {
    const { d, asked } = deps([
      session("t", "Target"),
      session("a", "Alpha", "1"),
      session("b", "Beta"),
    ]);
    const block = await resolveAttachmentBlockWith(d, "t", [
      { sessionId: "a" },
      { sessionId: "t" },
      { sessionId: "gone" },
      { sessionId: "a" },
      { sessionId: "b" },
    ]);
    assert.deepEqual(asked.sort(), ["a", "b"]);
    assert.deepEqual(splitAttachmentBlock(`${block}\n\nhi`), {
      text: "hi",
      attached: ["Alpha", "Beta"],
    });
    assert.ok(block!.includes('"Alpha" (proj-1)'));
    assert.ok(block!.includes("summary of Beta"));
  });

  test("caps at MAX_SESSION_ATTACHMENTS", async () => {
    const all = Array.from({ length: 8 }, (_, i) => session(`s${i}`));
    const { d, asked } = deps(all);
    const block = await resolveAttachmentBlockWith(
      d,
      "t",
      all.map((s) => ({ sessionId: s.id }))
    );
    assert.equal(asked.length, MAX_SESSION_ATTACHMENTS);
    assert.equal(
      splitAttachmentBlock(block!).attached.length,
      MAX_SESSION_ATTACHMENTS
    );
  });

  test("null when nothing is left", async () => {
    const { d, asked } = deps([session("t")]);
    assert.equal(await resolveAttachmentBlockWith(d, "t", []), null);
    assert.equal(
      await resolveAttachmentBlockWith(d, "t", [
        { sessionId: "t" },
        { sessionId: "nope" },
      ]),
      null
    );
    assert.deepEqual(asked, []);
  });

  test("a summary that fails goes as a one-line note", async () => {
    const { d } = deps([session("a", "Alpha"), session("b", "Beta")], {
      summary: async (s) => {
        if (s.id === "a") throw new Error("disk on fire");
        return {
          text: "fine",
          tokens: 1,
          basis: "x",
          source: "scrollback",
          empty: false,
        };
      },
    });
    const err = console.error;
    console.error = () => {};
    try {
      const block = await resolveAttachmentBlockWith(d, "t", [
        { sessionId: "a" },
        { sessionId: "b" },
      ]);
      assert.ok(block!.includes("could not be built"));
      assert.ok(!block!.includes("disk on fire"));
      assert.ok(block!.includes("fine"));
    } finally {
      console.error = err;
    }
  });
});

describe("parseSessionRefs", () => {
  test("valid lists", () => {
    assert.deepEqual(parseSessionRefs(undefined), []);
    assert.deepEqual(parseSessionRefs([]), []);
    assert.deepEqual(parseSessionRefs([{ sessionId: "a", extra: 1 }]), [
      { sessionId: "a" },
    ]);
  });

  test("what is wrong", () => {
    for (const bad of [
      null,
      "a",
      { sessionId: "a" },
      [{}],
      [{ sessionId: "" }],
      [{ sessionId: "  " }],
      [{ sessionId: 3 }],
      ["a"],
      [null],
      Array.from({ length: MAX_SESSION_ATTACHMENTS + 1 }, (_, i) => ({
        sessionId: `s${i}`,
      })),
    ]) {
      assert.equal(typeof parseSessionRefs(bad), "string", JSON.stringify(bad));
    }
  });
});
