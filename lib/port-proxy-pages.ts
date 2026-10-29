/**
 * The proxy's own answers: nothing listening, refused port, bad path, off.
 * Small static HTML (or plain text when the caller doesn't want HTML),
 * locked down with their own CSP plus the sandbox.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { SANDBOX_CSP } from "./port-proxy-headers";

export type ProxyProblem =
  | { kind: "not_listening"; port: number }
  | { kind: "timeout"; port: number }
  | { kind: "refused"; port: number }
  | { kind: "bad_path" }
  | { kind: "disabled" }
  | { kind: "sign_in"; port: number };

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );

interface Page {
  status: number;
  title: string;
  lines: string[];
  refresh?: boolean;
}

function describe(problem: ProxyProblem): Page {
  switch (problem.kind) {
    case "not_listening":
      return {
        status: 502,
        title: `Nothing is listening on port ${problem.port}`,
        lines: [
          "Start the app; it will load here automatically.",
          "Behind a sign-in front door (Authelia), a page whose scripts or styles fail to load needs subdomain mode (AGENTOS_PROXY_DOMAIN).",
        ],
        refresh: true,
      };
    case "timeout":
      return {
        status: 504,
        title: `Port ${problem.port} didn't answer`,
        lines: ["The app accepted no connection within 10 seconds."],
        refresh: true,
      };
    case "refused":
      return {
        status: 403,
        title: `Port ${problem.port} can't be proxied`,
        lines: ["It is Agent-OS itself, or on the deny list."],
      };
    case "bad_path":
      return {
        status: 400,
        title: "Not a proxy address",
        lines: ["Use /proxy/<port>/ with a port from 1 to 65535."],
      };
    case "disabled":
      return {
        status: 404,
        title: "The port proxy is off",
        lines: ["Turn it on in Labs, or unset AGENTOS_PROXY=0."],
      };
    case "sign_in":
      return {
        status: 401,
        title: "Sign-in required",
        lines: [
          `Port ${problem.port} is behind Agent-OS sign-in, which doesn't reach port hosts. Use /proxy/${problem.port}/ on Agent-OS's own address, or put the port hosts behind your front door's sign-in.`,
        ],
      };
  }
}

function wantsHtml(req: IncomingMessage): boolean {
  return (
    req.method === "GET" && (req.headers.accept ?? "").includes("text/html")
  );
}

/** Writes the page for a problem and ends the response */
export function sendProxyProblem(
  req: IncomingMessage,
  res: ServerResponse,
  problem: ProxyProblem
): void {
  const page = describe(problem);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const headers: Record<string, string | string[]> = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'; style-src 'unsafe-inline'",
      SANDBOX_CSP,
    ],
    "X-Content-Type-Options": "nosniff",
  };
  if (!wantsHtml(req)) {
    res.writeHead(page.status, {
      ...headers,
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(`${page.title}\n${page.lines.join("\n")}\n`);
    return;
  }
  const refresh = page.refresh ? '<meta http-equiv="refresh" content="3">' : "";
  const body = page.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("");
  res.writeHead(page.status, {
    ...headers,
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>${escapeHtml(page.title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:48px 16px;background:#111;color:#ddd}main{max-width:560px;margin:0 auto}h1{font-size:20px;font-weight:600;color:#fff}p{color:#aaa}@media (prefers-color-scheme:light){body{background:#fafafa;color:#222}h1{color:#000}p{color:#555}}</style></head><body><main><h1>${escapeHtml(page.title)}</h1>${body}</main></body></html>`
  );
}
