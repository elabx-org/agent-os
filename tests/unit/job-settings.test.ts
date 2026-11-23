import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A machine's own say over its jobs: kept in its AgentOS folder
const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jobset-"));
process.env.AGENT_OS_HOME = home;

test("a machine asks first until the user says otherwise", async () => {
  const { jobMode, setJobMode } = await import("../../lib/jobs/settings");
  assert.equal(jobMode(), "manual");
  setJobMode("auto");
  assert.equal(jobMode(), "auto");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(home, "job-settings.json"), "utf8")),
    { mode: "auto" }
  );
  setJobMode("acceptEdits");
  assert.equal(jobMode(), "acceptEdits");
});

test("a file someone edited to full access reads as ask first", async () => {
  const { jobMode } = await import("../../lib/jobs/settings");
  const file = path.join(home, "job-settings.json");
  fs.writeFileSync(file, JSON.stringify({ mode: "bypassPermissions" }));
  assert.equal(jobMode(), "manual");
  fs.writeFileSync(file, "not json");
  assert.equal(jobMode(), "manual");
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(jobMode(), "manual");
});

test("only the user's own page may change the level", async () => {
  const { PUT, GET } = await import("../../app/api/jobs/settings/route");
  fs.mkdirSync(home, { recursive: true });
  const put = (headers: Record<string, string>, mode: unknown) =>
    PUT(
      new Request("http://127.0.0.1:3011/api/jobs/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ mode }),
      }) as never
    );
  const agent = await put({ "x-agentos-origin": "agent" }, "auto");
  assert.equal(agent.status, 403);
  assert.equal((await agent.json()).error, "user_only");
  // No proof cookie: a script on the machine, or another site's page
  const bare = await put({}, "auto");
  assert.equal(bare.status, 403);
  const got = await GET();
  assert.deepEqual(await got.json(), { mode: "manual" });
});
