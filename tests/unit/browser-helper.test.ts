import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "agentos-helper-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

import {
  exportLines,
  sessionBrowserEnv,
  tmuxEnvArgs,
  type SessionBrowserEnv,
} from "../../lib/browser-helper";

const HELPER = "/home/u/.agent-os/bin/agentos-browser";
const on = (force = false): SessionBrowserEnv => ({
  env: { AGENTOS_URL: "http://127.0.0.1:3011" },
  browser: HELPER,
  force,
});

describe("browser helper environment", () => {
  test("proxy off: sessions get nothing", () => {
    process.env.AGENTOS_PROXY = "0";
    try {
      assert.deepEqual(sessionBrowserEnv(), {
        env: {},
        browser: null,
        force: false,
      });
    } finally {
      delete process.env.AGENTOS_PROXY;
    }
    assert.equal(exportLines(sessionBrowserEnvOff()), "");
    assert.deepEqual(tmuxEnvArgs(sessionBrowserEnvOff(), undefined), []);
  });

  test("init script keeps a BROWSER the session already has", () => {
    const lines = exportLines(on());
    assert.match(lines, /^export AGENTOS_URL='http:\/\/127\.0\.0\.1:3011'$/m);
    assert.match(
      lines,
      /^if \[ -z "\$\{BROWSER:-\}" \] \|\| \[ "\$BROWSER" = '\/home\/u\/\.agent-os\/bin\/agentos-browser' \]; then export BROWSER='\/home\/u\/\.agent-os\/bin\/agentos-browser'; fi$/m
    );
    assert.match(exportLines(on(true)), /^export BROWSER='[^']+'$/m);
  });

  test("tmux sessions: BROWSER only when none, ours, or forced", () => {
    assert.deepEqual(tmuxEnvArgs(on(), undefined), [
      "-e",
      "AGENTOS_URL=http://127.0.0.1:3011",
      "-e",
      `BROWSER=${HELPER}`,
    ]);
    assert.deepEqual(tmuxEnvArgs(on(), "/usr/local/bin/browser-helper"), [
      "-e",
      "AGENTOS_URL=http://127.0.0.1:3011",
    ]);
    assert.ok(
      tmuxEnvArgs(on(true), "/usr/local/bin/browser-helper").includes(
        `BROWSER=${HELPER}`
      )
    );
  });
});

function sessionBrowserEnvOff(): SessionBrowserEnv {
  return { env: {}, browser: null, force: false };
}
