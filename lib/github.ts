import { execSync } from "child_process";

// Cache the gh auth token for 5 minutes to avoid execSync on every request
let cachedToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 5 * 60 * 1000;

export function getGhToken(): string | null {
  const now = Date.now();
  if (cachedToken !== null && now - tokenFetchedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }
  try {
    cachedToken =
      execSync("gh auth token 2>/dev/null", { encoding: "utf-8" }).trim() ||
      null;
  } catch {
    cachedToken = null;
  }
  tokenFetchedAt = now;
  return cachedToken;
}

export function invalidateGhToken(): void {
  cachedToken = null;
  tokenFetchedAt = 0;
}

function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": "agent-os" };
  if (token) h["Authorization"] = `token ${token}`;
  return h;
}

/**
 * Authenticated fetch with automatic token refresh on 401/403.
 * Returns the Response object.
 */
export async function ghFetch(url: string): Promise<Response> {
  const token = getGhToken();
  const res = await fetch(url, { headers: authHeaders(token) });

  if ((res.status === 401 || res.status === 403) && token) {
    invalidateGhToken();
    const freshToken = getGhToken();
    if (freshToken && freshToken !== token) {
      return fetch(url, { headers: authHeaders(freshToken) });
    }
  }
  return res;
}

/**
 * Fetch a GitHub API URL and parse the JSON response.
 * Returns null on failure.
 */
export async function ghApiJson<T = unknown>(url: string): Promise<T | null> {
  try {
    const res = await ghFetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch raw text content from a GitHub URL.
 * Returns null on failure.
 */
export async function ghRawContent(url: string): Promise<string | null> {
  try {
    const res = await ghFetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
