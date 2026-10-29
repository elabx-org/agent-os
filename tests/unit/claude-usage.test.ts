import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUsageClient } from "../../lib/claude-usage";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-usage-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function setup(options: { creds?: object | null } = {}) {
  const dir = path.join(tmp, String(n++));
  fs.mkdirSync(dir);
  const credentialsPath = path.join(dir, "credentials.json");
  const cacheFile = path.join(dir, "usage-cache.json");
  if (options.creds !== null) {
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify(
        options.creds ?? {
          claudeAiOauth: {
            accessToken: "tok-a",
            refreshToken: "ref-a",
            rateLimitTier: "default_claude_max_5x",
          },
        }
      )
    );
  }
  const clock = { t: 1_000_000 };
  const calls: { url: string; auth?: string }[] = [];
  const replies: (() => Response)[] = [];
  const fetchStub = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), auth: headers.Authorization });
    const next = replies.shift();
    if (!next) throw new Error("unexpected request");
    return next();
  }) as typeof fetch;
  const client = createUsageClient({
    fetch: fetchStub,
    credentialsPath,
    cacheFile,
    now: () => clock.t,
  });
  return { client, clock, calls, replies, cacheFile, credentialsPath };
}

const body = {
  five_hour: { utilization: 42, resets_at: "2026-10-29T15:40:00Z" },
  seven_day: { utilization: 61, resets_at: "2026-11-02T18:00:00Z" },
};
const ok = () => Response.json(body);
const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response("{}", { status: code, headers });

test("getClaudeUsage: maps the answer, the plan and the defaults", async () => {
  const { client, replies, calls } = setup();
  replies.push(ok);
  const result = await client.get();
  assert.equal(result.status, 200);
  assert.ok("data" in result);
  assert.equal(result.data.plan, "Max 5x");
  assert.equal(result.data.five_hour.utilization, 42);
  assert.equal(result.data.seven_day_opus, null);
  assert.equal(result.data.extra_usage.is_enabled, false);
  assert.equal(result.data.stale, undefined);
  assert.equal(calls[0].auth, "Bearer tok-a");
});

test("getClaudeUsage: serves the cache within 60s, then asks again", async () => {
  const { client, replies, calls, clock } = setup();
  replies.push(ok, ok);
  await client.get();
  clock.t += 59_000;
  assert.equal((await client.get()).status, 200);
  assert.equal(calls.length, 1);
  clock.t += 2_000;
  await client.get();
  assert.equal(calls.length, 2);
});

test("getClaudeUsage: concurrent calls share one request", async () => {
  const { client, replies, calls } = setup();
  replies.push(ok);
  const [a, b] = await Promise.all([client.get(), client.get()]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(calls.length, 1);
});

test("getClaudeUsage: a 429 backs off and serves the last good, stale", async () => {
  const { client, replies, calls, clock } = setup();
  replies.push(ok, status(429, { "retry-after": "120" }));
  await client.get();
  clock.t += 61_000;
  const limited = await client.get();
  assert.ok("data" in limited);
  assert.equal(limited.data.stale, true);
  assert.equal(calls.length, 2);
  // Within Retry-After: no request
  clock.t += 100_000;
  const again = await client.get();
  assert.ok("data" in again && again.data.stale);
  assert.equal(calls.length, 2);
  // After it: asks
  replies.push(ok);
  clock.t += 30_000;
  const fresh = await client.get();
  assert.ok("data" in fresh && !fresh.data.stale);
  assert.equal(calls.length, 3);
});

test("getClaudeUsage: a 429 with nothing cached is the error", async () => {
  const { client, replies } = setup();
  replies.push(status(429));
  assert.deepEqual(await client.get(), {
    status: 429,
    error: "Anthropic API error: 429",
  });
});

test("getClaudeUsage: an error isn't retried within 60s", async () => {
  const { client, replies, calls, clock } = setup();
  replies.push(status(500));
  assert.deepEqual(await client.get(), {
    status: 500,
    error: "Anthropic API error: 500",
  });
  clock.t += 30_000;
  assert.equal((await client.get()).status, 500);
  assert.equal(calls.length, 1);
  replies.push(() => {
    throw new Error("network down");
  });
  clock.t += 31_000;
  assert.deepEqual(await client.get(), {
    status: 502,
    error: "Usage request failed",
  });
  assert.equal(calls.length, 2);
});

test("getClaudeUsage: a 401 refreshes the token and saves it", async () => {
  const { client, replies, calls, credentialsPath } = setup();
  replies.push(
    status(401),
    () => Response.json({ access_token: "tok-b", refresh_token: "ref-b" }),
    ok
  );
  assert.equal((await client.get()).status, 200);
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /oauth\/token/);
  assert.equal(calls[2].auth, "Bearer tok-b");
  const saved = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  assert.equal(saved.claudeAiOauth.accessToken, "tok-b");
  assert.equal(saved.claudeAiOauth.refreshToken, "ref-b");
});

test("getClaudeUsage: no credentials is a 404 without a request", async () => {
  const { client, calls } = setup({ creds: null });
  assert.deepEqual(await client.get(), {
    status: 404,
    error: "No Claude credentials found",
  });
  assert.equal(calls.length, 0);
});

test("the cache file survives a restart; cachedClaudeUsage reads it", async () => {
  const first = setup();
  first.replies.push(ok);
  assert.equal(first.client.cached(), null);
  await first.client.get();
  assert.equal(first.client.cached()?.five_hour.utilization, 42);
  const stored = JSON.parse(fs.readFileSync(first.cacheFile, "utf8"));
  assert.equal(stored.timestamp, first.clock.t);

  // A new client (a restart) on the same file, within the minute
  const second = createUsageClient({
    fetch: (() => {
      throw new Error("should not ask");
    }) as unknown as typeof fetch,
    credentialsPath: first.credentialsPath,
    cacheFile: first.cacheFile,
    now: () => first.clock.t + 10_000,
  });
  assert.equal(second.cached()?.plan, "Max 5x");
  const result = await second.get();
  assert.ok("data" in result && !result.data.stale);
});

test("stale figures older than an hour are not served", async () => {
  const { client, replies, clock } = setup();
  replies.push(ok, status(503));
  await client.get();
  clock.t += 61 * 60_000;
  assert.deepEqual(await client.get(), {
    status: 503,
    error: "Anthropic API error: 503",
  });
  // The detector still sees the last figures
  assert.equal(client.cached()?.plan, "Max 5x");
});
