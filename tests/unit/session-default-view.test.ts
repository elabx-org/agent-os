import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultSessionView,
  headerShowsActivity,
  headerVariant,
} from "../../lib/session-views";

test("flag off: the terminal, whatever the agent", () => {
  for (const agentType of ["claude", "codex", null])
    assert.equal(
      defaultSessionView({ remembered: null, chatDefault: false, agentType }),
      "terminal"
    );
});

test("flag on: chat for Claude (unset counts as Claude), terminal for others", () => {
  const view = (agentType: string | null) =>
    defaultSessionView({ remembered: null, chatDefault: true, agentType });
  assert.equal(view("claude"), "chat");
  assert.equal(view(null), "chat");
  assert.equal(view("codex"), "terminal");
  assert.equal(view("gemini"), "terminal");
  assert.equal(view("shell"), "terminal");
});

test("the view remembered on this device wins either way", () => {
  assert.equal(
    defaultSessionView({
      remembered: "terminal",
      chatDefault: true,
      agentType: "claude",
    }),
    "terminal"
  );
  assert.equal(
    defaultSessionView({
      remembered: "chat",
      chatDefault: false,
      agentType: "codex",
    }),
    "chat"
  );
});

const base = {
  hasSession: true,
  native: false,
  paneCount: 1,
  titleInPage: true,
  columnShown: true,
};

test("headerVariant: desktop and its pane cards, whatever the toggle", () => {
  assert.equal(headerVariant({ ...base, layout: "desktop" }), "desktop");
  assert.equal(
    headerVariant({ ...base, layout: "desktop", paneCount: 2 }),
    "card"
  );
  assert.equal(
    headerVariant({ ...base, layout: "desktop", titleInPage: false }),
    "desktop"
  );
  // The iOS app is never the desktop shell
  assert.equal(
    headerVariant({ ...base, layout: "desktop", native: true }),
    "classic"
  );
});

test("headerVariant: the Duo's postures with the title in the page", () => {
  assert.equal(headerVariant({ ...base, layout: "duo-closed" }), "page");
  assert.equal(headerVariant({ ...base, layout: "tabletop" }), "fold");
  assert.equal(headerVariant({ ...base, layout: "duo-open" }), "large");
  assert.equal(
    headerVariant({ ...base, layout: "duo-open", paneCount: 2 }),
    "classic"
  );
  assert.equal(headerVariant({ ...base, layout: "phone" }), "classic");
});

test("headerVariant: classic with the toggle, no column or no session", () => {
  assert.equal(
    headerVariant({ ...base, layout: "duo-closed", titleInPage: false }),
    "classic"
  );
  assert.equal(
    headerVariant({ ...base, layout: "duo-closed", columnShown: false }),
    "classic"
  );
  assert.equal(
    headerVariant({ ...base, layout: "desktop", hasSession: false }),
    "classic"
  );
});

test("the strip stays away under headers that say the activity", () => {
  assert.equal(headerShowsActivity("page"), true);
  assert.equal(headerShowsActivity("card"), true);
  assert.equal(headerShowsActivity("desktop"), false);
  assert.equal(headerShowsActivity("classic"), false);
});
