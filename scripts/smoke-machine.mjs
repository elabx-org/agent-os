#!/usr/bin/env node
/**
 * End-to-end test of linking a Mac, as the user does it (the macOS CI job):
 * a hub AgentOS from this checkout, then the real installer
 * (scripts/link-machine.sh) with the command the hub hands out, approval,
 * a request through the link, off, on, and remove.
 *
 *   node scripts/smoke-machine.mjs [artifacts dir]
 *
 * Needs `npm run build` first and this commit on GitHub (the installer
 * downloads the hub's version from there). It installs a real login item
 * and a Keychain entry and removes them again, so it only runs on CI or
 * with SMOKE_MACHINE_OK=1. The sign-in step is tested apart (it needs the
 * sign-in service); here the hub has none.
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

if (!process.env.CI && process.env.SMOKE_MACHINE_OK !== "1") {
  console.error("smoke-machine: CI only (it installs a login item); set SMOKE_MACHINE_OK=1 to run anyway");
  process.exit(2);
}

const run = promisify(execFile);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentos-machine-")));
const ARTIFACTS = path.resolve(process.argv[2] || ROOT);
fs.mkdirSync(ARTIFACTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let failed = 0;
function ok(name, pass, detail = "") {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
}

const HUB_PORT = await freePort();
const MAC_PORT = await freePort();
// The hub won't hand out a command for a loopback address (a Mac couldn't
// reach it), so it is opened at this machine's network address
const LAN = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
if (!LAN) {
  console.error("smoke-machine: no network address");
  process.exit(2);
}
const HUB = `http://${LAN}:${HUB_PORT}`;
const HUB_HOME = path.join(ROOT, "hub");
const MAC_HOME = path.join(ROOT, "machine");
fs.mkdirSync(HUB_HOME, { recursive: true });
if ([HUB_PORT, MAC_PORT].includes(3011)) process.exit(2);

const hubEnv = { ...process.env };
for (const key of ["TMUX", "TMUX_PANE", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "AUTH_SECRET", "GH_TOKEN", "GITHUB_TOKEN"]) {
  delete hubEnv[key];
}
Object.assign(hubEnv, {
  PORT: String(HUB_PORT),
  DB_PATH: path.join(HUB_HOME, "agent-os.db"),
  AGENT_OS_HOME: HUB_HOME,
  TMUX_TMPDIR: HUB_HOME,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  AGENTOS_DISABLE_PUSH: "1",
  AGENTOS_MCP_REGISTER: "0",
});
const hubLog = fs.createWriteStream(path.join(ARTIFACTS, "hub.log"));
const hub = spawn(path.join(APP, "node_modules/.bin/tsx"), ["server.ts"], { cwd: APP, env: hubEnv });
hub.stdout.pipe(hubLog);
hub.stderr.pipe(hubLog);

// What the user's browser sends on plain http: a navigation, then same-site calls
let cookie = "";
async function call(pathname, { method = "GET", body, user = true } = {}) {
  const headers = { origin: HUB };
  if (user && cookie) headers.cookie = cookie;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(HUB + pathname, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

const machineSh = path.join(MAC_HOME, "repo/scripts/agentos-machine.sh");
const macEnv = { ...process.env, AGENT_OS_HOME: MAC_HOME, AGENT_OS_PORT: String(MAC_PORT), AGENTOS_MACHINE_NAME: "CI Mac" };
const link = (...args) =>
  run("/bin/bash", [machineSh, ...args], { env: macEnv }).then(
    (r) => ({ code: 0, out: r.stdout + r.stderr }),
    (e) => ({ code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` })
  );

async function until(what, fn, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await sleep(1000);
  }
  ok(what, false, "timed out");
  return null;
}

try {
  await until("hub starts", async () => (await fetch(HUB + "/api/build")).ok, 90_000);
  const nav = await fetch(HUB + "/api/user-proof", {
    headers: { "upgrade-insecure-requests": "1", accept: "text/html" },
  });
  cookie = (nav.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  ok("the hub hands the browser its user proof", /agentos_u=/.test(cookie));

  const off = await call("/api/machines");
  ok("linked machines are off until switched on", off.json?.enabled === false);
  const flag = await call("/api/preferences", { method: "PUT", body: { key: "flags", value: { machines: true } } });
  ok("the user switches linked machines on", flag.status === 200, String(flag.status));
  await until("flag takes effect", async () => (await call("/api/machines")).json?.enabled === true, 20_000);

  const stranger = await call("/api/machines/pair", { method: "POST", user: false });
  ok("only the user can add a machine", stranger.status === 403, String(stranger.status));
  const pair = await call("/api/machines/pair", { method: "POST" });
  const command = pair.json?.command ?? "";
  ok("the hub hands out the one-line command", / \| bash -s -- [\w-]+$/.test(command), command.slice(0, 90));
  const invite = command.split(" -- ")[1];
  const sha = JSON.parse(Buffer.from(invite, "base64url").toString()).sha;
  ok("the command names the hub's version", /^[0-9a-f]{40}$/.test(sha ?? ""), String(sha));

  // The installer exactly as the user runs it, but from this checkout's copy
  const installLog = fs.createWriteStream(path.join(ARTIFACTS, "install.log"));
  let installOut = "";
  const install = spawn("/bin/bash", [path.join(APP, "scripts/link-machine.sh"), invite], { env: macEnv });
  for (const stream of [install.stdout, install.stderr]) {
    stream.on("data", (d) => {
      installOut += d;
      installLog.write(d);
      process.stdout.write(String(d).replace(/^/gm, "    | "));
    });
  }
  const installed = new Promise((resolve) => install.on("close", resolve));

  const pending = await until(
    "the machine shows up waiting for approval",
    async () => (await call("/api/machines")).json?.machines?.find((m) => m.status === "pending"),
    20 * 60_000
  );
  if (pending) {
    ok("it waits for approval, not yet reachable", pending.presence === "waiting", pending.presence);
    ok("the code on the Mac matches the one in AgentOS", installOut.includes(pending.code), pending.code);
    ok("named after the Mac", pending.name === "CI Mac", pending.name);
    const before = await call(`/m/${pending.id}/api/build`);
    ok("nothing goes to it before approval", before.status !== 200, String(before.status));
    const approve = await call(`/api/machines/${pending.id}`, { method: "PATCH", body: { approve: true } });
    ok("the user approves it", approve.status === 200, String(approve.status));
    const code = await Promise.race([installed, sleep(120_000).then(() => "timeout")]);
    ok("the installer finishes by itself", code === 0 && /Done\./.test(installOut), String(code));

    const id = pending.id;
    const through = await until("a request reaches the Mac through the hub", async () => {
      const r = await call(`/m/${id}/api/build`);
      return r.status === 200 ? r : null;
    });
    ok("a request reaches the Mac through the hub", !!through, through?.text.slice(0, 80));
    const row = (await call("/api/machines")).json.machines.find((m) => m.id === id);
    ok("connected, on the hub's version", row.presence === "online" && row.sameVersion === true, JSON.stringify(row));

    const direct = await fetch(`http://127.0.0.1:${MAC_PORT}/api/build`).then((r) => r.status);
    ok("the Mac's copy answers on this Mac only", direct === 200, String(direct));
    const outside = await fetch(`http://${LAN}:${MAC_PORT}/api/build`, { signal: AbortSignal.timeout(4000) }).then(
      (r) => `answered ${r.status}`,
      () => "refused"
    );
    ok("nothing listens on the network", outside === "refused", `${LAN}: ${outside}`);
    const keychain = await run("/usr/bin/security", ["find-generic-password", "-s", "agentos-link"]).then(() => true, () => false);
    ok("the key is in the Keychain, not in a file", keychain && !fs.existsSync(path.join(MAC_HOME, "link.key")));
    const saved = fs.readFileSync(path.join(MAC_HOME, "link.json"), "utf8");
    ok("the one-time code isn't kept", !/"code"/.test(saved));

    const status = await link("status");
    ok("status says linked", status.out.startsWith(`Linked to ${LAN}`), status.out.trim());

    const offResult = await link("off");
    ok("off: one command", offResult.code === 0, offResult.out.trim());
    const gone = await until("off: the hub can't reach it", async () => (await call(`/m/${id}/api/build`)).status === 503, 30_000);
    ok("off: the hub can't reach it", !!gone);
    const closed = await fetch(`http://127.0.0.1:${MAC_PORT}/api/build`).then(() => false, () => true);
    ok("off: nothing runs on the Mac", closed);

    const onResult = await link("on");
    ok("on: one command", onResult.code === 0, onResult.out.trim());
    const back = await until("on: reachable again without approving again", async () => (await call(`/m/${id}/api/build`)).status === 200, 90_000);
    ok("on: reachable again without approving again", !!back);

    const removed = await call(`/api/machines/${id}`, { method: "DELETE" });
    ok("the user removes it in AgentOS", removed.status === 200, String(removed.status));
    const refused = await until("removed: the Mac is told and stops trying", async () => /removed/.test((await link("status")).out), 30_000);
    ok("removed: the Mac is told and stops trying", !!refused);
    ok("removed: the hub no longer knows it", (await call(`/m/${id}/api/build`)).status !== 200);

    const cleanup = await link("remove");
    ok("remove on the Mac", cleanup.code === 0, cleanup.out.trim());
    const keyLeft = await run("/usr/bin/security", ["find-generic-password", "-s", "agentos-link"]).then(() => true, () => false);
    ok("remove: key gone from the Keychain", !keyLeft);
    ok("remove: login item gone", !fs.existsSync(path.join(os.homedir(), "Library/LaunchAgents/com.agentos.machine.plist")));
  } else {
    install.kill();
  }
} catch (error) {
  ok("ran to the end", false, error.stack);
} finally {
  await link("remove").catch(() => {});
  hub.kill();
  for (const file of ["logs/machine.log", "logs/update.log", "install.log", "link-state.json"]) {
    try {
      fs.copyFileSync(path.join(MAC_HOME, file), path.join(ARTIFACTS, `machine-${path.basename(file)}`));
    } catch {}
  }
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
