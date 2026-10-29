import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Sign-in on (fake provider; nothing is fetched), in its own process since
// lib/auth.ts caches its config
process.env.AGENT_OS_HOME = mkdtempSync(path.join(tmpdir(), "agentos-proof-"));
process.env.OIDC_ISSUER = "https://auth.invalid";
process.env.OIDC_CLIENT_ID = "agent-os";
process.env.OIDC_CLIENT_SECRET = "test";
process.env.AGENT_OS_PUBLIC_URL = "https://agent.example.com";
process.env.AUTH_SECRET = "x".repeat(32);

import {
  requireUser,
  userSecret,
  USER_PROOF_COOKIE,
} from "../../lib/user-proof";

test("requireUser: with sign-in on, the proof cookie alone isn't enough", () => {
  const req = new Request("http://agent.example.com/api/x", {
    method: "POST",
    headers: new Headers({
      host: "agent.example.com",
      origin: "https://agent.example.com",
      "sec-fetch-site": "same-origin",
      cookie: `${USER_PROOF_COOKIE}=${userSecret()}; agentos_session=forged.mac`,
    }),
  });
  assert.deepEqual(requireUser(req), { ok: false, reason: "no_session" });
});
