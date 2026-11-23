import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  SetupRefused,
  installSetup,
  packPath,
  packSetup,
} from "../../lib/claude-setup/install";
import {
  hashEntry,
  listItems,
  readRecord,
  setSetupJob,
} from "../../lib/claude-setup/inventory";
import {
  countSentence,
  followKeys,
  setupDiff,
  type SetupItem,
} from "../../lib/claude-setup/types";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "setup-test-"));

function write(root: string, rel: string, text: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A server's ~/.claude with two skills, a command, an agent, two plugins */
function hubHome(): string {
  const root = tmp();
  write(
    root,
    "skills/duo/SKILL.md",
    "---\nname: duo\ndescription: Duo guide\n---\nbody"
  );
  write(root, "skills/duo/ref/a.md", "a");
  fs.symlinkSync("../ref/a.md", path.join(root, "skills/duo/ref/link.md"));
  write(
    root,
    "skills/infra/SKILL.md",
    "---\ndescription: Infra\n---\nuse mcp__komodo__list"
  );
  write(root, "skills/synced/x/SKILL.md", "claude's own");
  write(root, "commands/duo.md", "run duo");
  write(root, "agents/api-designer/agent.md", "agent");
  write(
    root,
    "plugins/installed_plugins.json",
    JSON.stringify({
      plugins: {
        "superpowers@official": [{ scope: "user", version: "7" }],
        "off@official": [{ scope: "user", version: "1" }],
        "local@nowhere": [{ scope: "user", version: "1" }],
      },
    })
  );
  write(
    root,
    "plugins/known_marketplaces.json",
    JSON.stringify({ official: { source: { source: "github", repo: "a/b" } } })
  );
  write(
    root,
    "settings.json",
    JSON.stringify({ enabledPlugins: { "off@official": false } })
  );
  return root;
}

const keysOf = (items: SetupItem[]) => items.map((i) => i.key).sort();

test("inventory: lists skills, commands, agents and enabled marketplace plugins", () => {
  const items = listItems(hubHome());
  assert.deepEqual(keysOf(items), [
    "agent:api-designer",
    "command:duo.md",
    "plugin:superpowers@official",
    "skill:duo",
    "skill:infra",
  ]);
  const infra = items.find((i) => i.key === "skill:infra")!;
  assert.equal(infra.usesTools, true);
  assert.equal(
    items.find((i) => i.key === "skill:duo")!.description,
    "Duo guide"
  );
  assert.deepEqual(items.find((i) => i.kind === "plugin")!.marketplace, {
    name: "official",
    source: "a/b",
  });
});

test("hash: the same files hash the same, a change doesn't", () => {
  const a = hubHome();
  const b = hubHome();
  assert.equal(
    hashEntry(path.join(a, "skills/duo")).hash,
    hashEntry(path.join(b, "skills/duo")).hash
  );
  write(b, "skills/duo/ref/a.md", "changed");
  assert.notEqual(
    hashEntry(path.join(a, "skills/duo")).hash,
    hashEntry(path.join(b, "skills/duo")).hash
  );
});

test("diff: missing, same, update only for AgentOS's own copy, kept otherwise", () => {
  const item = (key: string, hash: string): SetupItem => ({
    key,
    kind: key.split(":")[0] as SetupItem["kind"],
    name: key.split(":")[1],
    hash,
    bytes: 0,
  });
  const hub = [
    item("skill:a", "1"),
    item("skill:b", "2"),
    item("skill:c", "3"),
    item("skill:d", "4"),
    item("plugin:p@m", "9"),
  ];
  const machine = [
    item("skill:b", "2"),
    item("skill:c", "old"),
    item("skill:d", "mine"),
    item("plugin:p@m", "8"),
    item("skill:own", "x"),
  ];
  const diff = setupDiff(hub, machine, {
    "skill:c": "old",
    "skill:d": "older",
  });
  assert.deepEqual(
    diff.rows.map((r) => r.state),
    ["missing", "same", "update", "kept", "same"]
  );
  assert.deepEqual(keysOf(diff.own), ["skill:own"]);
  assert.deepEqual(followKeys(diff, ["skill:a"]), {
    to: ["skill:c"],
    back: [],
  });
  // The machine edited AgentOS's copy and the server's is as it was
  const edited = setupDiff(
    [item("skill:e", "base"), item("skill:f", "base")],
    [item("skill:e", "edited"), item("skill:f", "edited")],
    { "skill:e": "base", "skill:f": "base" }
  );
  assert.deepEqual(
    edited.rows.map((r) => r.state),
    ["back", "back"]
  );
  assert.deepEqual(followKeys(edited, ["skill:f"]), {
    to: [],
    back: ["skill:e"],
  });
  assert.equal(countSentence(hub), "4 skills and 1 plugin");
});

test("pack paths: only entries under skills, commands and agents", () => {
  assert.equal(packPath("setup.json"), "note");
  assert.equal(packPath("skills/"), "dir");
  assert.deepEqual(packPath("skills/duo/ref/a.md"), {
    kind: "skill",
    entry: "duo",
  });
  for (const bad of [
    "/etc/passwd",
    "skills/../settings.json",
    "settings.json",
    "plugins/x",
    "skills/.hidden/x",
    "skills//x",
  ]) {
    assert.equal(packPath(bad), null, bad);
  }
});

async function copy(hub: string, mac: string, record: string, keys: string[]) {
  setSetupJob(null);
  const pack = await packSetup(keys, "Unraid", hub);
  const calls: string[][] = [];
  try {
    const job = await installSetup(pack.stream, {
      root: mac,
      record,
      waitForPlugins: true,
      claude: async (args) => {
        calls.push(args);
        return { ok: true, out: "" };
      },
    });
    await pack.done;
    return { job, calls };
  } catch (error) {
    // The pack's own failure is the real reason
    await pack.done;
    throw error;
  }
}

test("copy: adds what is missing, keeps the owner's own, updates only its own copies", async () => {
  const hub = hubHome();
  const mac = tmp();
  const record = path.join(tmp(), "claude-setup.json");
  write(mac, "skills/ios-ui-review/SKILL.md", "mine");
  write(mac, "commands/duo.md", "my own duo command");
  const all = keysOf(listItems(hub));
  const first = await copy(hub, mac, record, all);
  assert.deepEqual(first.job.copied.sort(), [
    "agent:api-designer",
    "skill:duo",
    "skill:infra",
  ]);
  assert.deepEqual(first.job.kept, ["command:duo.md"]);
  assert.equal(
    fs.readFileSync(path.join(mac, "commands/duo.md"), "utf8"),
    "my own duo command"
  );
  assert.equal(
    fs.readFileSync(path.join(mac, "skills/ios-ui-review/SKILL.md"), "utf8"),
    "mine"
  );
  assert.equal(
    fs.readlinkSync(path.join(mac, "skills/duo/ref/link.md")),
    "../ref/a.md"
  );
  assert.equal(fs.existsSync(path.join(mac, "skills/synced")), false);
  assert.deepEqual(first.calls, [
    ["plugin", "marketplace", "add", "a/b"],
    ["plugin", "install", "superpowers@official", "--scope", "user"],
  ]);
  assert.equal(first.job.state, "done");
  assert.equal(
    readRecord(record).placed["skill:duo"],
    hashEntry(path.join(hub, "skills/duo")).hash
  );
  assert.equal(
    fs.readdirSync(mac).some((n) => n.startsWith(".agentos-incoming")),
    false
  );

  // The server's copy changes: the machine's untouched copy follows
  write(hub, "skills/duo/ref/a.md", "newer");
  // The owner edits the other one on the machine: it stays theirs
  write(mac, "skills/infra/SKILL.md", "edited on the mac");
  write(hub, "skills/infra/SKILL.md", "newer on the server");
  const second = await copy(hub, mac, record, ["skill:duo", "skill:infra"]);
  assert.deepEqual(second.job.copied, ["skill:duo"]);
  assert.deepEqual(second.job.kept, ["skill:infra"]);
  assert.equal(
    fs.readFileSync(path.join(mac, "skills/duo/ref/a.md"), "utf8"),
    "newer"
  );
  assert.equal(
    fs.readFileSync(path.join(mac, "skills/infra/SKILL.md"), "utf8"),
    "edited on the mac"
  );
});

test("copy: a pack with a path outside or a link pointing out is refused whole", async () => {
  const mac = tmp();
  const record = path.join(tmp(), "r.json");
  const build = (make: (dir: string) => void, names: string[]) => {
    const dir = tmp();
    write(dir, "setup.json", JSON.stringify({ from: "x", plugins: [] }));
    make(dir);
    const file = path.join(tmp(), "p.tgz");
    execFileSync("tar", ["-czf", file, "-C", dir, "setup.json", ...names]);
    return fs.createReadStream(file);
  };
  setSetupJob(null);
  await assert.rejects(
    installSetup(
      build((d) => write(d, "settings.json", "{}"), ["settings.json"]),
      { root: mac, record }
    ),
    SetupRefused
  );
  setSetupJob(null);
  await assert.rejects(
    installSetup(
      build(
        (d) => {
          write(d, "skills/evil/SKILL.md", "x");
          fs.symlinkSync("/etc/passwd", path.join(d, "skills/evil/out"));
        },
        ["skills/evil"]
      ),
      { root: mac, record }
    ),
    SetupRefused
  );
  assert.equal(fs.existsSync(path.join(mac, "skills/evil")), false);
  assert.equal(fs.existsSync(path.join(mac, "settings.json")), false);
  setSetupJob(null);
  await assert.rejects(
    installSetup(Readable.from([Buffer.from("not a tar")]), {
      root: mac,
      record,
    }),
    SetupRefused
  );
});

test("copy: a forced entry replaces the owner's version and keeps the old one", async () => {
  const hub = hubHome();
  const mac = tmp();
  const record = path.join(tmp(), "r.json");
  const backups = path.join(tmp(), "old");
  write(mac, "commands/duo.md", "my own duo command");
  write(mac, "skills/duo/SKILL.md", "my own duo skill");
  setSetupJob(null);
  const pack = await packSetup(["command:duo.md", "skill:duo"], "Unraid", hub);
  const job = await installSetup(pack.stream, {
    root: mac,
    record,
    backups,
    waitForPlugins: true,
    force: new Set(["command:duo.md"]),
  });
  await pack.done;
  assert.deepEqual(job.copied, ["command:duo.md"]);
  assert.deepEqual(job.kept, ["skill:duo"]);
  assert.equal(
    fs.readFileSync(path.join(mac, "commands/duo.md"), "utf8"),
    "run duo"
  );
  assert.equal(
    fs.readFileSync(path.join(mac, "skills/duo/SKILL.md"), "utf8"),
    "my own duo skill"
  );
  const old = fs.readdirSync(backups);
  assert.equal(old.length, 1);
  assert.match(old[0], / command duo\.md$/);
  assert.equal(
    fs.readFileSync(path.join(backups, old[0]), "utf8"),
    "my own duo command"
  );
  assert.equal(
    readRecord(record).placed["command:duo.md"],
    hashEntry(path.join(hub, "commands/duo.md")).hash
  );
});
