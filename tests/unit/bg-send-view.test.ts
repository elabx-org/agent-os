import { test } from "node:test";
import assert from "node:assert/strict";
import { freshSessionPlace } from "../../components/Chat/FreshSessionHint";
import { sentToastState } from "../../components/Chat/SentToast";

const projects = [
  { id: "p1", name: "agent-os", is_uncategorized: false },
  { id: "u", name: "Uncategorized", is_uncategorized: true },
];

test("freshSessionPlace: the project's name", () => {
  assert.equal(
    freshSessionPlace(
      { project_id: "p1", working_directory: "/x/other" },
      projects
    ),
    "agent-os"
  );
});

test("freshSessionPlace: the folder's name when uncategorized or unknown", () => {
  assert.equal(
    freshSessionPlace(
      { project_id: "u", working_directory: "/config/workspace/gh/app/" },
      projects
    ),
    "app"
  );
  assert.equal(
    freshSessionPlace({ project_id: "gone", working_directory: "~/w" }, []),
    "w"
  );
  assert.equal(
    freshSessionPlace({ project_id: null, working_directory: "repo" }, []),
    "repo"
  );
  assert.equal(
    freshSessionPlace({ project_id: null, working_directory: "" }, []),
    "this folder"
  );
});

test("sentToastState: keeps working until seen working and back to idle", () => {
  assert.deepEqual(sentToastState(undefined, false), {
    word: "Keeps working",
    tone: "work",
  });
  assert.deepEqual(sentToastState("idle", false), {
    word: "Keeps working",
    tone: "work",
  });
  assert.deepEqual(sentToastState("running", false), {
    word: "Keeps working",
    tone: "work",
  });
  assert.deepEqual(sentToastState("idle", true), {
    word: "Done",
    tone: "work",
  });
});

test("sentToastState: waiting, ended and failed", () => {
  assert.equal(sentToastState("waiting", true).word, "Needs you");
  assert.equal(sentToastState("waiting", true).tone, "needs");
  assert.equal(sentToastState("dead", false).word, "Stopped");
  assert.equal(sentToastState("error", true).tone, "quiet");
});
