import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// scripts/agentos-uninstall.sh against a throwaway home, with stand-ins
// for every outside tool (they record their calls to calls.log). git is
// real. sqlite3 is real when this machine has it, else a stand-in on
// better-sqlite3 (the same library AgentOS uses).

const SCRIPT = path.resolve(__dirname, "../../scripts/agentos-uninstall.sh");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-uninstall-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const realSqlite = (() => {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const STANDIN = `#!/bin/sh
name=$(basename "$0")
printf '%s\\n' "$name $*" >>"$STUB_DIR/calls.log"
case "$name" in
  tmux)
    case "$1" in
      has-session) grep -qxF "\${3#=}" "$STUB_DIR/tmux-live" 2>/dev/null; exit $? ;;
      display) printf '%s\\n' "\${STUB_TMUX_SESSION:-}"; exit 0 ;;
      kill-session) exit 0 ;;
    esac
    exit 1 ;;
  codex|gemini)
    if [ "$1 $2" = "mcp list" ]; then
      if [ "$name" = codex ] && [ "\${STUB_CODEX_OURS:-}" = 1 ]; then
        printf 'agent-os  %s mcp\\n' "$HOME/.agent-os/repo/scripts/agent-os"
      else
        printf 'agent-os  /opt/other/agent-os mcp\\n'
      fi
    fi
    exit 0 ;;
  security)
    # One item to delete, then none
    if [ -f "$STUB_DIR/key" ]; then rm -f "$STUB_DIR/key"; exit 0; fi
    exit 44 ;;
  pgrep) exit 1 ;;
esac
exit 0
`;

const SQLITE_STANDIN = `#!${process.execPath}
const fs = require("fs");
const path = require("path");
fs.appendFileSync(path.join(process.env.STUB_DIR, "calls.log"), "sqlite3 " + process.argv.slice(2).join(" ") + "\\n");
const args = process.argv.slice(2);
let sep = "|";
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-separator") sep = args[++i];
  else rest.push(args[i]);
}
try {
  const Database = require(${JSON.stringify(require.resolve("better-sqlite3"))});
  const db = new Database(rest[0], { readonly: true, fileMustExist: true });
  const rows = db.prepare(rest[1]).raw().all();
  for (const r of rows) process.stdout.write(r.map((v) => (v == null ? "" : String(v))).join(sep) + "\\n");
} catch (e) {
  process.stderr.write(String(e) + "\\n");
  process.exit(1);
}
`;

type Env = Record<string, string>;

let n = 0;

interface Fixture {
  root: string;
  home: string;
  ah: string;
  stub: string;
  repo: string;
  env: Env;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
}

function fixture(
  opts: {
    db?: "good" | "machines" | "corrupt" | "none";
    link?: boolean;
    worktrees?: boolean;
  } = {}
): Fixture {
  const root = path.join(tmp, `f${n++}`);
  const home = path.join(root, "home");
  const ah = path.join(home, ".agent-os");
  const stub = path.join(root, "stub");
  const bin = path.join(stub, "bin");
  fs.mkdirSync(ah, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  for (const tool of [
    "launchctl",
    "security",
    "tmux",
    "pgrep",
    "ps",
    "kill",
    "defaults",
    "codex",
    "gemini",
    "open",
    "dscl",
    "lsregister",
    "claude",
    "systemctl",
  ]) {
    fs.writeFileSync(path.join(bin, tool), STANDIN, { mode: 0o755 });
  }
  if (!realSqlite) {
    fs.writeFileSync(path.join(bin, "sqlite3"), SQLITE_STANDIN, {
      mode: 0o755,
    });
  }
  fs.writeFileSync(path.join(stub, "calls.log"), "");
  fs.writeFileSync(path.join(stub, "key"), "");

  // Things that must stay
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "x"), "keep");
  fs.writeFileSync(path.join(home, ".claude.json"), "{}");
  const repo = path.join(home, "AgentOS", "repo");
  fs.mkdirSync(repo, { recursive: true });

  if (opts.link !== false) {
    fs.writeFileSync(
      path.join(ah, "link.json"),
      JSON.stringify({ hubUrl: "https://hub.example.app", name: "Test Mac" })
    );
  }
  fs.writeFileSync(path.join(ah, ".installed-node"), "v22.0.0\n");
  fs.mkdirSync(path.join(ah, "repo", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(ah, "repo", "scripts", "agent-os"), "#!/bin/sh\n");
  fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
  fs.symlinkSync(
    path.join(ah, "repo", "scripts", "agent-os"),
    path.join(home, ".local", "bin", "agent-os")
  );

  const dbFile = path.join(ah, "agent-os.db");
  const kind = opts.db ?? "good";
  if (kind === "corrupt") {
    fs.writeFileSync(dbFile, "this is not a database");
  } else if (kind !== "none") {
    const db = new Database(dbFile);
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, agent_type TEXT NOT NULL DEFAULT 'claude',
        tmux_name TEXT, working_directory TEXT NOT NULL DEFAULT '~', worktree_path TEXT);
      CREATE TABLE machines (id TEXT PRIMARY KEY);
      CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const add = db.prepare(
      "INSERT INTO sessions (id, name, agent_type, tmux_name) VALUES (?, ?, ?, ?)"
    );
    add.run(ID, "Build the thing", "claude", `claude-${ID}`);
    // A row whose tmux name belongs to another id, and one that isn't ours
    add.run(
      "aaaaaaaa-2222-4333-8444-555555555555",
      "Odd",
      "claude",
      `claude-${OTHER}`
    );
    add.run("bbbbbbbb-2222-4333-8444-555555555555", "Foo", "claude", "foo");
    if (kind === "machines")
      db.prepare("INSERT INTO machines (id) VALUES ('m')").run();
    db.close();
  }
  fs.writeFileSync(
    path.join(stub, "tmux-live"),
    [`claude-${ID}`, `claude-${OTHER}`, "foo"].join("\n") + "\n"
  );

  if (opts.worktrees) {
    const remote = path.join(root, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    fs.writeFileSync(path.join(repo, "file"), "mine\n");
    fs.writeFileSync(path.join(repo, ".gitignore"), ".env\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "first");
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "-q", "-u", "origin", "main");
    const wts = path.join(ah, "worktrees");
    fs.mkdirSync(wts);
    git(
      repo,
      "worktree",
      "add",
      "-q",
      path.join(wts, "clean"),
      "-b",
      "wt-clean"
    );
    git(
      repo,
      "worktree",
      "add",
      "-q",
      path.join(wts, "dirty"),
      "-b",
      "wt-dirty"
    );
    fs.writeFileSync(path.join(wts, "dirty", "file"), "changed\n");
    git(
      repo,
      "worktree",
      "add",
      "-q",
      path.join(wts, "ignored"),
      "-b",
      "wt-ignored"
    );
    fs.writeFileSync(path.join(wts, "ignored", ".env"), "SECRET=1\n");
    // A name already taken in the kept folder: the dirty one becomes "dirty 2"
    fs.mkdirSync(path.join(home, "AgentOS", "Kept from AgentOS", "dirty"), {
      recursive: true,
    });
    // A link in worktrees/: only the link goes
    const outside = path.join(root, "outside-wt");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "keep"), "x");
    fs.symlinkSync(outside, path.join(wts, "linked"));
  } else {
    fs.writeFileSync(path.join(repo, "file"), "mine\n");
  }

  const env: Env = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    AGENT_OS_HOME: ah,
    AGENTOS_UNINSTALL_TEST: "1",
    AGENTOS_UNINSTALL_ROOT: root,
    AGENTOS_UNINSTALL_OS: "Darwin",
    STUB_DIR: stub,
    TMPDIR: root,
    LANG: "C",
  };
  return { root, home, ah, stub, repo, env };
}

function uninstall(f: Fixture, args: string[], env: Env = {}) {
  const r = spawnSync("/bin/bash", [SCRIPT, ...args], {
    env: { ...f.env, ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const calls = (f: Fixture) =>
  fs.readFileSync(path.join(f.stub, "calls.log"), "utf8");

function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const st = fs.lstatSync(p);
      out.push(`${p} ${st.size} ${st.mtimeMs}`);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
    }
  };
  walk(dir);
  return out.sort();
}

test("uninstall dry run: lists what goes and stays, and changes nothing", () => {
  const f = fixture({ worktrees: true });
  const before = tree(f.home);
  const r = uninstall(f, ["--dry-run", "--json"]);
  assert.equal(r.code, 0, r.err);
  const plan = JSON.parse(r.out);
  assert.equal(plan.refused, null);
  assert.equal(plan.machine, "Test Mac");
  assert.equal(plan.hub, "hub.example.app");
  assert.ok(plan.goes.some((g: { path: string }) => g.path === f.ah));
  assert.ok(
    plan.stays.some((s: { path: string }) => s.path.endsWith("/.claude"))
  );
  assert.deepEqual(
    plan.sessions.map((s: { tmux: string; stop: boolean }) => [s.tmux, s.stop]),
    [[`claude-${ID}`, true]]
  );
  const wt = Object.fromEntries(
    plan.worktrees.map((w: { name: string }) => [w.name, w])
  );
  assert.equal(wt.clean.keep, false);
  assert.equal(wt.dirty.keep, true);
  assert.match(wt.dirty.why, /1 changed file/);
  assert.equal(wt.ignored.keep, true, "an ignored .env is work to keep");
  assert.equal(wt.linked.keep, false);
  assert.equal(
    wt.dirty.to,
    path.join(f.home, "AgentOS", "Kept from AgentOS", "dirty 2")
  );
  assert.deepEqual(tree(f.home), before);

  const text = uninstall(f, ["--dry-run"]);
  assert.equal(text.code, 0, text.err);
  assert.match(
    text.out,
    /^AgentOS will be removed from this Mac \(Test Mac\)\./
  );
  assert.match(text.out, /The key that links this Mac to hub\.example\.app/);
  assert.match(
    text.out,
    /Running sessions, stopped \(their conversations stay in Claude\):\n {2}• Build the thing/
  );
  assert.match(
    text.out,
    /Worktrees with work not yet pushed, kept in ~\/AgentOS\/Kept from AgentOS:/
  );
  assert.match(
    text.out,
    /Claude's conversations and settings \(~\/\.claude and ~\/\.claude\.json\)/
  );
  assert.doesNotMatch(text.out, /Type yes/);
  assert.deepEqual(tree(f.home), before);
  assert.doesNotMatch(calls(f), /kill-session|bootout|delete-generic|remove/);
});

test("uninstall refuses on the hub, as root's stand-ins, outside its folder and in a session", () => {
  const cases: Array<
    [string, (f: Fixture) => Env, string, Parameters<typeof fixture>[0]?]
  > = [
    [
      "docker",
      (f) => (fs.writeFileSync(path.join(f.root, ".dockerenv"), ""), {}),
      "hub",
    ],
    [
      "link-hub.json",
      (f) => (fs.writeFileSync(path.join(f.ah, "link-hub.json"), "{}"), {}),
      "hub",
    ],
    ["a machines row", () => ({}), "hub", { db: "machines" }],
    ["a corrupt database", () => ({}), "hub", { db: "corrupt" }],
    ["a database and no link", () => ({}), "hub", { link: false }],
    ["AGENT_OS_HOME=$HOME", (f) => ({ AGENT_OS_HOME: f.home }), "notInstalled"],
    [
      "AGENT_OS_HOME=~/Documents",
      (f) => (
        fs.mkdirSync(path.join(f.home, "Documents")),
        { AGENT_OS_HOME: path.join(f.home, "Documents") }
      ),
      "notInstalled",
    ],
    [
      "no marker file",
      (f) => {
        fs.rmSync(path.join(f.ah, "link.json"));
        fs.rmSync(path.join(f.ah, ".installed-node"));
        return {};
      },
      "notInstalled",
      { db: "none" },
    ],
    [
      "inside a session",
      () => ({
        TMUX: "/tmp/tmux-1/default,1,0",
        STUB_TMUX_SESSION: `claude-${ID}`,
      }),
      "inSession",
    ],
  ];
  for (const [name, setup, want, opts] of cases) {
    const f = fixture(opts);
    const env = setup(f);
    const before = tree(f.home);
    const r = uninstall(f, ["--yes", "--json"], env);
    assert.equal(r.code, 1, `${name}: ${r.out} ${r.err}`);
    assert.equal(JSON.parse(r.out).refused, want, name);
    assert.deepEqual(tree(f.home), before, `${name}: nothing changed`);
    assert.doesNotMatch(calls(f), /kill-session|bootout|delete-generic/, name);
  }
});

test("uninstall without a terminal and without --yes removes nothing", () => {
  const f = fixture();
  const before = tree(f.home);
  const r = uninstall(f, []);
  assert.equal(r.code, 2);
  assert.match(
    r.err,
    /Nothing was removed\. To remove without being asked, run: agent-os uninstall --yes/
  );
  assert.deepEqual(tree(f.home), before);
});

test("uninstall --yes removes AgentOS and keeps work, repositories and Claude", () => {
  const f = fixture({ worktrees: true });
  const r = uninstall(f, ["--yes", "--json"], { STUB_CODEX_OURS: "1" });
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  const result = JSON.parse(r.out);
  assert.equal(result.done.stopped, 1);
  assert.equal(result.done.kept, 2);
  assert.deepEqual(result.done.left, []);

  assert.equal(fs.existsSync(f.ah), false);
  assert.equal(
    fs.readFileSync(path.join(f.home, ".claude", "x"), "utf8"),
    "keep"
  );
  assert.equal(
    fs.readFileSync(path.join(f.home, ".claude.json"), "utf8"),
    "{}"
  );
  assert.equal(fs.readFileSync(path.join(f.repo, "file"), "utf8"), "mine\n");
  assert.equal(
    fs.existsSync(path.join(f.home, ".local", "bin", "agent-os")),
    false
  );

  const kept = path.join(f.home, "AgentOS", "Kept from AgentOS");
  assert.equal(
    fs.readFileSync(path.join(kept, "dirty 2", "file"), "utf8"),
    "changed\n"
  );
  assert.equal(
    fs.readFileSync(path.join(kept, "ignored", ".env"), "utf8"),
    "SECRET=1\n"
  );
  const list = git(f.repo, "worktree", "list");
  assert.ok(list.includes(path.join(kept, "dirty 2")), list);
  assert.ok(list.includes(path.join(kept, "ignored")), list);
  assert.ok(!list.includes("worktrees/clean"), list);
  assert.match(git(f.repo, "branch", "--list", "wt-clean"), /wt-clean/);
  assert.equal(
    fs.readFileSync(path.join(f.root, "outside-wt", "keep"), "utf8"),
    "x"
  );

  const log = calls(f);
  assert.match(
    log,
    /^launchctl bootout gui\/\d+\/com\.agentos\.machine\.test$/m
  );
  assert.match(log, /^security delete-generic-password -s agentos-link-test$/m);
  assert.match(log, new RegExp(`^tmux kill-session -t =claude-${ID}$`, "m"));
  assert.doesNotMatch(log, /kill-server/);
  assert.doesNotMatch(log, /kill-session -t =foo/);
  assert.doesNotMatch(log, new RegExp(`kill-session -t =claude-${OTHER}`));
  assert.doesNotMatch(log, /--force/);
  assert.match(log, /^codex mcp remove agent-os$/m);
  assert.doesNotMatch(log, /^gemini mcp remove/m);
  assert.doesNotMatch(log, /^claude /m);
  assert.match(log, /^defaults delete com\.agentos\.mac\.test$/m);
});

test("uninstall --keep-sessions stops no session", () => {
  const f = fixture();
  const r = uninstall(f, ["--yes", "--keep-sessions"]);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(calls(f), /kill-session/);
  assert.match(
    r.out,
    /AgentOS was removed from this Mac\. Your repositories and ~\/\.claude are untouched\./
  );
});

test("uninstall leaves the target of a linked repo or ~/.agent-os", () => {
  const f = fixture();
  const elsewhere = path.join(f.root, "elsewhere-repo");
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, "keep"), "x");
  fs.rmSync(path.join(f.ah, "repo"), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(f.ah, "repo"));
  assert.equal(uninstall(f, ["--yes"]).code, 0);
  assert.equal(fs.existsSync(f.ah), false);
  assert.equal(fs.readFileSync(path.join(elsewhere, "keep"), "utf8"), "x");

  const g = fixture();
  const real = path.join(g.root, "real-agent-os");
  fs.renameSync(g.ah, real);
  fs.symlinkSync(real, g.ah);
  const r = uninstall(g, ["--yes"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.existsSync(g.ah), false, "the link is gone");
  assert.equal(
    fs.existsSync(path.join(real, "link.json")),
    true,
    "its target stays"
  );
});
