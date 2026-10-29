/**
 * Sign-in through an OpenID Connect provider (Authelia), enforced by
 * server.ts for every request and terminal connection.
 *
 * Off unless configured: with no OIDC settings AgentOS behaves as before
 * and relies on whatever sits in front of it. Settings come from the
 * environment or $AGENT_OS_HOME/auth.json (mode 600):
 *
 *   issuer        OIDC_ISSUER          https://auth.example.com
 *   clientId      OIDC_CLIENT_ID
 *   clientSecret  OIDC_CLIENT_SECRET
 *   publicUrl     AGENT_OS_PUBLIC_URL  https://agent.example.com
 *   sessionSecret AUTH_SECRET          32+ random bytes; changing it signs everyone out
 *   groups        OIDC_ALLOWED_GROUPS  comma-separated; empty allows any user
 *
 * The browser gets a signed session cookie. The iOS app signs in the same
 * way inside its web view.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";

const SESSION_COOKIE = "agentos_session";
const LOGIN_COOKIE = "agentos_login";
const SESSION_DAYS = 30;
const LOGIN_MINUTES = 10;

interface AuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  sessionSecret: string;
  groups: string[];
}

interface Session {
  sub: string;
  name: string;
  exp: number;
}

interface LoginState {
  state: string;
  verifier: string;
  nonce: string;
  returnTo: string;
  exp: number;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  issuer: string;
}

let cachedConfig: AuthConfig | null | undefined;

export function authConfig(): AuthConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const env = process.env;
  let file: Record<string, unknown> = {};
  const home = env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  try {
    file = JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8"));
  } catch {
    // No file: environment only
  }
  const pick = (envKey: string, fileKey: string) =>
    (env[envKey] ?? (file[fileKey] as string | undefined) ?? "").trim();

  const config = {
    issuer: pick("OIDC_ISSUER", "issuer").replace(/\/$/, ""),
    clientId: pick("OIDC_CLIENT_ID", "clientId"),
    clientSecret: pick("OIDC_CLIENT_SECRET", "clientSecret"),
    publicUrl: pick("AGENT_OS_PUBLIC_URL", "publicUrl").replace(/\/$/, ""),
    sessionSecret: pick("AUTH_SECRET", "sessionSecret"),
    groups: (env.OIDC_ALLOWED_GROUPS ??
      (Array.isArray(file.groups) ? file.groups.join(",") : "") ??
      "")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
  };
  const missing = (
    ["issuer", "clientId", "clientSecret", "publicUrl", "sessionSecret"] as const
  ).filter((k) => !config[k]);
  if (missing.length === 5) {
    cachedConfig = null;
  } else if (missing.length) {
    // Half-configured must not mean open
    throw new Error(`OIDC sign-in is missing: ${missing.join(", ")}`);
  } else if (config.sessionSecret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters");
  } else {
    cachedConfig = config;
  }
  if (cachedConfig) {
    console.log(`> Sign-in required via ${cachedConfig.issuer}`);
  }
  return cachedConfig;
}

// --- Signed values ---

const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url");

function sign(value: object, secret: string): string {
  const body = b64(JSON.stringify(value));
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify<T extends { exp: number }>(
  token: string | undefined,
  secret: string
): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return value.exp > Date.now() / 1000 ? value : null;
  } catch {
    return null;
  }
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

// --- Cookies ---

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function sessionCookie(config: AuthConfig, sub: string, name: string): string {
  const maxAge = SESSION_DAYS * 86400;
  const value = sign(
    { sub, name, exp: Math.floor(Date.now() / 1000) + maxAge },
    config.sessionSecret
  );
  return cookie(SESSION_COOKIE, value, maxAge);
}

// --- The gate ---

/** Paths reachable without signing in: the sign-in itself and static assets */
function isPublic(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next/static/") ||
    /^\/(favicon\.ico|icon[^/]*|apple-icon[^/]*|manifest\.webmanifest)$/.test(
      pathname
    )
  );
}

/**
 * Same-container callers (the MCP orchestration server, the CLI) reach the
 * server on loopback directly; anything through the reverse proxy doesn't.
 */
function isLocal(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? "";
  const loopback =
    address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  return (
    loopback &&
    !req.headers["x-forwarded-for"] &&
    !req.headers["x-forwarded-host"] &&
    !req.headers["x-real-ip"]
  );
}

export function currentSession(req: IncomingMessage): Session | null {
  const config = authConfig();
  if (!config) return null;
  return verify<Session>(readCookie(req, SESSION_COOKIE), config.sessionSecret);
}

export function isAllowed(req: IncomingMessage, pathname: string): boolean {
  if (!authConfig()) return true;
  return isPublic(pathname) || isLocal(req) || !!currentSession(req);
}

/** A cross-site page must not open a terminal with the user's cookie */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!authConfig() || !origin) return true;
  try {
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Answers a request that wasn't allowed: pages go to sign-in, the rest 401 */
export function deny(req: IncomingMessage, res: ServerResponse): void {
  const wantsPage =
    req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
  if (wantsPage) {
    const returnTo = encodeURIComponent(req.url ?? "/");
    res.writeHead(302, { Location: `/auth/login?return=${returnTo}` });
    res.end();
    return;
  }
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Sign-in required" }));
}

// --- Sign-in routes ---

let discovery: Promise<Discovery> | null = null;

function discover(config: AuthConfig): Promise<Discovery> {
  discovery ??= fetch(`${config.issuer}/.well-known/openid-configuration`)
    .then((r) => {
      if (!r.ok) throw new Error(`discovery ${r.status}`);
      return r.json() as Promise<Discovery>;
    })
    .catch((error) => {
      discovery = null;
      throw error;
    });
  return discovery;
}

/** Only paths on this site: never `//host` or `/\host` */
function safeReturn(value: string | null): string {
  return value && /^\/(?![/\\])/.test(value) ? value : "/";
}

function fail(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

/** Handles /auth/*; returns false for other paths */
export async function handleAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  const config = authConfig();
  if (!config || !url.pathname.startsWith("/auth/")) return false;

  try {
    switch (`${req.method} ${url.pathname}`) {
      case "GET /auth/login":
        await login(config, res, url);
        return true;
      case "GET /auth/callback":
        await callback(config, req, res, url);
        return true;
      case "GET /auth/logout":
      case "POST /auth/logout":
        res.writeHead(302, {
          "Set-Cookie": cookie(SESSION_COOKIE, "", 0),
          Location: "/auth/signed-out",
        });
        res.end();
        return true;
      case "GET /auth/signed-out":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          '<!doctype html><meta name="viewport" content="width=device-width">' +
            '<body style="font:16px system-ui;background:#0b0b0c;color:#e6e7ea;padding:24px">' +
            '<p>Signed out of AgentOS.</p><p><a style="color:#9ab" href="/">Sign in again</a></p>'
        );
        return true;
      default:
        fail(res, 404, "Not found");
        return true;
    }
  } catch (error) {
    console.error("[auth]", error);
    fail(res, 502, "Sign-in failed. Try again.");
    return true;
  }
}

async function login(config: AuthConfig, res: ServerResponse, url: URL) {
  const { authorization_endpoint } = await discover(config);
  const login: LoginState = {
    state: b64(randomBytes(24)),
    verifier: b64(randomBytes(48)),
    nonce: b64(randomBytes(24)),
    returnTo: safeReturn(url.searchParams.get("return")),
    exp: Math.floor(Date.now() / 1000) + LOGIN_MINUTES * 60,
  };
  const target = new URL(authorization_endpoint);
  target.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: `${config.publicUrl}/auth/callback`,
    scope: "openid profile email groups",
    state: login.state,
    nonce: login.nonce,
    code_challenge: sha256(login.verifier),
    code_challenge_method: "S256",
  }).toString();
  res.writeHead(302, {
    "Set-Cookie": cookie(
      LOGIN_COOKIE,
      sign(login, config.sessionSecret),
      LOGIN_MINUTES * 60
    ),
    Location: target.toString(),
    "Cache-Control": "no-store",
  });
  res.end();
}

async function callback(
  config: AuthConfig,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  const login = verify<LoginState>(
    readCookie(req, LOGIN_COOKIE),
    config.sessionSecret
  );
  const state = url.searchParams.get("state");
  if (!login || !state || state !== login.state) {
    fail(res, 400, "This sign-in expired. Open AgentOS again.");
    return;
  }
  const providerError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (providerError || !code) {
    fail(res, 403, `Sign-in was refused: ${providerError ?? "no code"}`);
    return;
  }

  const { token_endpoint, issuer } = await discover(config);
  const tokenRes = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(
        `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`
      ).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${config.publicUrl}/auth/callback`,
      code_verifier: login.verifier,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`token endpoint ${tokenRes.status}: ${await tokenRes.text()}`);
  }
  const { id_token } = (await tokenRes.json()) as { id_token?: string };

  // The ID token came straight from the provider's token endpoint over TLS,
  // which OIDC Core (3.1.3.7) accepts in place of checking its signature.
  // Its claims are still checked.
  const claims = JSON.parse(
    Buffer.from((id_token ?? "").split(".")[1] ?? "", "base64url").toString() ||
      "{}"
  ) as {
    iss?: string;
    aud?: string | string[];
    exp?: number;
    nonce?: string;
    sub?: string;
    name?: string;
    preferred_username?: string;
    groups?: string[];
  };
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== issuer ||
    !audience.includes(config.clientId) ||
    !claims.exp ||
    claims.exp < Date.now() / 1000 ||
    claims.nonce !== login.nonce ||
    !claims.sub
  ) {
    fail(res, 403, "The sign-in response didn't check out.");
    return;
  }
  if (
    config.groups.length &&
    !config.groups.some((g) => claims.groups?.includes(g))
  ) {
    fail(res, 403, "Your account isn't allowed to use AgentOS.");
    return;
  }

  const name = claims.name || claims.preferred_username || claims.sub;
  const clearLogin = cookie(LOGIN_COOKIE, "", 0);
  logSignIn(claims.sub);

  res.writeHead(302, {
    "Set-Cookie": [sessionCookie(config, claims.sub, name), clearLogin],
    Location: login.returnTo,
  });
  res.end();
}

/** One line per sign-in in $AGENT_OS_HOME/auth.log */
function logSignIn(sub: string) {
  const home = process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  const line = `${new Date().toISOString()} signed in ${sub}\n`;
  console.log(`[auth] ${line.trim()}`);
  try {
    fs.appendFileSync(path.join(home, "auth.log"), line);
  } catch {
    // Logging is best effort
  }
}
