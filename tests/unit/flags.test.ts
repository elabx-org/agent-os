import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Flags } from "../../lib/flag-names";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-flags-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");
delete process.env.AGENTOS_DISABLE_TICKERS;

let flags: typeof import("../../lib/flags");
let db: typeof import("../../lib/db");

before(async () => {
  flags = await import("../../lib/flags");
  db = await import("../../lib/db");
  // Opening it runs every migration, each with a log line
  const log = console.log;
  console.log = () => {};
  try {
    db.getDb();
  } finally {
    console.log = log;
  }
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const readMirror = () =>
  JSON.parse(fs.readFileSync(flags.flagsMirrorFile(), "utf8"));

const storedValue = () => {
  const row = db.queries
    .getPreference(db.getDb())
    .get(flags.FLAGS_PREFERENCE_KEY) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
};

describe("parseFlags", () => {
  test("fills in defaults and drops unknown or non-boolean values", () => {
    assert.deepEqual(flags.parseFlags(null), flags.FLAG_DEFAULTS);
    assert.deepEqual(flags.parseFlags([true]), flags.FLAG_DEFAULTS);
    assert.deepEqual(
      flags.parseFlags({ queue: true, snapshots: "yes", bogus: true }),
      { ...flags.FLAG_DEFAULTS, queue: true }
    );
  });

  test("every flag has a default and a label", () => {
    for (const name of flags.FLAG_NAMES) {
      assert.equal(typeof flags.FLAG_DEFAULTS[name], "boolean");
      assert.ok(flags.FLAG_LABELS[name].label);
    }
    assert.ok(!flags.TICKER_FLAGS.includes("chatDefault"));
    assert.ok(!flags.TICKER_FLAGS.includes("liveFullAccess"));
  });
});

describe("effectiveFlags", () => {
  const allOn = () =>
    Object.fromEntries(flags.FLAG_NAMES.map((n) => [n, true])) as Flags;

  test("leaves the stored flags alone when tickers are allowed", () => {
    assert.deepEqual(flags.effectiveFlags(allOn(), false), allOn());
  });

  test("turns every ticker off, and only those, when disabled", () => {
    const out = flags.effectiveFlags(allOn(), true);
    for (const name of flags.FLAG_NAMES) {
      assert.equal(out[name], !flags.TICKER_FLAGS.includes(name), name);
    }
  });
});

describe("getFlags / setFlags", () => {
  test("defaults on an empty database, mirrored to flags.json", () => {
    assert.deepEqual(flags.getFlags(), flags.FLAG_DEFAULTS);
    assert.deepEqual(readMirror(), flags.FLAG_DEFAULTS);
  });

  test("saves, merges and mirrors a change", () => {
    let out = flags.setFlags({ queue: true });
    assert.equal(out.queue, true);
    out = flags.setFlags({ liveFullAccess: true });
    assert.equal(out.queue, true, "earlier change kept");
    assert.equal(out.liveFullAccess, true);
    assert.equal(flags.getFlag("queue"), true);
    assert.deepEqual(storedValue(), out);
    assert.deepEqual(readMirror(), out);
    // Owner only: the mirror sits next to auth.json
    assert.equal(fs.statSync(flags.flagsMirrorFile()).mode & 0o777, 0o600);
  });

  test("rejects unknown flags and non-booleans without saving", () => {
    const before = storedValue();
    assert.throws(
      () => flags.setFlags({ bogus: true } as never),
      /Unknown flag/
    );
    assert.throws(
      () => flags.setFlags({ queue: "on" } as never),
      /true or false/
    );
    assert.deepEqual(storedValue(), before);
  });

  test("AGENTOS_DISABLE_TICKERS forces tickers off over the database", () => {
    process.env.AGENTOS_DISABLE_TICKERS = "1";
    try {
      assert.equal(flags.tickersDisabled(), true);
      const out = flags.setFlags({ snapshots: true });
      assert.equal(out.queue, false);
      assert.equal(out.snapshots, false);
      assert.equal(out.liveFullAccess, true, "not a ticker");
      assert.equal(readMirror().snapshots, false, "hooks see it off too");
      // Still stored, for when the env goes
      assert.equal(storedValue().snapshots, true);
    } finally {
      delete process.env.AGENTOS_DISABLE_TICKERS;
    }
    assert.equal(flags.setFlags({}).snapshots, true);
  });

  test("an unreadable stored value reads as the defaults", () => {
    db.queries
      .upsertPreference(db.getDb())
      .run(flags.FLAGS_PREFERENCE_KEY, "{not json");
    assert.deepEqual(flags.setFlags({}), flags.FLAG_DEFAULTS);
  });

  test("the cache is shared through globalThis", () => {
    flags.setFlags({ chatDefault: true });
    // A direct write (another process, or the generic preferences route)
    // shows once the 5s cache expires, not before
    db.queries
      .upsertPreference(db.getDb())
      .run(flags.FLAGS_PREFERENCE_KEY, JSON.stringify({ chatDefault: false }));
    assert.equal(flags.getFlag("chatDefault"), true);
    const shared = globalThis as unknown as {
      __agentosFlags?: { at: number };
    };
    assert.ok(shared.__agentosFlags);
    shared.__agentosFlags.at -= 6000;
    assert.equal(flags.getFlag("chatDefault"), false);
  });
});
