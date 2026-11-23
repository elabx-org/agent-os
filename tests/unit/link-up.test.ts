import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import { WebSocket, WebSocketServer } from "ws";

// requireLinkMachine reads the machines table: a throwaway database
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-up-"));
process.env.DB_PATH = path.join(dir, "test.db");

import { LinkClient, UpUnavailable } from "../../lib/link/client";
import { generateMachineKey, signProof } from "../../lib/link/keys";
import {
  BIN_UP,
  CAP_PEER,
  CAP_TAKE,
  CAP_UP,
  LINK_PATH,
  UP_ANSWER_MAX,
  UP_CHUNK,
  encodeBinary,
  parseFrame,
  proofText,
  type HubFrame,
} from "../../lib/link/protocol";
import type { MachineRow } from "../../lib/link/store";
import { BASE_UP_RULES, decideUp, type UpRule } from "../../lib/link/up";
import { BACKUP_UP_RULES } from "../../lib/link/up-backup-rules";
import { MACHINE_ID, TEST_PROOF, listen, rig } from "./link-rig";

const OTHER = "m_abcdefabcdef";
const env = { port: 3011, proof: TEST_PROOF };

const row = (over: Partial<MachineRow> = {}): MachineRow => ({
  id: MACHINE_ID,
  name: "Test Mac",
  public_key: "k",
  status: "approved",
  platform: "darwin",
  sha: null,
  signed_in_as: null,
  created_at: 1,
  approved_at: 1,
  last_seen: 1,
  agents: 0,
  uses_hub: 1,
  backup: 1,
  caps: null,
  ...over,
});

const agentGet = (p: string, headers: unknown = {}) => ({
  kind: "agent",
  method: "GET",
  path: p,
  headers,
});

const RELAY_RULE: UpRule = {
  kind: "agent",
  method: "GET",
  path: /^\/api\/sessions$/,
  relay: true,
  query: ["limit"],
  maxBody: 0,
  headMs: 1000,
};

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 300 && !check(); i++) await wait(10);
  assert.ok(check(), what);
}

const json = (body: Buffer) => JSON.parse(body.toString());

// --- decideUp ---

test("decideUp: only an approved machine, and only with its switch on", () => {
  assert.equal(
    (
      decideUp(BASE_UP_RULES, null, agentGet("/api/link/hello"), env) as {
        code: string;
      }
    ).code,
    "machine_unknown"
  );
  const pending = decideUp(
    BASE_UP_RULES,
    row({ status: "pending" }),
    agentGet("/api/link/hello"),
    env
  );
  assert.equal(!pending.ok && pending.code, "machine_unknown");
  const off = decideUp(
    BASE_UP_RULES,
    row({ uses_hub: 0 }),
    agentGet("/api/link/hello"),
    env
  );
  assert.equal(!off.ok && off.code, "hub_agents_off");
  assert.equal(!off.ok && off.status, 403);
  const backupOff = decideUp(
    BASE_UP_RULES,
    row({ backup: 0 }),
    {
      kind: "system",
      method: "POST",
      path: "/api/link/inbox/ping",
      headers: {},
    },
    env
  );
  assert.equal(!backupOff.ok && backupOff.code, "backup_off");
  assert.ok(
    decideUp(BASE_UP_RULES, row(), agentGet("/api/link/hello"), env).ok
  );
});

test("decideUp: the kind and the path must agree", () => {
  const agentInbox = decideUp(
    BASE_UP_RULES,
    row(),
    {
      kind: "agent",
      method: "POST",
      path: "/api/link/inbox/ping",
      headers: {},
    },
    env
  );
  assert.equal(!agentInbox.ok && agentInbox.code, "not_allowed_from_machine");
  const systemElsewhere = decideUp(
    BASE_UP_RULES,
    row(),
    { kind: "system", method: "GET", path: "/api/link/hello", headers: {} },
    env
  );
  assert.equal(
    !systemElsewhere.ok && systemElsewhere.code,
    "not_allowed_from_machine"
  );
  for (const bad of [
    { kind: "user", method: "GET" },
    { kind: "agent", method: "PATCH" },
    { kind: 1, method: "GET" },
  ]) {
    const d = decideUp(
      BASE_UP_RULES,
      row(),
      { ...bad, path: "/api/link/hello", headers: {} },
      env
    );
    assert.equal(!d.ok && d.code, "bad_request");
  }
});

test("decideUp: path tricks are refused", () => {
  for (const p of [
    "/api/link/../link/hello",
    "/api//link/hello",
    "/api\\link\\hello",
    "/api/link/%2e%2e/hello",
    "/api%2flink%2fhello",
    "http://evil/api/link/hello",
    "/api/$(x)",
    "/api/`x`",
    "api/link/hello",
    "/api/link/hello ",
    "/" + "a".repeat(2048),
  ]) {
    const d = decideUp(BASE_UP_RULES, row(), agentGet(p), env);
    assert.equal(d.ok, false, p);
  }
  assert.equal(
    (
      decideUp(BASE_UP_RULES, row(), agentGet("/api/preferences"), env) as {
        code: string;
      }
    ).code,
    "not_allowed_from_machine"
  );
});

test("decideUp: another machine only through relay rules, never itself", () => {
  const self = decideUp(
    [RELAY_RULE],
    row(),
    agentGet(`/m/${MACHINE_ID}/api/sessions`),
    env
  );
  assert.equal(!self.ok && self.code, "same_machine");
  assert.equal(!self.ok && self.status, 400);
  const notRelay = decideUp(
    BASE_UP_RULES,
    row(),
    agentGet(`/m/${OTHER}/api/link/hello`),
    env
  );
  assert.equal(!notRelay.ok && notRelay.code, "not_allowed_from_machine");
  const relay = decideUp(
    [RELAY_RULE],
    row(),
    agentGet(`/m/${OTHER}/api/sessions?limit=5`),
    env
  );
  assert.ok(relay.ok);
  assert.equal(relay.path, `/m/${OTHER}/api/sessions?limit=5`);
  assert.equal(relay.targetMachineId, OTHER);
});

test("decideUp: only the rule's query keys stay, and ?machine= can't re-route", () => {
  const d = decideUp(
    [RELAY_RULE],
    row(),
    agentGet(`/api/sessions?machine=${OTHER}&limit=5&evil=1&limit=9`),
    env
  );
  assert.ok(d.ok);
  assert.equal(d.path, "/api/sessions?limit=5");
  assert.equal(d.headers["x-agentos-machine"], "hub");
  const odd = decideUp(
    [RELAY_RULE],
    row(),
    agentGet(`/api/sessions?limit=${encodeURIComponent("$(x)")}`),
    env
  );
  assert.ok(odd.ok);
  assert.equal(odd.path, "/api/sessions");
});

test("decideUp: headers are built from nothing", () => {
  const forged = {
    cookie: "agentos_u=stolen",
    Authorization: "Bearer t",
    "x-agentos-origin": "user",
    "x-agentos-actor": "claude-boss",
    "x-agentos-link-proof": TEST_PROOF,
    "x-agentos-link-machine": OTHER,
    "x-agentos-from-machine": OTHER,
    "x-forwarded-for": "1.2.3.4",
    origin: "https://evil",
    "x-agentos-chain": "2",
    "Content-Type": "application/json; charset=utf-8",
    "content-length": "12",
  };
  const agent = decideUp(
    BASE_UP_RULES,
    row(),
    agentGet("/api/link/hello", forged),
    env
  );
  assert.ok(agent.ok);
  assert.deepEqual(agent.headers, {
    host: "127.0.0.1:3011",
    "x-agentos-machine": "hub",
    "x-agentos-origin": "agent",
    "content-type": "application/json",
    "content-length": "12",
    "x-agentos-actor": `link:${MACHINE_ID}`,
    "x-agentos-from-machine": MACHINE_ID,
    "x-agentos-chain": "2",
  });
  const system = decideUp(
    BASE_UP_RULES,
    row(),
    {
      kind: "system",
      method: "POST",
      path: "/api/link/inbox/ping",
      headers: { ...forged, "Content-Type": "text/html" },
    },
    env
  );
  assert.ok(system.ok);
  assert.deepEqual(system.headers, {
    host: "127.0.0.1:3011",
    "x-agentos-machine": "hub",
    "x-agentos-origin": "agent",
    "content-length": "12",
    "x-agentos-link-machine": MACHINE_ID,
    "x-agentos-link-proof": TEST_PROOF,
  });
});

// --- Through a real link ---

const allow = (r: Awaited<ReturnType<typeof rig>>, over: Partial<MachineRow>) =>
  Object.assign(r.deps.rows.get(MACHINE_ID)!, over);

test("up: an agent's GET arrives marked as a machine's session, with nothing forged", async () => {
  const r = await rig();
  const c = await r.linked();
  allow(r, { uses_hub: 1 });
  const answer = await c.up("agent", {
    method: "GET",
    path: "/api/link/hello",
    headers: {
      cookie: "agentos_u=stolen",
      authorization: "Bearer t",
      "x-agentos-origin": "user",
      "x-agentos-actor": "claude-boss",
      "x-agentos-link-proof": TEST_PROOF,
      "x-agentos-from-machine": OTHER,
      "x-forwarded-for": "1.2.3.4",
    },
  });
  assert.equal(answer.status, 200);
  assert.equal(answer.headers["set-cookie"], undefined);
  const seen = json(answer.body) as {
    url: string;
    headers: Record<string, string>;
  };
  assert.equal(seen.url, "/api/link/hello");
  const h = seen.headers;
  assert.equal(h.cookie, undefined);
  assert.equal(h.authorization, undefined);
  assert.equal(h["x-forwarded-for"], undefined);
  assert.equal(h["x-agentos-link-proof"], undefined);
  assert.equal(h["x-agentos-origin"], "agent");
  assert.equal(h["x-agentos-actor"], `link:${MACHINE_ID}`);
  assert.equal(h["x-agentos-from-machine"], MACHINE_ID);
  assert.equal(h.host, `127.0.0.1:${r.deps.port}`);
  c.stop();
  await r.close();
});

test("up: a switch flipped mid-connection applies to the next request", async () => {
  const r = await rig();
  const c = await r.linked();
  const hello = () => c.up("agent", { method: "GET", path: "/api/link/hello" });
  const off = await hello();
  assert.equal(off.status, 403);
  assert.equal(json(off.body).code, "hub_agents_off");
  assert.equal(r.apiSeen.length, 0);
  allow(r, { uses_hub: 1 });
  assert.equal((await hello()).status, 200);
  // The machine's own "agents" frame changes only that switch
  assert.equal(c.setAgents(true), true);
  await until(() => r.deps.rows.get(MACHINE_ID)!.agents === 1, "agents");
  assert.equal(r.deps.rows.get(MACHINE_ID)!.uses_hub, 1);
  assert.equal(r.deps.rows.get(MACHINE_ID)!.backup, 0);
  c.stop();
  await r.close();
});

test("up: the machine hears what it may ask, at welcome and when it changes", async () => {
  const r = await rig();
  const seen: unknown[] = [];
  const c = await r.linked({ onUpAllowed: (up) => seen.push(up) });
  assert.ok(c.hubCaps.has(CAP_UP));
  assert.deepEqual(c.upAllowed, {
    agents: false,
    backup: false,
    name: "Test Mac",
    hubName: "Unraid",
  });
  assert.equal(
    r.deps.rows.get(MACHINE_ID)!.caps,
    JSON.stringify([CAP_UP, CAP_TAKE, CAP_PEER])
  );
  assert.equal(r.hub.hasCap(MACHINE_ID, CAP_UP), true);
  assert.equal(r.hub.hasCap("m_ffffffffffff", CAP_UP), null);
  allow(r, { uses_hub: 1 });
  r.hub.tellUp(MACHINE_ID);
  await until(() => c.upAllowed?.agents === true, "up-allowed");
  assert.equal(c.upAllowed?.backup, false);
  c.stop();
  await r.close();
  assert.ok(seen.length >= 2);
});

test("up: a system call arrives with the proof and the tunnel's id", async () => {
  const r = await rig();
  const c = await r.linked();
  allow(r, { backup: 1 });
  const answer = await c.up("system", {
    method: "POST",
    path: "/api/link/inbox/ping",
    headers: {
      "content-type": "application/json",
      "x-agentos-link-machine": OTHER,
    },
    body: Buffer.from('{"hi":1}'),
  });
  assert.equal(answer.status, 200);
  const seen = json(answer.body);
  assert.equal(seen.body, '{"hi":1}');
  assert.equal(seen.headers["x-agentos-link-proof"], TEST_PROOF);
  assert.equal(seen.headers["x-agentos-link-machine"], MACHINE_ID);
  assert.equal(seen.headers["x-agentos-actor"], undefined);
  // Its own switch, not the other one
  allow(r, { backup: 0, uses_hub: 1 });
  const off = await c.up("system", {
    method: "POST",
    path: "/api/link/inbox/ping",
  });
  assert.equal(json(off.body).code, "backup_off");
  c.stop();
  await r.close();
});

test("up: an agent POST sends only what the rule builds", async () => {
  const rule: UpRule = {
    kind: "agent",
    method: "POST",
    path: /^\/api\/test\/start$/,
    relay: false,
    maxBody: 100,
    headMs: 5000,
    body: (input) => {
      const name = (input as { name?: unknown }).name;
      return typeof name === "string"
        ? { body: { name } }
        : {
            ok: false,
            status: 400,
            code: "bad_request",
            error: "name is required",
          };
    },
  };
  const r = await rig({ deps: { upRules: () => [rule] } });
  const c = await r.linked();
  allow(r, { uses_hub: 1 });
  const post = (body: string) =>
    c.up("agent", {
      method: "POST",
      path: "/api/test/start",
      headers: { "content-type": "application/json" },
      body: Buffer.from(body),
    });
  const ok = await post(
    JSON.stringify({
      name: "x",
      workingDirectory: "~/.ssh",
      agentType: "shell",
    })
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(json(ok.body).body), { name: "x" });
  assert.equal((await post("{}")).status, 400);
  assert.equal(json((await post("not json")).body).code, "bad_request");
  const big = await post(JSON.stringify({ name: "y".repeat(200) }));
  assert.equal(big.status, 413);
  assert.equal(json(big.body).code, "too_large");
  c.stop();
  await r.close();
});

test("up: a 32 MiB copy arrives byte for byte", async () => {
  const rule: UpRule = {
    kind: "system",
    method: "PUT",
    path: /^\/api\/link\/inbox\/blob$/,
    relay: false,
    maxBody: 64 * 1024 * 1024,
    headMs: 60_000,
  };
  const r = await rig({
    deps: { upRules: () => [rule] },
    hubApi: (req, res) => {
      const hash = createHash("sha256");
      let bytes = 0;
      req.on("data", (c: Buffer) => {
        hash.update(c);
        bytes += c.length;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ bytes, hash: hash.digest("hex") }));
      });
    },
  });
  const c = await r.linked();
  allow(r, { backup: 1 });
  const data = Buffer.alloc(32 * 1024 * 1024);
  for (let i = 0; i < data.length; i += 4096) data[i] = i % 251;
  const answer = await c.up("system", {
    method: "PUT",
    path: "/api/link/inbox/blob",
    headers: { "content-type": "application/octet-stream" },
    body: Readable.from([data]),
  });
  assert.equal(answer.status, 200);
  assert.deepEqual(json(answer.body), {
    bytes: data.length,
    hash: createHash("sha256").update(data).digest("hex"),
  });
  c.stop();
  await r.close();
});

test("up: a streamed body can't run past its content-length into a second request", async () => {
  const rule: UpRule = {
    kind: "system",
    method: "POST",
    path: /^\/api\/link\/inbox\/ping$/,
    relay: false,
    maxBody: 4096,
    headMs: 5000,
  };
  const r = await rig({
    deps: { upRules: () => [rule] },
    hubApi: (req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ path: req.url }));
      });
    },
  });
  const c = await r.linked();
  allow(r, { backup: 1 });
  const smuggled =
    "POST /api/sessions HTTP/1.1\r\nHost: 127.0.0.1\r\n" +
    "Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}";
  const over = await c
    .up("system", {
      method: "POST",
      path: "/api/link/inbox/ping",
      headers: { "content-length": "0" },
      body: Readable.from([Buffer.from(smuggled)]),
    })
    .then(
      (a) => a.status,
      () => "failed"
    );
  assert.notEqual(over, 200);
  // Short of what it declared: refused too, never sent on half-made
  const short = await c.up("system", {
    method: "POST",
    path: "/api/link/inbox/ping",
    headers: { "content-length": "100" },
    body: Buffer.from("{}"),
  });
  assert.equal(short.status, 400);
  assert.equal(json(short.body).code, "bad_request");
  // The right length still goes through
  const ok = await c.up("system", {
    method: "POST",
    path: "/api/link/inbox/ping",
    headers: { "content-length": "2" },
    body: Buffer.from("{}"),
  });
  assert.equal(ok.status, 200);
  await wait(200);
  assert.ok(
    r.apiSeen.every((req) => req.url === "/api/link/inbox/ping"),
    `only the asked path reached the server: ${r.apiSeen.map((q) => q.url)}`
  );
  c.stop();
  await r.close();
});

test("up: the 9th request at once and the rate are refused with 429", async () => {
  const held: http.ServerResponse[] = [];
  const rule: UpRule = {
    kind: "agent",
    method: "GET",
    path: /^\/api\/slow$/,
    relay: false,
    maxBody: 0,
    headMs: 10_000,
  };
  const r = await rig({
    deps: { upRules: () => [rule] },
    hubApi: (_req, res) => {
      held.push(res);
    },
  });
  const c = await r.linked();
  allow(r, { uses_hub: 1 });
  const slow = () => c.up("agent", { method: "GET", path: "/api/slow" });
  const first = Array.from({ length: 8 }, slow);
  await until(() => held.length === 8, "eight held");
  const ninth = await slow();
  assert.equal(ninth.status, 429);
  assert.equal(json(ninth.body).code, "too_many");
  for (const res of held) res.end("{}");
  for (const a of await Promise.all(first)) assert.equal(a.status, 200);
  c.stop();
  await r.close();

  const limited = await rig({
    deps: {
      upLimits: {
        agent: { concurrent: 8, perMinute: 3, idleMs: 10_000 },
        system: { concurrent: 2, perMinute: 3, idleMs: 10_000 },
      },
    },
  });
  const c2 = await limited.linked();
  allow(limited, { uses_hub: 1 });
  const hello = () =>
    c2.up("agent", { method: "GET", path: "/api/link/hello" });
  for (let i = 0; i < 3; i++) assert.equal((await hello()).status, 200);
  assert.equal((await hello()).status, 429);
  c2.stop();
  await limited.close();
});

test("up: an answer over the cap fails, and is never delivered", async () => {
  const r = await rig({
    hubApi: (_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const piece = Buffer.alloc(1024 * 1024);
      for (let i = 0; i <= UP_ANSWER_MAX / piece.length; i++) res.write(piece);
      res.end();
    },
  });
  const c = await r.linked();
  allow(r, { uses_hub: 1 });
  await assert.rejects(
    c.up("agent", { method: "GET", path: "/api/link/hello" }),
    (e: unknown) => e instanceof UpUnavailable && e.code === "link_dropped"
  );
  c.stop();
  await r.close();
});

test("up: a body chunk over the limit closes the link", async () => {
  const r = await rig();
  const c = await r.linked();
  const ws = (c as unknown as { ws: WebSocket }).ws;
  const closed = new Promise<number>((done) => ws.once("close", done));
  ws.send(encodeBinary(1, BIN_UP, Buffer.alloc(UP_CHUNK + 1)));
  assert.equal(await closed, 1009);
  c.stop();
  await r.close();
});

test("up: a caller's abort reaches the hub's loopback call", async () => {
  let closedOnHub = false;
  const r = await rig({
    hubApi: (req) => {
      req.on("close", () => (closedOnHub = true));
    },
  });
  const c = await r.linked();
  allow(r, { uses_hub: 1 });
  const abort = new AbortController();
  const call = c.up("agent", {
    method: "GET",
    path: "/api/link/hello",
    signal: abort.signal,
  });
  await until(() => r.apiSeen.length === 1, "asked");
  abort.abort();
  await assert.rejects(call, /aborted/);
  await until(() => closedOnHub, "loopback call destroyed");
  c.stop();
  await r.close();
});

test("up: no head in time is a 504; a dropped link fails what is in flight", async () => {
  const rule: UpRule = { ...BASE_UP_RULES[0], headMs: 150 };
  const r = await rig({ deps: { upRules: () => [rule] }, hubApi: () => {} });
  const c = await r.linked();
  allow(r, { uses_hub: 1 });
  const late = await c.up("agent", { method: "GET", path: "/api/link/hello" });
  assert.equal(late.status, 504);
  assert.equal(json(late.body).code, "timeout");

  const slowRule: UpRule = { ...BASE_UP_RULES[0], headMs: 60_000 };
  r.deps.upRules = () => [slowRule];
  const call = c.up("agent", { method: "GET", path: "/api/link/hello" });
  await until(() => r.apiSeen.length === 2, "asked");
  (c as unknown as { ws: WebSocket }).ws.terminate();
  await assert.rejects(
    call,
    (e: unknown) => e instanceof UpUnavailable && e.code === "link_dropped"
  );
  const tunnels = (
    r.hub as unknown as { tunnels: Map<string, { ups: Map<number, unknown> }> }
  ).tunnels;
  await until(
    () => [...tunnels.values()].every((t) => t.ups.size === 0),
    "nothing left in ups"
  );
  c.stop();
  await r.close();
});

test("up: a rule may wait for its head longer than the idle limit", async () => {
  const rule: UpRule = { ...BASE_UP_RULES[0], headMs: 2000 };
  const r = await rig({
    deps: {
      upRules: () => [rule],
      upLimits: {
        agent: { concurrent: 8, perMinute: 300, idleMs: 100 },
        system: { concurrent: 2, perMinute: 120, idleMs: 100 },
      },
    },
    hubApi: (_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      }, 400);
    },
  });
  const c = await r.linked();
  allow(r, { uses_hub: 1 });
  const answer = await c.up("agent", {
    method: "GET",
    path: "/api/link/hello",
  });
  assert.equal(answer.status, 200);
  c.stop();
  await r.close();
});

test("up: a machine whose hub is too old never sends an up frame", async () => {
  // An older hub: welcome without caps, and it records what it hears
  const heard: string[] = [];
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: LINK_PATH });
  wss.on("connection", (ws) =>
    ws.on("message", (data, isBinary) => {
      if (isBinary) return heard.push("binary");
      const frame = JSON.parse(data.toString()) as { t: string };
      heard.push(frame.t);
      if (frame.t === "hello") {
        ws.send(JSON.stringify({ t: "challenge", nonce: "n" }));
      } else if (frame.t === "proof") {
        ws.send(
          JSON.stringify({
            t: "welcome",
            machineId: MACHINE_ID,
            status: "approved",
            sha: null,
            code: "00 00",
          })
        );
      }
    })
  );
  const port = await listen(server);
  let linked: () => void;
  const isLinked = new Promise<void>((done) => (linked = done));
  const c = new LinkClient({
    hubUrl: `http://127.0.0.1:${port}`,
    key: generateMachineKey(),
    name: "Mac",
    localPort: 1,
    sha: null,
    userCookie: () => "",
    onState: (s) => s.status === "linked" && linked(),
  });
  c.start();
  await isLinked;
  await assert.rejects(
    c.up("agent", { method: "GET", path: "/api/link/hello" }),
    (e: unknown) => e instanceof UpUnavailable && e.code === "hub_too_old"
  );
  await wait(50);
  assert.deepEqual(heard, ["hello", "proof"]);
  c.stop();
  wss.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

test("up: an older machine gets no up-allowed, and its raw up frames are ignored", async () => {
  const r = await rig();
  const key = generateMachineKey();
  const code = r.hub.createPairingCode().code;
  const host = `127.0.0.1:${r.hubPort}`;
  const ws = new WebSocket(`ws://${host}${LINK_PATH}`);
  const frames: HubFrame[] = [];
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const frame = parseFrame<HubFrame>(data.toString())!;
    frames.push(frame);
    if (frame.t === "challenge") {
      ws.send(
        JSON.stringify({
          t: "proof",
          sig: signProof(key.privateKey, proofText(host, frame.nonce)),
        })
      );
    }
  });
  await new Promise((done) => ws.once("open", done));
  // No caps: an older machine
  ws.send(
    JSON.stringify({
      t: "hello",
      v: 1,
      key: key.publicKey,
      name: "Old Mac",
      platform: "darwin",
      sha: null,
      hubHost: host,
      code,
    })
  );
  await until(() => frames.some((f) => f.t === "welcome"), "pending");
  r.hub.approve(MACHINE_ID);
  await until(
    () => frames.some((f) => f.t === "welcome" && f.status === "approved"),
    "approved"
  );
  const welcome = frames.find(
    (f) => f.t === "welcome" && f.status === "approved"
  ) as Extract<HubFrame, { t: "welcome" }>;
  assert.equal(welcome.up, undefined);
  allow(r, { uses_hub: 1 });
  r.hub.tellUp(MACHINE_ID);
  // Nor "taken": it never named take1, so it wouldn't honour it
  r.hub.tellTaken(MACHINE_ID);
  ws.send(
    JSON.stringify({
      t: "up",
      id: 1,
      kind: "agent",
      method: "GET",
      path: "/api/link/hello",
      headers: {},
    })
  );
  ws.send(encodeBinary(1, BIN_UP, Buffer.from("x")));
  ws.send(JSON.stringify({ t: "up-end", id: 1 }));
  await wait(150);
  assert.equal(ws.readyState, WebSocket.OPEN);
  assert.equal(
    frames.some((f) => f.t.startsWith("up")),
    false
  );
  assert.equal(
    frames.some((f) => f.t === "taken"),
    false
  );
  assert.equal(r.apiSeen.length, 0);
  ws.close();
  await r.close();
});

// --- The routes' guards ---

test("requireLinkMachine: the proof and an approved row, or 403", async () => {
  const { requireLinkMachine, linkProof } =
    await import("../../lib/link/up-guard");
  const store = await import("../../lib/link/store");
  const log = console.log;
  console.log = () => {};
  const mac = store.createPendingMachine({
    name: "Mac",
    publicKey: "pk-1",
    platform: "darwin",
    sha: null,
    signedInAs: null,
  });
  console.log = log;
  const ask = (headers: Record<string, string>) =>
    requireLinkMachine(
      new Request("http://hub/api/link/inbox/ping", { headers })
    );
  const proof = linkProof();
  assert.match(proof, /^[0-9a-f]{64}$/);
  // Unapproved
  let r = ask({
    "x-agentos-link-proof": proof,
    "x-agentos-link-machine": mac.id,
  });
  assert.equal(r.ok, false);
  store.approveMachine(mac.id);
  r = ask({ "x-agentos-link-proof": proof, "x-agentos-link-machine": mac.id });
  assert.ok(r.ok);
  assert.equal(r.machine.id, mac.id);
  for (const bad of [
    {} as Record<string, string>,
    { "x-agentos-link-proof": "0".repeat(64) },
    { "x-agentos-link-proof": proof.slice(1) },
    { "x-agentos-link-proof": proof + "0" },
  ]) {
    const no = ask({ ...bad, "x-agentos-link-machine": mac.id });
    assert.equal(no.ok, false);
    if (!no.ok) {
      assert.equal(no.response.status, 403);
      assert.equal((await no.response.json()).code, "not_allowed_from_machine");
    }
  }
  const nobody = ask({
    "x-agentos-link-proof": proof,
    "x-agentos-link-machine": "m_ffffffffffff",
  });
  assert.equal(nobody.ok, false);
});

test("agentActorSessionId: a linked machine's actor is never a session here", async () => {
  const { agentActorSessionId, AGENT_ACTOR_HEADER } =
    await import("../../lib/agent-actions");
  const { createSchema } = await import("../../lib/db/schema");
  const { runMigrations } = await import("../../lib/db/migrations");
  const db = new Database(":memory:");
  createSchema(db);
  const log = console.log;
  console.log = () => {};
  runMigrations(db);
  console.log = log;
  // Even a row whose tmux name would match
  db.prepare(
    "INSERT INTO sessions (id, name, tmux_name, agent_type) VALUES (?, ?, ?, ?)"
  ).run("s1", "x", `link:${MACHINE_ID}`, "claude");
  const req = new Request("http://hub/", {
    headers: { [AGENT_ACTOR_HEADER]: `link:${MACHINE_ID}` },
  });
  assert.equal(agentActorSessionId(req, db), null);
});

test("fromMachine: only the hub's own marker or a machine id", async () => {
  const { fromMachine } = await import("../../lib/link/from-machine");
  const req = (value?: string) =>
    new Request("http://hub/", {
      headers: value ? { "x-agentos-from-machine": value } : {},
    });
  assert.equal(fromMachine(req()), null);
  assert.equal(fromMachine(req("hub")), "hub");
  assert.equal(fromMachine(req(MACHINE_ID)), MACHINE_ID);
  assert.equal(fromMachine(req("m_x")), null);
  assert.equal(fromMachine(req(`${MACHINE_ID}, hub`)), null);
});

test("up: saying what it carried on isn't behind the copies switch", () => {
  const off = row({ backup: 0 });
  const call = (path: string) =>
    decideUp(
      BACKUP_UP_RULES,
      off,
      { kind: "system", method: "POST", path, headers: {} },
      env
    );
  assert.equal(call("/api/link/inbox/peer/taken").ok, true);
  const copies = call("/api/link/inbox/backup/sessions");
  assert.equal(!copies.ok && copies.code, "backup_off");
  // Only that one path, and only as the machine's own AgentOS
  const other = call("/api/link/inbox/peer/sweep");
  assert.equal(other.ok, false);
  const agent = decideUp(
    BACKUP_UP_RULES,
    row({ backup: 1 }),
    {
      kind: "agent",
      method: "POST",
      path: "/api/link/inbox/peer/taken",
      headers: {},
    },
    env
  );
  assert.equal(agent.ok, false);
});
