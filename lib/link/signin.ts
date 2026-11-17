/**
 * Signing in to what stands in front of the hub (e.g. Authelia), so the
 * link's dial-out gets through it. The user signs in once in a browser on
 * the machine (authorization code + PKCE, pushed request, answer posted
 * to a loopback address); the tokens are kept with the machine's key and
 * renewed here. The access token is only good for the hub's address.
 */

import { createHash, randomBytes } from "crypto";
import http from "http";
import { deleteSecret, readSecret, writeSecret } from "./secrets";

export interface SignInConfig {
  /** OpenID Connect issuer, e.g. https://auth.example.com */
  issuer: string;
  clientId: string;
}

interface Tokens {
  access: string;
  refresh: string | null;
  /** Epoch ms after which the access token is no good */
  expiresAt: number;
}

/** The loopback address the sign-in posts its answer to (registered with the provider) */
export const CALLBACK_PORT = 47823;
export const CALLBACK_URL = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const SCOPE = "offline_access authelia.bearer.authz";
const SIGN_IN_WAIT_MS = 10 * 60_000;

/** The stored sign-in is gone or no longer accepted: the user must sign in again */
export class SignInNeeded extends Error {
  constructor(message = "Sign-in needed") {
    super(message);
    this.name = "SignInNeeded";
  }
}

const account = (hubUrl: string) => `signin:${new URL(hubUrl).host}`;

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  pushed_authorization_request_endpoint?: string;
}

async function discover(issuer: string): Promise<Discovery> {
  const base = issuer.replace(/\/+$/, "");
  const response = await fetch(`${base}/.well-known/openid-configuration`);
  if (!response.ok)
    throw new Error(`sign-in service answered ${response.status}`);
  return (await response.json()) as Discovery;
}

async function form(
  url: string,
  fields: Record<string, string>
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { ok: response.ok, status: response.status, body };
}

function tokensFrom(body: Record<string, unknown>, previous?: Tokens): Tokens {
  if (typeof body.access_token !== "string") {
    throw new Error("sign-in service sent no access token");
  }
  const seconds = typeof body.expires_in === "number" ? body.expires_in : 300;
  return {
    access: body.access_token,
    refresh:
      typeof body.refresh_token === "string"
        ? body.refresh_token
        : (previous?.refresh ?? null),
    expiresAt: Date.now() + seconds * 1000,
  };
}

export interface PendingSignIn {
  /** Open this in a browser on the machine */
  url: string;
  state: string;
  /** Call with what the browser posted to the callback */
  finish(code: string, state: string): Promise<void>;
}

/** Starts a sign-in: a pushed request, and the page to open for it */
export async function beginSignIn(
  hubUrl: string,
  config: SignInConfig
): Promise<PendingSignIn> {
  const found = await discover(config.issuer);
  if (!found.pushed_authorization_request_endpoint) {
    throw new Error("the sign-in service doesn't support this kind of sign-in");
  }
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const pushed = await form(found.pushed_authorization_request_endpoint, {
    client_id: config.clientId,
    response_type: "code",
    response_mode: "form_post",
    redirect_uri: CALLBACK_URL,
    scope: SCOPE,
    // The token is only good for the hub
    audience: new URL(hubUrl).origin,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  if (!pushed.ok || typeof pushed.body.request_uri !== "string") {
    throw new Error(
      `the sign-in service refused the request (${pushed.status} ${String(pushed.body.error ?? "")})`
    );
  }
  const url = new URL(found.authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("request_uri", pushed.body.request_uri);
  return {
    url: url.toString(),
    state,
    async finish(code, answeredState) {
      if (answeredState !== state)
        throw new Error("sign-in answer didn't match");
      const token = await form(found.token_endpoint, {
        grant_type: "authorization_code",
        client_id: config.clientId,
        code,
        redirect_uri: CALLBACK_URL,
        code_verifier: verifier,
      });
      if (!token.ok) {
        throw new Error(
          `sign-in wasn't accepted (${token.status} ${String(token.body.error ?? "")})`
        );
      }
      writeSecret(account(hubUrl), JSON.stringify(tokensFrom(token.body)));
    },
  };
}

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AgentOS</title><body style="font:16px -apple-system,system-ui,sans-serif;background:#0b0c0f;color:#eceef2;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;padding:24px"><h1 style="font-size:22px;margin:0 0 8px">${title}</h1><p style="opacity:.7;margin:0">${text}</p></div>`;

/**
 * The whole sign-in on the machine: opens the browser, waits for the
 * answer on loopback, stores the tokens. `open` shows the page (or prints
 * its address when there's no browser to open).
 */
export async function interactiveSignIn(
  hubUrl: string,
  config: SignInConfig,
  open: (url: string) => void
): Promise<void> {
  const pending = await beginSignIn(hubUrl, config);
  await new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || !req.url?.startsWith("/callback")) {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16_384) req.destroy();
        else chunks.push(chunk);
      });
      req.on("end", () => {
        const answer = new URLSearchParams(Buffer.concat(chunks).toString());
        const done = (error?: Error) => {
          res.writeHead(error ? 400 : 200, {
            "content-type": "text/html; charset=utf-8",
          });
          res.end(
            error
              ? page(
                  "Sign-in didn't finish",
                  "Go back to the terminal and try again."
                )
              : page(
                  "Signed in",
                  "You can close this tab and go back to the terminal."
                )
          );
          clearTimeout(timer);
          server.close();
          if (error) reject(error);
          else resolve();
        };
        const code = answer.get("code");
        if (!code) {
          return done(
            new Error(
              answer.get("error_description") ?? "sign-in was cancelled"
            )
          );
        }
        pending.finish(code, answer.get("state") ?? "").then(
          () => done(),
          (error: Error) => done(error)
        );
      });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("nobody signed in within ten minutes"));
    }, SIGN_IN_WAIT_MS);
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(CALLBACK_PORT, "127.0.0.1", () => open(pending.url));
  });
}

function stored(hubUrl: string): Tokens | null {
  try {
    const value = JSON.parse(readSecret(account(hubUrl)) ?? "") as Tokens;
    return typeof value.access === "string" ? value : null;
  } catch {
    return null;
  }
}

export const hasSignIn = (hubUrl: string) => stored(hubUrl) !== null;

export function forgetSignIn(hubUrl: string): void {
  deleteSecret(account(hubUrl));
}

let renewing: Promise<Tokens> | null = null;

async function renew(
  hubUrl: string,
  config: SignInConfig,
  tokens: Tokens
): Promise<Tokens> {
  if (!tokens.refresh) throw new SignInNeeded();
  const found = await discover(config.issuer);
  const answer = await form(found.token_endpoint, {
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: tokens.refresh,
  });
  if (!answer.ok) {
    // 4xx: the renewal itself was turned down (expired, revoked)
    if (answer.status >= 400 && answer.status < 500) {
      forgetSignIn(hubUrl);
      throw new SignInNeeded();
    }
    throw new Error(`sign-in service answered ${answer.status}`);
  }
  const next = tokensFrom(answer.body, tokens);
  writeSecret(account(hubUrl), JSON.stringify(next));
  return next;
}

/** The header that gets the link's dial-out through the sign-in */
export async function signInHeaders(
  hubUrl: string,
  config: SignInConfig
): Promise<Record<string, string>> {
  let tokens = stored(hubUrl);
  if (!tokens) throw new SignInNeeded();
  if (tokens.expiresAt - Date.now() < 60_000) {
    // One renewal at a time: a used renewal token can't be used again
    renewing ??= renew(hubUrl, config, tokens).finally(() => {
      renewing = null;
    });
    tokens = await renewing;
  }
  return { authorization: `Bearer ${tokens.access}` };
}
