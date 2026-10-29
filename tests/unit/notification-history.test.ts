import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The history file lives in $AGENT_OS_HOME, read on every call
const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-notif-"));
process.env.AGENT_OS_HOME = home;

import {
  clearNotifications,
  listNotifications,
  markNotificationsRead,
  recordNotification,
  type NotificationEntry,
} from "../../lib/push/history";
import {
  askLine,
  historyDays,
  historySubline,
  historyTile,
  historyTitle,
  shortAgo,
} from "../../components/Notifications/history-rows";

const file = path.join(home, "notifications.json");

describe("clearNotifications", () => {
  test("empties the list, leaves nothing unread and marks it seen now", () => {
    recordNotification({ kind: "finished", title: "Finished · a", body: "" });
    recordNotification({ kind: "needsYou", title: "Needs you · b", body: "" });
    assert.equal(listNotifications().items.length, 2);
    assert.equal(listNotifications().unread, 2);

    const before = Date.now();
    clearNotifications();
    const after = listNotifications();
    assert.deepEqual(after.items, []);
    assert.equal(after.unread, 0);
    assert.ok(after.lastSeen >= before && after.lastSeen <= Date.now());
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    // Saved through the temp file, which doesn't stay behind
    assert.deepEqual(
      fs.readdirSync(home).filter((f) => f.endsWith(".tmp")),
      []
    );
  });

  test("the history carries on after it, and marking read still works", () => {
    clearNotifications();
    const entry = recordNotification({
      kind: "agentFinished",
      title: "Finished · x",
      body: "",
    });
    recordNotification({ kind: "needsYou", title: "Needs you · y", body: "" });
    assert.equal(listNotifications().unread, 2);
    markNotificationsRead([entry.id]);
    assert.equal(listNotifications().unread, 1);
    markNotificationsRead("all");
    assert.equal(listNotifications().unread, 0);
    assert.equal(listNotifications().items.length, 2);
  });

  test("works with no file yet", () => {
    fs.rmSync(file, { force: true });
    clearNotifications();
    assert.deepEqual(listNotifications().items, []);
  });
});

const NOW = new Date(2026, 9, 29, 15, 0).getTime();
const H = 60 * 60_000;

function entry(over: Partial<NotificationEntry>): NotificationEntry {
  return {
    id: "e",
    kind: "finished",
    title: "",
    body: "",
    at: NOW - 3 * H,
    delivered: {},
    read: true,
    ...over,
  };
}

describe("history rows", () => {
  test("titles in the mock's words", () => {
    assert.equal(
      historyTitle(
        entry({
          title: "Finished · agent-os · Agent control MCP",
          projectName: "agent-os",
        })
      ),
      "Agent control MCP finished"
    );
    assert.equal(
      historyTitle(
        entry({ kind: "needsYou", title: "Needs you · Signing profiles" })
      ),
      "Signing profiles asked"
    );
    assert.equal(
      historyTitle(
        entry({
          kind: "agentFinished",
          agentId: "a1",
          title: "Finished · agent-os",
          body: "Explore agent: found three call sites",
        })
      ),
      "Explore agent finished"
    );
    assert.equal(
      historyTitle(
        entry({
          kind: "agentNeedsYou",
          agentId: "a1",
          title: "Needs you · agent-os",
          body: "Explore agent is waiting for you",
        })
      ),
      "Explore agent asked"
    );
    // Not the watcher's shape: as it is
    assert.equal(
      historyTitle(entry({ title: "Full access switched on" })),
      "Full access switched on"
    );
  });

  test("sublines: project, answered, failed channels, age", () => {
    assert.equal(
      historySubline(
        entry({
          kind: "needsYou",
          title: "Needs you · ios-cert-forge · Signing",
          projectName: "ios-cert-forge",
          at: NOW - 4 * H,
        }),
        { answered: true, now: NOW }
      ),
      "ios-cert-forge · answered · 4h"
    );
    assert.equal(
      historySubline(
        entry({
          kind: "agentFinished",
          agentId: "a",
          title: "Finished · x",
          at: NOW - 5 * H,
        }),
        { now: NOW }
      ),
      "background · 5h"
    );
    // A finished row is never "answered"; a failed channel is said
    assert.equal(
      historySubline(
        entry({
          title: "Finished · p · s",
          projectName: "p",
          delivered: { ntfy: "HTTP 500", apns: "sent to 1" },
        }),
        { answered: true, now: NOW }
      ),
      "p · ntfy failed · 3h"
    );
    assert.equal(
      historySubline(
        entry({ title: "Full access switched on", body: "s won't ask" }),
        { now: NOW }
      ),
      "s won't ask · 3h"
    );
  });

  test("tiles", () => {
    assert.equal(historyTile({ kind: "agentFinished" }), "done");
    assert.equal(historyTile({ kind: "agentNeedsYou" }), "needs");
    assert.equal(historyTile({ kind: "test" }), "bell");
  });

  test("short ages", () => {
    assert.equal(shortAgo(NOW - 10_000, NOW), "now");
    assert.equal(shortAgo(NOW - 5 * 60_000, NOW), "5m");
    assert.equal(shortAgo(NOW - 26 * H, NOW), "1d");
  });

  test("days: today, yesterday, earlier; empty ones left out", () => {
    const days = historyDays(
      [
        entry({ id: "a", at: NOW - H }),
        entry({ id: "b", at: NOW - 20 * H }),
        entry({ id: "c", at: NOW - 60 * H }),
      ],
      NOW
    );
    assert.deepEqual(
      days.map((d) => [d.title, d.entries.map((e) => e.id)]),
      [
        ["Earlier today", ["a"]],
        ["Yesterday", ["b"]],
        ["Earlier", ["c"]],
      ]
    );
    assert.deepEqual(
      historyDays([entry({ id: "a", at: NOW - H })], NOW).map((d) => d.title),
      ["Earlier today"]
    );
  });

  test("a command asks as Run <code>?, anything else by its question", () => {
    assert.deepEqual(
      askLine({
        title: "Bash command",
        detail: "docker compose restart herald\nmore",
        question: "Do you want to proceed?",
      }),
      { text: "Run ", code: "docker compose restart herald", after: "?" }
    );
    assert.deepEqual(
      askLine({
        title: "Merge",
        detail: "",
        question: "Merge PR #106 and deploy it?",
      }),
      { text: "Merge PR #106 and deploy it?" }
    );
    assert.deepEqual(
      askLine({ title: "Edit file", detail: "", question: "" }),
      {
        text: "Edit file",
      }
    );
  });
});
