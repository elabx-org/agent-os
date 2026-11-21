import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// requireLinkMachine reads the machines table: a throwaway database
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-twoway-"));
process.env.DB_PATH = path.join(dir, "test.db");

import type { UpEvent } from "../../lib/link/hub";
import type { MachineRow } from "../../lib/link/store";
import { BASE_UP_RULES, type UpRefusal } from "../../lib/link/up";
import { AGENT_UP_RULES } from "../../lib/link/up-agent-rules";
import { RateWindows, beforeUp } from "../../lib/link/up-policy";
import { MACHINE_ID, rig } from "./link-rig";

const SID = "0123abcd-0000-4000-8000-0123456789ab";
const json = (body: Buffer) => JSON.parse(body.toString());

async function twoway() {
  const events: UpEvent[] = [];
  const refused: UpRefusal[] = [];
  const bodies: {
    url: string;
    body: unknown;
    headers: Record<string, unknown>;
  }[] = [];
  const windows = new RateWindows();
  const r = await rig({
    deps: {
      upRules: () => [...BASE_UP_RULES, ...AGENT_UP_RULES],
      onUp: (e) => events.push(e),
      onUpRefused: (_m, refusal) => refused.push(refusal),
      beforeUp: (d, m) =>
        beforeUp(d, m, { hasCap: (id, cap) => r.hub.hasCap(id, cap), windows }),
    },
    hubApi: (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        bodies.push({
          url: req.url!,
          body: raw ? JSON.parse(raw) : null,
          headers: req.headers,
        });
        res.writeHead(req.method === "POST" ? 201 : 200, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({ session: { id: SID, name: "From the Mac" } }));
      });
    },
  });
  return { r, events, refused, bodies };
}

const allow = (r: Awaited<ReturnType<typeof rig>>, over: Partial<MachineRow>) =>
  Object.assign(r.deps.rows.get(MACHINE_ID)!, over);

test("two-way: the switch off is told to the hub once per refusal", async () => {
  const { r, refused } = await twoway();
  const c = await r.linked();
  const res = await c.up("agent", { method: "GET", path: "/api/sessions" });
  assert.equal(res.status, 403);
  assert.deepEqual(
    refused.map((x) => x.code),
    ["hub_agents_off"]
  );
  c.stop();
  await r.close();
});

test("two-way: a start goes up as the table rebuilds it, and is reported", async () => {
  const { r, events, bodies } = await twoway();
  const c = await r.linked();
  allow(r, { uses_hub: 1 });
  const body = Buffer.from(
    JSON.stringify({
      projectId: "proj",
      initialPrompt: "Build it",
      agentType: "shell",
      workingDirectory: "~/.ssh",
      baseBranch: '";touch x;"',
    })
  );
  const res = await c.up("agent", {
    method: "POST",
    path: "/api/sessions",
    headers: {
      "content-type": "application/json",
      "content-length": String(body.length),
      "x-agentos-chain": "1",
    },
    body,
  });
  assert.equal(res.status, 201);
  assert.equal(bodies[0].url, "/api/sessions");
  assert.deepEqual(bodies[0].body, {
    projectId: "proj",
    initialPrompt: "Build it",
    useWorktree: false,
    featureName: null,
    agentType: "claude",
    autoApprove: false,
    permissionMode: "manual",
    launch: true,
  });
  assert.equal(bodies[0].headers["x-agentos-from-machine"], MACHINE_ID);
  assert.equal(bodies[0].headers["x-agentos-chain"], "1");
  for (let i = 0; i < 50 && !events.length; i++) {
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.equal(events[0].rule.action, "start");
  assert.equal(events[0].status, 201);
  assert.deepEqual(
    json(Buffer.from(JSON.stringify(events[0].answer))).session,
    {
      id: SID,
      name: "From the Mac",
    }
  );
  c.stop();
  await r.close();
});

test("two-way: a relay to a machine that isn't connected is refused at the hub", async () => {
  const { r, bodies } = await twoway();
  const c = await r.linked();
  allow(r, { uses_hub: 1 });
  const res = await c.up("agent", {
    method: "GET",
    path: "/m/m_abcdefabcdef/api/sessions",
  });
  assert.equal(res.status, 503);
  assert.equal(json(res.body).code, "machine_offline");
  assert.equal(bodies.length, 0);
  c.stop();
  await r.close();
});
