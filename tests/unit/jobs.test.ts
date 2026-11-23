import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanPrepare, stripAgentConfig } from "../../lib/jobs/runner";
import {
  DEFAULT_JOB_RULE,
  JOB_MODES,
  changedText,
  cleanJobMode,
  cleanReport,
  cleanSpace,
  codeText,
  isActive,
  isDefaultJobRule,
  isOver,
  jobLine,
  jobModeHint,
  jobModeLine,
  jobPrompt,
  namesMachine,
  parseJobRule,
  sentText,
  stateWord,
  tookText,
  type Job,
} from "../../lib/jobs/types";
import { machineSection } from "../../lib/abilities-types";
import { parseStartedBy, startedByLine } from "../../lib/session-started-by";
import { settledLine } from "../../lib/settle-types";

const SHA = "a".repeat(40);

const job = (over: Partial<Job>): Job => ({
  id: "job_0123456789ab",
  machineId: "m_000000000001",
  machineName: "Mac Studio",
  sessionId: "s1",
  sessionName: "Session 26",
  projectId: null,
  title: "Widget tests",
  task: "Run them.",
  state: "running",
  step: null,
  question: null,
  jobSession: null,
  code: null,
  result: null,
  changed: null,
  patch: null,
  error: null,
  via: "chat",
  createdAt: 1_000_000,
  startedAt: 1_000_000,
  endedAt: null,
  ahead: 0,
  ...over,
});

test("a job's states: going, over, and their words", () => {
  assert.ok(isActive("sending") && isActive("running") && isActive("waiting"));
  assert.ok(!isActive("queued") && !isActive("done"));
  assert.ok(isOver("done") && isOver("failed") && isOver("stopped"));
  assert.ok(!isOver("queued") && !isOver("waiting"));
  assert.equal(stateWord("waiting"), "Needs you");
  assert.equal(tookText(48_000), "48s");
  assert.equal(tookText(134_000), "2m 14s");
  assert.equal(tookText(3_780_000), "1h 3m");
});

test("the line under a job says where it is and how far", () => {
  const now = 1_134_000;
  assert.equal(jobLine(job({}), now), "Running on Mac Studio for 2m 14s");
  assert.equal(
    jobLine(job({ state: "queued", ahead: 2 }), now),
    "Waiting its turn on Mac Studio, 2 ahead of it"
  );
  assert.equal(
    jobLine(job({ state: "queued" }), now),
    "Waiting its turn on Mac Studio"
  );
  assert.equal(
    jobLine(job({ state: "sending", step: "Setting up on Mac Studio" }), now),
    "Setting up on Mac Studio"
  );
  assert.equal(
    jobLine(job({ state: "sending" }), now),
    "Copying the code to Mac Studio"
  );
  assert.equal(
    jobLine(job({ state: "waiting" }), now),
    "Waiting for you on Mac Studio"
  );
  assert.equal(
    jobLine(job({ state: "done", endedAt: 1_048_000 }), now),
    "Done on Mac Studio in 48s"
  );
  assert.equal(jobLine(job({ state: "failed" }), now), "Failed on Mac Studio");
});

test("what was sent and what came back, in words", () => {
  assert.equal(codeText(null), "No code was sent");
  assert.equal(
    codeText({ head: SHA, unsaved: 0, skipped: 0 }),
    "The chat's code"
  );
  assert.equal(
    codeText({ head: SHA, unsaved: 1, skipped: 0 }),
    "The chat's code, with 1 unsaved file"
  );
  assert.equal(
    codeText({ head: SHA, unsaved: 3, skipped: 0 }),
    "The chat's code, with 3 unsaved files"
  );
  assert.equal(changedText(null), "No files changed");
  assert.equal(
    changedText({ files: [], more: 0, tooBig: false }),
    "No files changed"
  );
  assert.equal(
    changedText({
      files: [{ path: "a", added: 1, removed: 0 }],
      more: 0,
      tooBig: false,
    }),
    "1 file changed"
  );
  assert.equal(
    changedText({
      files: [{ path: "a", added: 1, removed: 0 }],
      more: 2,
      tooBig: false,
    }),
    "3 files changed"
  );
});

test("a machine's report is taken field by field", () => {
  assert.equal(cleanReport(null), null);
  assert.equal(cleanReport({ state: "exploded" }), null);
  const clean = cleanReport({
    state: "done",
    step: "x".repeat(900),
    question: 7,
    jobSession: "../../etc/passwd",
    result: "31 passed",
    changed: {
      files: [
        { path: "a.txt", added: "3", removed: -2 },
        { path: "", added: 1, removed: 1 },
        "junk",
      ],
      more: 4.7,
      tooBig: "yes",
    },
    patch: "true",
    error: { message: "no" },
    startedAt: "soon",
    endedAt: 5,
    extra: "ignored",
  });
  assert.ok(clean);
  assert.equal(clean.step?.length, 200);
  assert.equal(clean.question, null);
  assert.equal(clean.jobSession, null);
  assert.equal(clean.result, "31 passed");
  assert.deepEqual(clean.changed, {
    files: [{ path: "a.txt", added: 3, removed: 0 }],
    more: 4,
    tooBig: false,
  });
  assert.equal(clean.patch, false);
  assert.equal(clean.error, null);
  assert.equal(clean.startedAt, null);
  assert.equal(clean.endedAt, 5);
  assert.ok(!("extra" in clean));
});

test("the space a machine reports keeps only plain cache names", () => {
  assert.equal(cleanSpace({ work: 1 }), null);
  const space = cleanSpace({
    folder: "~/AgentOS/.jobs",
    work: 10,
    repos: -4,
    caches: [
      { name: "fusionha", bytes: 5, usedAt: 9 },
      { name: "../escape", bytes: 5, usedAt: 9 },
      { name: "", bytes: 1 },
    ],
    free: "lots",
  });
  assert.deepEqual(space, {
    folder: "~/AgentOS/.jobs",
    work: 10,
    repos: 0,
    caches: [{ name: "fusionha", bytes: 5, usedAt: 9 }],
    free: null,
  });
});

test("what the hub sends before a job is checked on the machine", () => {
  const base = {
    title: "Widget tests",
    task: "Run them.",
    origin: { session: "s1", name: "Session 26", from: "Unraid" },
  };
  assert.equal(cleanPrepare(null), null);
  assert.equal(cleanPrepare({ ...base, title: " " }), null);
  // No code: a plain folder
  const plain = cleanPrepare({ ...base, repo: null });
  assert.ok(plain && plain.repo === null && plain.snapshot === null);
  // Code needs a commit
  assert.equal(
    cleanPrepare({ ...base, repo: { name: "tide", subdir: "" }, head: "nope" }),
    null
  );
  // A folder outside the copy is refused
  for (const subdir of ["../up", "/etc", "a/../../b"]) {
    assert.equal(
      cleanPrepare({ ...base, repo: { name: "tide", subdir }, head: SHA }),
      null,
      subdir
    );
  }
  const full = cleanPrepare({
    ...base,
    repo: {
      name: "tide",
      remote: "git@example.com:me/tide.git",
      subdir: "app",
    },
    head: SHA,
    snapshot: {
      commit: SHA,
      tree: SHA,
      paths: [
        { path: "README.md", change: "modified", mode: "100644" },
        { path: "../outside", change: "added", mode: "100644" },
        { path: "/abs", change: "added", mode: "100644" },
        { path: "x", change: "renamed", mode: "100644" },
        { path: "gone.txt", change: "deleted", mode: null },
      ],
    },
  });
  assert.ok(full?.repo && full.snapshot);
  assert.equal(full.repo.subdir, "app");
  assert.equal(full.snapshot.head, SHA);
  assert.deepEqual(
    full.snapshot.paths.map((p) => p.path),
    ["README.md", "gone.txt"]
  );
});

test("the job's session is told what it is and the house rules", () => {
  const text = jobPrompt({
    title: "Widget tests",
    task: "Run the widget tests.",
    from: "Unraid",
    chat: "Session 26",
    cache: "/Users/me/AgentOS/.jobs/cache/fusionha",
    code: true,
  });
  assert.match(text, /one job for the chat "Session 26" on Unraid/);
  assert.match(
    text,
    /throwaway copy of that chat's code, with its unsaved changes/
  );
  assert.match(text, /The job: Widget tests\n\nRun the widget tests\./);
  assert.match(text, /Don't install anything machine-wide/);
  assert.match(
    text,
    /-derivedDataPath \/Users\/me\/AgentOS\/\.jobs\/cache\/fusionha\/DerivedData/
  );
  assert.match(text, /Your last message is the result the chat receives/);
  assert.match(
    jobPrompt({
      title: "t",
      task: "x",
      from: "Unraid",
      chat: null,
      cache: "/c",
      code: false,
    }),
    /one job for a chat on Unraid.*\nThis folder is empty/
  );
});

test("a job's session says which chat it came from", () => {
  const by = parseStartedBy(
    JSON.stringify({
      machineId: "hub",
      machine: "Unraid",
      depth: 1,
      at: 1,
      job: {
        id: "job_0123456789ab",
        title: "Widget tests",
        chat: "Session 26",
      },
    })
  );
  assert.ok(by?.job);
  assert.equal(startedByLine(by), "A job from Session 26 on Unraid");
  assert.equal(
    startedByLine({ machineId: "hub", machine: "Unraid", depth: 1, at: 1 }),
    "Started by a session on Unraid"
  );
  // Ended by its job, it says so where it is still listed
  assert.equal(
    settledLine({
      settled_reason: "job_done",
      pr_number: null,
      pr_status: null,
    }),
    "Its job is finished"
  );
});

test("a job's copy of the code loses the project's own Claude files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-strip-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-outside-"));
  try {
    const put = (name: string, text = "x") => {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
    };
    put(".claude/settings.json", '{"hooks":{}}');
    put(".claude/skills/build/SKILL.md");
    put(".mcp.json", "{}");
    put("apps/web/.claude/settings.local.json");
    put("apps/web/.mcp.json");
    put("apps/web/src/index.ts");
    put("docs/claude.md");
    put("CLAUDE.md");
    // A link named like one, and a link to a folder that holds one
    fs.mkdirSync(path.join(outside, ".claude"));
    fs.writeFileSync(path.join(outside, ".claude", "settings.json"), "{}");
    fs.mkdirSync(path.join(dir, "pkg"));
    fs.symlinkSync(
      path.join(outside, ".claude"),
      path.join(dir, "pkg", ".claude")
    );
    fs.symlinkSync(outside, path.join(dir, "linked"));

    assert.equal(await stripAgentConfig(dir), 5);
    const left = (name: string) => fs.existsSync(path.join(dir, name));
    assert.ok(!left(".claude") && !left(".mcp.json"));
    assert.ok(!left("apps/web/.claude") && !left("apps/web/.mcp.json"));
    assert.ok(!fs.lstatSync(path.join(dir, "pkg")).isSymbolicLink());
    assert.throws(() => fs.lstatSync(path.join(dir, "pkg", ".claude")));
    // The code, and what only reads like one, stay
    assert.ok(left("apps/web/src/index.ts") && left("docs/claude.md"));
    assert.ok(left("CLAUDE.md"));
    // Nothing outside the copy is touched: a link is not followed
    assert.ok(fs.existsSync(path.join(outside, ".claude", "settings.json")));
    assert.equal(await stripAgentConfig(dir), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("the job is told when the project's Claude files were left out", () => {
  const input = {
    title: "t",
    task: "x",
    from: "Unraid",
    chat: null,
    cache: "/c",
    code: true,
  };
  assert.doesNotMatch(jobPrompt(input), /left out of this copy/);
  assert.match(
    jobPrompt({ ...input, stripped: true }),
    /\.claude folders and \.mcp\.json.*are left out of this copy/
  );
});

test("how much a job may do without asking: three levels, never full access", () => {
  assert.deepEqual([...JOB_MODES], ["manual", "acceptEdits", "auto"]);
  assert.equal(cleanJobMode("auto"), "auto");
  assert.equal(cleanJobMode("bypassPermissions"), null);
  assert.equal(cleanJobMode(undefined), null);
  assert.match(
    jobModeHint("manual", "Mac Studio"),
    /until you answer it on Mac Studio/
  );
  assert.match(jobModeHint("auto", "Mac Studio"), /without waiting for you/);
  assert.match(jobModeLine("acceptEdits"), /ask you before commands/);
});

test("who chose the machine is said on the job's card", () => {
  const job = (via: Job["via"], sessionName: string | null = "Harbour chart") =>
    ({ via, sessionName }) as Pick<Job, "via" | "sessionName">;
  assert.equal(
    sentText(job("mention")),
    "You named this machine with @ in Harbour chart."
  );
  assert.equal(
    sentText(job("chat")),
    "Harbour chart chose this machine for it."
  );
  assert.equal(
    sentText(job("chat", null)),
    "A chat chose this machine for it."
  );
  assert.match(sentText(job("again")), /^You ran it again\./);
});

test("a project's rule: anything unknown is the default", () => {
  assert.deepEqual(parseJobRule(null), DEFAULT_JOB_RULE);
  assert.deepEqual(parseJobRule("not json"), DEFAULT_JOB_RULE);
  assert.deepEqual(parseJobRule('{"send":"ask","off":"actions"}'), {
    send: "ask",
    off: "actions",
  });
  assert.deepEqual(parseJobRule({ send: "always", off: 1 }), DEFAULT_JOB_RULE);
  assert.ok(isDefaultJobRule(parseJobRule({})));
  assert.ok(!isDefaultJobRule(parseJobRule({ send: "ask" })));
});

test("the project's rule is what a session is told to do", () => {
  const abilities = {
    system: { os: "linux", arch: "x64", version: "6.6" },
    found: [],
    checkedAt: 1,
  } as never;
  const view = {
    name: "Unraid",
    abilities,
    notes: "",
    peers: [{ id: "m_000000000001", name: "Mac Studio", abilities: null }],
  };
  const usual = machineSection(view, true)!;
  assert.match(
    usual,
    /hand that piece to the machine that has it with the run_job tool/
  );
  assert.match(
    usual,
    /If the machine refuses \(the user hasn't allowed it, or it is off\), tell the user what it said\./
  );
  const ask = machineSection(view, true, { send: "ask", off: "actions" })!;
  assert.match(ask, /the user wants to be asked first/);
  assert.doesNotMatch(ask, /hand that piece to the machine/);
  assert.match(
    ask,
    /use the project's GitHub Actions workflow for that work instead/
  );
  // A machine's own sessions can't send jobs: no word of them
  assert.doesNotMatch(
    machineSection(view, false, { send: "ask", off: "actions" })!,
    /run_job/
  );
});

test("the user's own @ names a machine; near misses don't", () => {
  assert.ok(namesMachine("Build it on @Mac Studio please", "Mac Studio"));
  assert.ok(namesMachine("@mac studio: run the tests", "Mac Studio"));
  assert.ok(
    namesMachine("run on @Elmer's Mac Studio", "Elmer\u2019s Mac Studio")
  );
  assert.ok(namesMachine("use @Mac Studio", "Mac Studio"));
  assert.ok(!namesMachine("Build it on the Mac Studio", "Mac Studio"));
  assert.ok(!namesMachine("@Mac Studios are nice", "Mac Studio"));
  assert.ok(!namesMachine("mail me@mac studio", ""));
  assert.ok(!namesMachine("@Old Mac", "Mac Studio"));
});
