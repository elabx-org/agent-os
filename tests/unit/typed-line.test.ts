import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TYPED_LINE_MAX, typedLine } from "../../lib/typed-line";

const long = (bytes: number) => `: ${"a".repeat(bytes - 2)}`;

test("a line a terminal takes whole is typed as it is", () => {
  const line = "tmux attach -t claude-60a93467-abe3-4ce6-ab39-f5934bf1024c";
  assert.equal(
    typedLine(line, () => assert.fail("no file")),
    line
  );
  const most = long(TYPED_LINE_MAX);
  assert.equal(
    typedLine(most, () => assert.fail("no file")),
    most
  );
});

test("a Mac's terminal keeps 1024 bytes: the limit is under it", () => {
  assert.ok(TYPED_LINE_MAX < 1024 - 64);
});

test("a longer line is run from a file by a short one", () => {
  let wrote = "";
  const line = typedLine(long(TYPED_LINE_MAX + 1), (command) => {
    wrote = command;
    return "/tmp/agent-os-line-x.sh";
  });
  assert.equal(line, ". '/tmp/agent-os-line-x.sh'");
  assert.equal(wrote, long(TYPED_LINE_MAX + 1));
});

test("length is counted in bytes, not characters", () => {
  const line = `: ${"é".repeat(TYPED_LINE_MAX / 2)}`;
  assert.ok(line.length <= TYPED_LINE_MAX);
  assert.equal(
    typedLine(line, () => "/tmp/f"),
    ". '/tmp/f'"
  );
});

test("a quote in the file's folder can't end the typed line early", () => {
  const line = typedLine(long(2000), () => "/tmp/it's here/f.sh");
  assert.equal(line, ". '/tmp/it'\\''s here/f.sh'");
});

test("with no file to be had the line is typed whole", () => {
  const command = long(2000);
  const line = typedLine(command, () => {
    throw new Error("disk full");
  });
  assert.equal(line, command);
});

test("the file runs the line in the shell that reads it, then is gone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typed-line-"));
  try {
    const mark = path.join(dir, "ran");
    const command = `${long(1200)}; AGENTOS_T=here; touch '${mark}'`;
    const line = typedLine(command);
    assert.match(line, /^\. '.*agent-os-line-[\w-]+\.sh'$/);
    assert.ok(Buffer.byteLength(line) < 200);
    const file = line.slice(3, -1);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    // In the same shell: what the line sets is still set after it
    const out = execFileSync("bash", ["-c", `${line}; echo "$AGENTOS_T"`], {
      encoding: "utf8",
    });
    assert.equal(out.trim(), "here");
    assert.ok(fs.existsSync(mark));
    assert.ok(!fs.existsSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
