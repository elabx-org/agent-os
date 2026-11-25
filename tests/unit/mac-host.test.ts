import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const src = path.join(root, "scripts", "mac-host");

function hasCompiler(): boolean {
  return spawnSync("cc", ["--version"]).status === 0;
}

function build(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-host-"));
  const bin = path.join(dir, "agentos-host");
  execFileSync("cc", [
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-o",
    bin,
    path.join(src, "main.c"),
  ]);
  return bin;
}

test("the host ends as what it runs ends", { skip: !hasCompiler() }, () => {
  const bin = build();
  assert.equal(spawnSync(bin, ["--selftest"]).status, 0);
  assert.equal(spawnSync(bin, ["--", "sh", "-c", "exit 7"]).status, 7);
  const out = spawnSync(bin, ["--", "sh", "-c", "echo $AGENTOS_HOST_TEST"], {
    env: { ...process.env, AGENTOS_HOST_TEST: "kept" },
    encoding: "utf8",
  });
  assert.equal(out.stdout.trim(), "kept");
  assert.equal(spawnSync(bin, ["--", "/no/such/program"]).status, 127);
  // Nothing to run: it never guesses
  assert.equal(spawnSync(bin, []).status, 2);
  assert.equal(spawnSync(bin, ["sh", "-c", "exit 0"]).status, 2);
});

test(
  "the host passes a stop on to what it runs",
  { skip: !hasCompiler() },
  async () => {
    const bin = build();
    const child = spawn(
      bin,
      [
        "--",
        "sh",
        "-c",
        'trap "echo stopped; exit 42" TERM; echo up; sleep 30 & wait',
      ],
      {
        stdio: ["ignore", "pipe", "inherit"],
      }
    );
    let out = "";
    const code = await new Promise<number | null>((resolve) => {
      child.stdout.on("data", (d: Buffer) => {
        const first = !out.includes("up");
        out += d.toString();
        if (first && out.includes("up")) child.kill("SIGTERM");
      });
      child.on("exit", resolve);
    });
    assert.equal(code, 42);
    assert.match(out, /stopped/);
  }
);

test("the host app says why a session asks, for each thing macOS asks about", () => {
  const plist = fs.readFileSync(path.join(src, "Info.plist"), "utf8");
  assert.match(
    plist,
    /<key>CFBundleIdentifier<\/key><string>com\.agentos\.host<\/string>/
  );
  assert.match(plist, /<key>CFBundleName<\/key><string>AgentOS<\/string>/);
  // Without its line, macOS refuses (or ends) what asks instead of asking
  for (const key of [
    "NSAppleEventsUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
    "NSDesktopFolderUsageDescription",
    "NSDocumentsFolderUsageDescription",
    "NSDownloadsFolderUsageDescription",
    "NSLocalNetworkUsageDescription",
  ]) {
    assert.match(
      plist,
      new RegExp(
        `<key>${key}</key><string>A session in AgentOS wants to [^<]+\\.</string>`
      )
    );
  }
});

test("the service still starts when there's no host app", () => {
  const text = fs.readFileSync(
    path.join(root, "scripts", "agentos-machine.sh"),
    "utf8"
  );
  const run = text.slice(
    text.indexOf("cmd_run() {"),
    text.indexOf("cmd_link() {")
  );
  assert.match(
    run,
    /if host_ready; then[\s\S]*exec "\$HOST_BIN" -- node_modules\/\.bin\/tsx server\.ts\n\s*fi\n\s*exec node_modules\/\.bin\/tsx server\.ts/
  );
  assert.match(run, /shopt -s execfail/);
  // The no-host file and a Mac without Xcode's tools both mean the old way
  assert.match(text, /\[ -f "\$AGENT_OS_HOME\/no-host" \] && return 1/);
  assert.match(text, /xcrun -f cc >\/dev\/null 2>&1 \|\|/);
});
