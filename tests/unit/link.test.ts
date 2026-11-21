import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { isForwardablePath } from "../../lib/link/client";
import {
  generateMachineKey,
  matchCode,
  signProof,
  verifyProof,
} from "../../lib/link/keys";
import { requestHeadersForLink } from "../../lib/link/protocol";
import { MACHINE_ID, rig } from "./link-rig";

test("keys: a proof verifies only for its own key and text", () => {
  const a = generateMachineKey();
  const b = generateMachineKey();
  const sig = signProof(a.privateKey, "text");
  assert.equal(verifyProof(a.publicKey, "text", sig), true);
  assert.equal(verifyProof(a.publicKey, "other", sig), false);
  assert.equal(verifyProof(b.publicKey, "text", sig), false);
  assert.equal(verifyProof("nope", "text", sig), false);
  assert.match(matchCode(a.publicKey), /^\d\d \d\d$/);
});

test("only this server's API and socket paths go down the link", () => {
  assert.equal(isForwardablePath("/api/sessions?x=1"), true);
  assert.equal(isForwardablePath("/ws/terminal"), true);
  assert.equal(isForwardablePath("/"), false);
  assert.equal(isForwardablePath("//evil/api/x"), false);
  assert.equal(isForwardablePath("/api//x"), false);
  assert.equal(isForwardablePath("http://x/api/y"), false);
  assert.equal(isForwardablePath("/proxy/3000/"), false);
});

test("the hub's cookies and credentials never go down the link", () => {
  const out = requestHeadersForLink({
    cookie: "agentos_session=abc",
    authorization: "Bearer t",
    "x-forwarded-for": "1.2.3.4",
    "x-agentos-link-user": "forged",
    "x-agentos-origin": "agent",
    "remote-user": "someone",
    accept: "application/json",
  });
  assert.deepEqual(out, {
    "x-agentos-origin": "agent",
    accept: "application/json",
  });
});

test("a machine nobody added is refused", async () => {
  const r = await rig();
  const c = r.client();
  c.start();
  const state = await r.until("refused");
  assert.match((state as { reason: string }).reason, /isn't linked/);
  assert.equal(r.deps.rows.size, 0);
  c.stop();
  await r.close();
});

test("a one-time code adds a machine once, and it waits for approval", async () => {
  const r = await rig();
  const { code } = r.hub.createPairingCode();
  const c = r.client(code);
  c.start();
  const pending = await r.until("pending");
  assert.equal((pending as { code: string }).code, matchCode(r.key.publicKey));
  assert.equal(r.hub.presence(MACHINE_ID), "waiting");

  // Not approved yet: nothing reaches it
  const early = await fetch(`http://127.0.0.1:${r.hubPort}/m/api/sessions`);
  assert.equal(early.status, 503);

  // The same code can't add a second machine
  const other = r.client(code, generateMachineKey());
  other.start();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(r.deps.rows.size, 1);
  other.stop();

  r.hub.approve(MACHINE_ID);
  const linked = await r.until("linked");
  assert.deepEqual(linked, {
    status: "linked",
    machineId: MACHINE_ID,
    hubSha: "hubsha",
  });
  assert.equal(r.hub.presence(MACHINE_ID), "online");
  c.stop();
  await r.close();
});

test("requests and sockets cross the link; removing the machine cuts it off", async () => {
  const r = await rig();
  const c = r.client(r.hub.createPairingCode().code);
  c.start();
  await r.until("pending");
  r.hub.approve(MACHINE_ID);
  await r.until("linked");
  const base = `http://127.0.0.1:${r.hubPort}`;

  // A user's POST: body crosses, hub cookies don't, the machine's own proof is added
  const post = await fetch(`${base}/m/api/sessions?x=1`, {
    method: "POST",
    headers: {
      cookie: "agentos_session=hub",
      "x-test-user": "1",
      "content-type": "text/plain",
    },
    body: "hello there",
  });
  assert.equal(post.status, 200);
  assert.equal(post.headers.get("set-cookie"), null);
  assert.deepEqual(await post.json(), {
    method: "POST",
    url: "/api/sessions?x=1",
    host: `127.0.0.1:${r.hubPort}`,
    cookie: "agentos_u=proof",
    agent: null,
    body: "hello there",
  });

  // An agent's call: marked as an agent, no proof cookie
  const agent = await fetch(`${base}/m/api/x`, {
    headers: { "x-agentos-origin": "agent" },
  });
  const body = (await agent.json()) as {
    cookie: string | null;
    agent: string | null;
  };
  assert.equal(body.cookie, null);
  assert.equal(body.agent, "agent");

  // Status codes pass through
  assert.equal((await fetch(`${base}/m/api/missing`)).status, 404);

  // A socket: both directions, text and binary
  const socket = new WebSocket(
    `ws://127.0.0.1:${r.hubPort}/ws/terminal?sessionId=1`
  );
  const got: (string | Buffer)[] = [];
  const next = () =>
    new Promise<void>((resolve) =>
      socket.once("message", (data, isBinary) => {
        got.push(isBinary ? (data as Buffer) : data.toString());
        resolve();
      })
    );
  // Sent before the far end is open: held, then delivered
  socket.on("open", () => socket.send("early"));
  await next();
  assert.equal(got[0], "hello /ws/terminal?sessionId=1 agentos_u=proof");
  await next();
  assert.equal(got[1], "early");
  socket.send(Buffer.from([1, 2, 3]));
  await next();
  assert.deepEqual(got[2], Buffer.from([1, 2, 3]));

  // Removed: the socket drops, requests say offline, and the machine stops
  const closed = new Promise<number>((resolve) => socket.on("close", resolve));
  assert.equal(r.hub.remove(MACHINE_ID), true);
  assert.equal(await closed, 1012);
  const state = await r.until("refused");
  assert.deepEqual(state, { status: "refused", reason: "removed" });
  assert.equal((await fetch(`${base}/m/api/sessions`)).status, 503);
  assert.equal(r.deps.rows.size, 0);
  c.stop();
  await r.close();
});

test("a machine that can't sign its key is refused", async () => {
  const r = await rig();
  const real = generateMachineKey();
  const c0 = r.client(r.hub.createPairingCode().code, real);
  c0.start();
  await r.until("pending");
  c0.stop();
  r.hub.approve(MACHINE_ID);
  // Same public key, someone else's private key
  const forged = {
    publicKey: real.publicKey,
    privateKey: generateMachineKey().privateKey,
  };
  r.states.length = 0;
  const c = r.client(undefined, forged);
  c.start();
  const state = await r.until("refused");
  assert.match((state as { reason: string }).reason, /signature/);
  assert.equal(r.hub.presence(MACHINE_ID), "offline");
  c.stop();
  await r.close();
});

test("a machine's notice is checked and clipped before the hub shows it", async () => {
  const { checkedNotice } = await import("../../lib/link/notices");
  const mac = { id: "m_0123456789ab", name: "Studio Mac" };
  const ok = checkedNotice(mac, {
    kind: "needsYou",
    title: "Needs you · api",
    body: "x".repeat(900),
    sessionId: "abc-123",
    agentId: "../../etc",
  });
  assert.ok(ok);
  assert.equal(ok.title, "Needs you · api · Studio Mac");
  assert.equal(ok.body.length, 300);
  assert.equal(ok.sessionId, "abc-123");
  assert.equal(ok.agentId, undefined);
  assert.equal(ok.machineId, mac.id);
  // Only the kinds a session can raise; never a made-up one or "test"
  assert.equal(
    checkedNotice(mac, { kind: "test", title: "t", body: "" }),
    null
  );
  assert.equal(
    checkedNotice(mac, { kind: "__proto__", title: "t", body: "" }),
    null
  );
  assert.equal(
    checkedNotice(mac, { kind: "finished", title: "", body: "b" }),
    null
  );
});

test("a machine learns and changes whether the hub's sessions may use it", async () => {
  const r = await rig();
  const c = r.client(r.hub.createPairingCode().code);
  const wait = async (want: boolean | null) => {
    for (let i = 0; i < 200 && c.agents !== want; i++) {
      await new Promise((done) => setTimeout(done, 10));
    }
    assert.equal(c.agents, want);
  };
  // Not linked: nothing to ask over
  assert.equal(c.setAgents(true), false);
  c.start();
  await r.until("pending");
  assert.equal(c.agents, null);
  r.hub.approve(MACHINE_ID);
  await r.until("linked");
  await wait(false);

  // From the machine
  assert.equal(c.setAgents(true), true);
  await wait(true);
  assert.equal(r.deps.rows.get(MACHINE_ID)!.agents, 1);

  // From the hub's Settings
  r.deps.setMachineAgents(MACHINE_ID, false);
  r.hub.tellAgents(MACHINE_ID);
  await wait(false);

  c.stop();
  await r.close();
});
