/**
 * The link between a hub (the AgentOS you open) and a linked machine
 * (another AgentOS, e.g. on a Mac, that dials out to the hub). One
 * WebSocket carries everything: JSON text frames for control, binary
 * frames for bodies. The hub sends HTTP requests and WebSocket opens down
 * the link; the machine answers them from its own loopback server.
 *
 * Handshake: machine "hello" -> hub "challenge" -> machine "proof" -> hub
 * "welcome" (approved, or pending until the user approves it in Settings).
 */

export const LINK_PATH = "/api/link/connect";
export const LINK_VERSION = 1;

/** What a signature covers: the hub the machine meant, and the hub's nonce */
export function proofText(hubHost: string, nonce: string): string {
  return `agentos-link-v${LINK_VERSION}\n${hubHost.toLowerCase()}\n${nonce}`;
}

export type Headers = Record<string, string | string[] | undefined>;

export type MachineFrame =
  | {
      t: "hello";
      v: number;
      key: string;
      name: string;
      platform: string;
      sha: string | null;
      hubHost: string;
      /** One-time code from Settings -> Machines; only needed the first time */
      code?: string;
    }
  | { t: "proof"; sig: string }
  | { t: "res"; id: number; status: number; headers: Headers }
  | { t: "res-end"; id: number }
  | { t: "res-error"; id: number; message: string }
  | { t: "ws-open"; id: number }
  | { t: "ws-msg"; id: number; data: string }
  | { t: "ws-close"; id: number; code?: number }
  | { t: "pong" }
  /** Something the user should hear about (a session needs them, finished) */
  | {
      t: "notify";
      kind: string;
      title: string;
      body: string;
      sessionId?: string;
      agentId?: string;
      projectName?: string;
    };

export type LinkNotice = Omit<Extract<MachineFrame, { t: "notify" }>, "t">;

export type HubFrame =
  | { t: "challenge"; nonce: string }
  | {
      t: "welcome";
      machineId: string;
      status: "approved" | "pending";
      /** The hub's commit, so the machine can match its own copy to it */
      sha: string | null;
      /** Shown on both sides while pending, to match by eye */
      code: string;
    }
  | { t: "refused"; reason: string }
  | {
      t: "req";
      id: number;
      method: string;
      path: string;
      headers: Headers;
      /** The hub checked this came from the user's own browser */
      user: boolean;
    }
  | { t: "req-end"; id: number }
  | { t: "abort"; id: number }
  | { t: "ws"; id: number; path: string; headers: Headers; user: boolean }
  | { t: "ws-msg"; id: number; data: string }
  | { t: "ws-close"; id: number; code?: number }
  | { t: "ping" };

/** Binary frame kinds: a body chunk of a request/response, a binary socket message */
export const BIN_BODY = 1;
export const BIN_WS = 2;

export function encodeBinary(id: number, kind: number, data: Buffer): Buffer {
  const head = Buffer.allocUnsafe(5);
  head.writeUInt32BE(id >>> 0, 0);
  head.writeUInt8(kind, 4);
  return Buffer.concat([head, data]);
}

export function decodeBinary(
  frame: Buffer
): { id: number; kind: number; data: Buffer } | null {
  if (frame.length < 5) return null;
  return {
    id: frame.readUInt32BE(0),
    kind: frame.readUInt8(4),
    data: frame.subarray(5),
  };
}

export function parseFrame<T extends { t: string }>(text: string): T | null {
  try {
    const value = JSON.parse(text) as T;
    return value && typeof value.t === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Headers that describe one hop, never forwarded */
const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Request headers the hub sends down the link. The hub's own cookies and
 * credentials stay on the hub; forwarding headers are dropped so the
 * machine's server sees a plain loopback call; nothing a browser sends
 * can pose as the link (x-agentos-link*).
 */
export function requestHeadersForLink(headers: Headers): Headers {
  const out: Headers = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (value === undefined || HOP.has(key)) continue;
    if (key === "cookie" || key === "authorization" || key === "host") continue;
    if (key.startsWith("x-forwarded-") || key === "x-real-ip") continue;
    if (key.startsWith("x-agentos-link") || key === "x-agentos-machine")
      continue;
    if (key.startsWith("sec-websocket-")) continue;
    if (key.startsWith("remote-")) continue;
    out[key] = value;
  }
  return out;
}

/** Response headers the hub passes back to the browser: no cookies, no hop headers */
export function responseHeadersFromLink(headers: Headers): Headers {
  const out: Headers = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (value === undefined || HOP.has(key) || key === "set-cookie") continue;
    out[key] = value;
  }
  return out;
}
