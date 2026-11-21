import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// lib/db reads DB_PATH when it loads, so the env is set before the import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mcp-config-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");

import { writeMcpConfig } from "../../lib/project-context";
import { claudeProvider } from "../../lib/providers";

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const file = (id: string) =>
  path.join(tmp, "home", "project-context", `${id}.mcp.json`);

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const old: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    old[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(old)) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}

test("mcp config: the session's file points at this machine's AgentOS", () => {
  const out = withEnv(
    {
      AGENTOS_MCP_SESSION_CONFIG: "1",
      PORT: "3116",
      AGENTOS_MCP_REGISTER: undefined,
    },
    () => writeMcpConfig("s-1")
  );
  assert.equal(out, file("s-1"));
  const config = JSON.parse(fs.readFileSync(out!, "utf8"));
  assert.deepEqual(config, {
    mcpServers: {
      "agent-os": {
        type: "stdio",
        command: process.execPath,
        args: [path.join(process.cwd(), "scripts", "agentos-mcp.mjs")],
        env: { AGENTOS_URL: "http://127.0.0.1:3116" },
      },
    },
  });
  assert.equal(fs.statSync(out!).mode & 0o777, 0o600);
});

test("mcp config: nothing on a server, with AGENTOS_MCP_REGISTER=0, or for other agents", () => {
  withEnv({ AGENTOS_MCP_SESSION_CONFIG: "1" }, () => writeMcpConfig("s-2"));
  assert.ok(fs.existsSync(file("s-2")));
  // Not linked (no link.json): a server
  assert.equal(
    withEnv({ AGENTOS_MCP_SESSION_CONFIG: undefined }, () =>
      writeMcpConfig("s-2")
    ),
    null
  );
  assert.equal(fs.existsSync(file("s-2")), false);
  assert.equal(
    withEnv(
      { AGENTOS_MCP_SESSION_CONFIG: "1", AGENTOS_MCP_REGISTER: "0" },
      () => writeMcpConfig("s-3")
    ),
    null
  );
  assert.equal(
    withEnv({ AGENTOS_MCP_SESSION_CONFIG: "1" }, () =>
      writeMcpConfig("s-4", "codex")
    ),
    null
  );
});

test("mcp config: on a linked machine it is written without the test switch", () => {
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, "link.json"),
    JSON.stringify({ hubUrl: "https://hub.test", name: "Mac" })
  );
  try {
    assert.equal(
      withEnv({ AGENTOS_MCP_SESSION_CONFIG: undefined }, () =>
        writeMcpConfig("s-5")
      ),
      file("s-5")
    );
  } finally {
    fs.rmSync(path.join(home, "link.json"));
  }
});

test("mcp config: --mcp-config goes right before --settings, never last", () => {
  const flags = claudeProvider.buildFlags({
    settingsFile: "/h/s.settings.json",
    mcpConfigFile: "/h/s.mcp.json",
    initialPrompt: "Do the thing",
    model: "opus",
  });
  const at = flags.indexOf("--mcp-config '/h/s.mcp.json'");
  assert.ok(at >= 0);
  assert.equal(flags[at + 1], "--settings '/h/s.settings.json'");
  assert.equal(flags[flags.length - 1], "'Do the thing'");
  // Without a settings file there is nothing to follow it: left out
  const bare = claudeProvider.buildFlags({
    mcpConfigFile: "/h/s.mcp.json",
    initialPrompt: "Do the thing",
  });
  assert.equal(
    bare.some((f) => f.startsWith("--mcp-config")),
    false
  );
});
