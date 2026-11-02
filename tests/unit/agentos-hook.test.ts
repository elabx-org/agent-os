import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  HOOK,
  agentRefs,
  g,
  journal,
  makeRepo,
  read,
  runHook,
  tmpDir,
  userState,
  waitFor,
  write,
} from "./turns-fixture";

// The hook is live code in every running Claude session: whatever it does,
// it prints nothing and exits 0, and with the flag off it adds nothing
const dirs: string[] = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function setup(flags: object | null) {
  const home = tmpDir("hook-home");
  dirs.push(home);
  const root = makeRepo();
  dirs.push(root);
  if (flags) write(home, "flags.json", JSON.stringify(flags));
  const stateDir = (id: string) => path.join(home, "claude-state", id);
  return { home, root, stateDir };
}

function events(cwd: string) {
  const base = { session_id: "c1", cwd, transcript_path: "/nonexistent" };
  return {
    prompt: { ...base, hook_event_name: "UserPromptSubmit", prompt: "Fix a" },
    edit: {
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "t1",
      tool_input: { file_path: path.join(cwd, "a.txt") },
    },
    bash: {
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "t2",
      tool_input: { command: "echo > b.txt" },
    },
    stop: { ...base, hook_event_name: "Stop" },
  };
}

function quiet(result: ReturnType<typeof runHook>) {
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
}

describe("agentos-hook turn snapshots", () => {
  test("flag off: state recorded as before, no journal, no refs", async () => {
    const { root, stateDir } = setup({ snapshots: false, sessions: {} });
    const dir = stateDir("s1");
    const e = events(root);
    quiet(runHook(dir, e.prompt));
    write(root, "a.txt", "edited\n");
    quiet(runHook(dir, e.edit));
    quiet(runHook(dir, e.stop));
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(fs.existsSync(path.join(dir, "state.json")));
    assert.ok(!fs.existsSync(path.join(dir, "turns.jsonl")));
    assert.ok(!fs.existsSync(path.join(dir, "turn.json")));
    assert.deepEqual(agentRefs(root, "s1"), []);
  });

  test("no flags.json at all: off", async () => {
    const { root, stateDir } = setup(null);
    const dir = stateDir("s1");
    quiet(runHook(dir, events(root).prompt));
    assert.ok(!fs.existsSync(path.join(dir, "turns.jsonl")));
    assert.deepEqual(agentRefs(root, "s1"), []);
  });

  test("flag on: pre, touched path and post in the journal and refs", async () => {
    const { root, stateDir } = setup({ snapshots: true });
    const dir = stateDir("s2");
    const before = userState(root);
    const e = events(root);
    quiet(runHook(dir, e.prompt));
    write(root, "a.txt", "edited\n");
    quiet(runHook(dir, e.edit));
    quiet(runHook(dir, e.bash));
    quiet(runHook(dir, e.stop));
    await waitFor(() => journal(dir).some((j) => j.e === "post"));

    const lines = journal(dir);
    const pre = lines.find((j) => j.e === "pre")!;
    assert.equal(pre.turnNo, 1);
    assert.equal(pre.cwd, root);
    assert.equal(pre.promptExcerpt, "Fix a");
    assert.equal(pre.preRef, "refs/agent-os/s2/t1-pre");
    assert.deepEqual(
      lines.filter((j) => j.e === "touch").map((j) => j.path),
      [path.join(root, "a.txt")]
    );
    const post = lines.find((j) => j.e === "post")!;
    assert.equal(post.postRef, "refs/agent-os/s2/t1-post");
    assert.equal(g(root, "show", "refs/agent-os/s2/t1-pre:a.txt"), "alpha\n");
    assert.equal(g(root, "show", "refs/agent-os/s2/t1-post:a.txt"), "edited\n");
    assert.equal(read(root, "a.txt"), "edited\n");
    // Only the edit itself shows in the user's view
    const after = userState(root);
    assert.equal(after.index, before.index);
    assert.equal(after.head, before.head);
    assert.equal(after.stash, before.stash);
    assert.equal(after.branches, before.branches);

    // The next prompt is turn 2
    quiet(runHook(dir, e.prompt));
    assert.equal(journal(dir).filter((j) => j.e === "pre")[1].turnNo, 2);
  });

  test("per-session override: only the listed session", async () => {
    const { root, stateDir } = setup({
      snapshots: false,
      sessions: { snapshots: ["on-1"] },
    });
    quiet(runHook(stateDir("on-1"), events(root).prompt));
    quiet(runHook(stateDir("off-1"), events(root).prompt));
    assert.equal(journal(stateDir("on-1")).length, 1);
    assert.equal(journal(stateDir("off-1")).length, 0);
    assert.deepEqual(agentRefs(root, "off-1"), []);
  });

  test("a folder outside git: the turn is recorded with no snapshot", () => {
    const { stateDir } = setup({ snapshots: true });
    const plain = tmpDir("plain");
    dirs.push(plain);
    const dir = stateDir("s3");
    quiet(runHook(dir, events(plain).prompt));
    const pre = journal(dir)[0];
    assert.equal(pre.e, "pre");
    assert.equal(pre.preRef, null);
  });

  test("garbage input: silent, exit 0", () => {
    const { stateDir } = setup({ snapshots: true });
    for (const input of [
      "",
      "not json",
      "[]",
      "null",
      '{"hook_event_name":5}',
    ]) {
      const result = spawnSync(process.execPath, [HOOK, stateDir("s4")], {
        input,
        encoding: "utf8",
      });
      quiet(result);
    }
  });

  test("an edit with no turn started is ignored", () => {
    const { root, stateDir } = setup({ snapshots: true });
    const dir = stateDir("s5");
    quiet(runHook(dir, events(root).edit));
    assert.equal(journal(dir).length, 0);
  });
});

describe("agentos-hook mocks", () => {
  const publish = (response: unknown, input: object = {}) => ({
    session_id: "c1",
    cwd: "/tmp",
    transcript_path: "/nonexistent",
    hook_event_name: "PostToolUse",
    tool_name: "Artifact",
    tool_use_id: "a1",
    tool_input: { file_path: "/nowhere/mock.html", ...input },
    tool_response: response,
  });
  const inbox = (home: string) => {
    const file = path.join(home, "claude-state", "mocks.jsonl");
    return fs.existsSync(file)
      ? fs
          .readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
  };

  test("a publish is recorded with its session, link, version and title", () => {
    const { home, root, stateDir } = setup(null);
    const page = path.join(root, "rail.html");
    fs.writeFileSync(page, "<title>Session Rail Labels</title><p>x</p>");
    quiet(
      runHook(
        stateDir("s1"),
        publish(
          [
            {
              type: "text",
              text: `Published ${page} at https://claude.ai/artifact/Vw8HPGnKzVR3KKajW9BeWQ (Version 2, version id 1-a) Icon: "layout".`,
            },
          ],
          { file_path: page, description: "Three rail options" }
        )
      )
    );
    const [line] = inbox(home);
    assert.equal(line.session, "s1");
    assert.equal(line.url, "https://claude.ai/artifact/Vw8HPGnKzVR3KKajW9BeWQ");
    assert.equal(line.version, 2);
    assert.equal(line.file, page);
    assert.equal(line.title, "Session Rail Labels");
    assert.equal(line.description, "Three rail options");
  });

  test("the tool's structured result: link, seq, path and title", () => {
    const { home, stateDir } = setup(null);
    quiet(
      runHook(
        stateDir("s2"),
        publish(
          {
            url: "https://claude.ai/artifact/SeecS479EiWVuGVGi7SCuJ",
            path: "/scratch/mocks-tracker.html",
            title: "AgentOS Mocks Tracker",
            seq: 3,
            version: "1793657716-d0cc",
            unchanged: false,
          },
          { description: "Where the list lives" }
        )
      )
    );
    const [line] = inbox(home);
    assert.equal(line.session, "s2");
    assert.equal(line.url, "https://claude.ai/artifact/SeecS479EiWVuGVGi7SCuJ");
    assert.equal(line.version, 3);
    assert.equal(line.file, "/scratch/mocks-tracker.html");
    assert.equal(line.title, "AgentOS Mocks Tracker");
    assert.equal(line.description, "Where the list lives");
  });

  test("reads, lists, asset uploads and failures are not mocks", () => {
    const { home, stateDir } = setup(null);
    const ok = "Published /x.html at https://claude.ai/artifact/AbC (Version 1";
    quiet(runHook(stateDir("s1"), publish(ok, { action: "read" })));
    quiet(runHook(stateDir("s1"), publish(ok, { asset: true })));
    quiet(runHook(stateDir("s1"), publish("Refused: conflict")));
    quiet(
      runHook(stateDir("s1"), {
        ...publish(ok),
        hook_event_name: "PostToolUseFailure",
      })
    );
    quiet(runHook(stateDir("s1"), { ...publish(ok), tool_name: "Write" }));
    quiet(runHook(stateDir("s1"), publish({ error: "conflict" })));
    assert.deepEqual(inbox(home), []);
  });
});
