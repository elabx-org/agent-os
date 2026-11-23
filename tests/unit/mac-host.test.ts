import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewTotals } from "../../lib/mac-review";
import {
  inspectorShown,
  MAC_ACTIONS,
  MAC_BOOT_SCRIPT,
  isMacAction,
  macChrome,
  macState,
  macView,
  type MacStateInput,
} from "../../lib/mac-host";

const base: MacStateInput = {
  session: { id: "s1", title: "Widget preview", branch: "main" },
  project: "fusionha-ios",
  machine: "Mac Studio",
  covered: null,
  viewMode: "git",
  changes: 4,
  agents: 0,
  sidebar: true,
  inspector: true,
  dark: true,
  needs: 1,
};

test("the Mac app is known by its user agent", () => {
  assert.equal(macChrome("Mozilla/5.0 AgentOSMac/0.5.0 MacChrome/1"), 1);
  assert.equal(macChrome("Mozilla/5.0 AgentOSMac/0.5.0"), 0);
  assert.equal(macChrome("Mozilla/5.0 Chrome/140 Safari/537"), 0);
});

test("the session in front, with its line", () => {
  const state = macState(base);
  assert.equal(state.session, "s1");
  assert.equal(state.title, "Widget preview");
  assert.equal(state.detail, "fusionha-ios · main · Mac Studio");
  assert.equal(state.view, "changes");
  assert.equal(state.changes, 4);
});

test("a page or Settings over the session: no views, the page's name", () => {
  const state = macState({ ...base, covered: "Settings" });
  assert.equal(state.session, null);
  assert.equal(state.title, "Settings");
  assert.equal(state.detail, "Mac Studio");
  assert.equal(state.view, null);
  assert.equal(state.changes, 0);
  assert.equal(state.agents, false);
});

test("no session open", () => {
  const state = macState({ ...base, session: null });
  assert.equal(state.session, null);
  assert.equal(state.title, "");
  assert.equal(state.view, null);
});

test("parts that aren't known are left out of the line", () => {
  const state = macState({
    ...base,
    project: null,
    session: { id: "s1", title: "T", branch: null },
  });
  assert.equal(state.detail, "Mac Studio");
});

test("the pane's views map to the toolbar's", () => {
  assert.equal(macView("git"), "changes");
  assert.equal(macView("workers"), "agents");
  assert.equal(macView("chat"), "chat");
  assert.equal(macView("nope"), null);
  assert.equal(macView(null), null);
});

test("Agents is offered once the session has any", () => {
  assert.equal(macState({ ...base, agents: 2 }).agents, true);
  assert.equal(macState(base).agents, false);
});

test("counts are whole and never negative", () => {
  const state = macState({ ...base, changes: -3, needs: 2.7 });
  assert.equal(state.changes, 0);
  assert.equal(state.needs, 2);
});

test("only the toolbar's own words are actions", () => {
  for (const action of MAC_ACTIONS) assert.ok(isMacAction(action));
  assert.equal(isMacAction("stop"), false);
  assert.equal(isMacAction(7), false);
  assert.equal(isMacAction(undefined), false);
});

/** Runs the boot script as a page with this user agent would */
function boot(userAgent: string): Record<string, string> {
  const set: Record<string, string> = {};
  const run = new Function("navigator", "document", MAC_BOOT_SCRIPT);
  run(
    { userAgent },
    {
      documentElement: {
        setAttribute: (name: string, value: string) => (set[name] = value),
      },
    }
  );
  return set;
}

test("the boot script marks the page before paint", () => {
  assert.deepEqual(boot("Mozilla/5.0 AgentOSMac/0.5.0 MacChrome/1"), {
    "data-mac": "1",
  });
  assert.deepEqual(
    boot("Mozilla/5.0 AgentOSMac/0.5.0 MacChrome/1 MacOpaque/1"),
    { "data-mac": "1", "data-mac-opaque": "" }
  );
  // A browser, and an older Mac app, are left alone
  assert.deepEqual(boot("Mozilla/5.0 Chrome/140 Safari/537"), {});
  assert.deepEqual(boot("Mozilla/5.0 AgentOSMac/0.4.0 MacOpaque/1"), {});
});

test("the inspector stays away over Changes until asked for", () => {
  const choice = { inspector: true, reviewInspector: false };
  assert.equal(inspectorShown(choice, "chat"), true);
  assert.equal(inspectorShown(choice, "terminal"), true);
  assert.equal(inspectorShown(choice, "git"), false);
  assert.equal(
    inspectorShown({ inspector: false, reviewInspector: true }, "git"),
    true
  );
  assert.equal(
    inspectorShown({ inspector: false, reviewInspector: true }, "chat"),
    false
  );
});

test("the review bar counts a file once and adds up its lines", () => {
  assert.deepEqual(reviewTotals([]), { files: 0, additions: 0, deletions: 0 });
  assert.deepEqual(
    reviewTotals([
      { path: "a.swift", additions: 40, deletions: 6 },
      // The same file, part staged and part not
      { path: "a.swift", additions: 2 },
      // Untracked and binary files carry no counts
      { path: "b.png" },
    ]),
    { files: 2, additions: 42, deletions: 6 }
  );
  // The same path in two repositories is two files
  assert.equal(
    reviewTotals(
      [
        { path: "README.md", repo: "/a" },
        { path: "README.md", repo: "/b" },
      ],
      (f) => f.repo
    ).files,
    2
  );
});

test("a page can put its own line under the window's title", () => {
  const all = macState({
    ...base,
    covered: "All sessions",
    coverDetail: "5 on 2 machines",
  });
  assert.equal(all.title, "All sessions");
  assert.equal(all.detail, "5 on 2 machines");
  assert.equal(all.session, null);
  // Without one, and for the session itself, nothing changes
  assert.equal(macState({ ...base, covered: "Mocks" }).detail, "Mac Studio");
  assert.equal(
    macState({ ...base, coverDetail: "5 on 2 machines" }).detail,
    "fusionha-ios · main · Mac Studio"
  );
  assert.ok(isMacAction("all"));
});
