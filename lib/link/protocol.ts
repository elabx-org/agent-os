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

/**
 * Abilities named in hello and welcome. LINK_VERSION stays 1 so older
 * peers still connect; a side sends nothing new unless the other named it.
 */
/** Can send and answer upward requests (a machine asking the hub) */
export const CAP_UP = "up1";
/** Honours "taken": pauses a session the hub continued from its copy */
export const CAP_TAKE = "take1";
/** On a call the link itself vouches for (lib/link/up-guard.ts) */
export const LINK_PROOF_HEADER = "x-agentos-link-proof";
export const LINK_MACHINE_HEADER = "x-agentos-link-machine";
/** Who a machine's inbox hears from: its hub */
export const HUB_PEER = "hub";
/** Takes copies of its hub's sessions (lib/backup/hub-send.ts) */
export const CAP_PEER = "peer1";
/** Runs jobs its hub's chats hand it (lib/jobs) */
export const CAP_JOBS = "jobs1";

/** agent: a session's tool call; system: AgentOS itself (copies) */
export type UpKind = "agent" | "system";

/** Largest BIN_UP payload */
export const UP_CHUNK = 64 * 1024;
/** Request-body bytes a machine may have unacknowledged per request */
export const UP_WINDOW = 1024 * 1024;
/** Up bodies wait while the socket holds more than this unsent */
export const UP_SOCKET_HIGH = 256 * 1024;
/** Largest answer body to an upward request */
export const UP_ANSWER_MAX = 16 * 1024 * 1024;
/** Largest frame either side accepts */
export const LINK_MAX_FRAME = 16 * 1024 * 1024;

/** What the hub lets this machine ask of it, and the names to show */
export interface UpAllowed {
  agents: boolean;
  backup: boolean;
  name: string;
  hubName: string | null;
}

/**
 * A session the hub continued from this machine's copy (lib/backup): the
 * machine must pause its own and say what it did since
 */
export interface TakenSession {
  sessionId: string;
  /** 16 hex; also the move id on the hub */
  takeId: string;
  at: number;
  /** When the copy it continued from was made */
  copyAt: number;
  hubName: string;
  claudeSessionId: string;
  transcriptBytes: number;
  head: string | null;
  tree: string | null;
}

export interface TakenResult {
  sessionId: string;
  takeId: string;
  state: "paused" | "already" | "gone" | "failed";
  /** What the machine did after the copy */
  ahead?: { conversation: boolean; code: boolean };
  /** Where that work is; shown as text only */
  folder?: string;
}

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
      /** What this machine can do (CAP_UP, ...); absent on older machines */
      caps?: string[];
    }
  | { t: "proof"; sig: string }
  | { t: "res"; id: number; status: number; headers: Headers }
  | { t: "res-end"; id: number }
  | { t: "res-error"; id: number; message: string }
  | { t: "ws-open"; id: number }
  | { t: "ws-msg"; id: number; data: string }
  | { t: "ws-close"; id: number; code?: number }
  | { t: "pong" }
  /** The machine's owner, from the machine itself: may the hub's sessions use it */
  | { t: "agents"; allowed: boolean }
  /** Something the user should hear about (a session needs them, finished) */
  | {
      t: "notify";
      kind: string;
      title: string;
      body: string;
      sessionId?: string;
      agentId?: string;
      projectName?: string;
    }
  /** The machine asks the hub (ids are its own, from 1 per connection) */
  | {
      t: "up";
      id: number;
      kind: UpKind;
      method: string;
      path: string;
      headers: Headers;
    }
  | { t: "up-end"; id: number }
  | { t: "up-abort"; id: number }
  /** What it did about the hub's "taken" list */
  | { t: "taken-ack"; results: TakenResult[] };

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
      /** Approved only: whether the hub's sessions may use this machine */
      agents?: boolean;
      /** What this hub can do; absent on older hubs */
      caps?: string[];
      /** Approved, to a machine that named CAP_UP: what it may ask */
      up?: UpAllowed;
    }
  /** That setting, when it changes on either side */
  | { t: "agents"; allowed: boolean }
  | { t: "refused"; reason: string }
  | {
      t: "req";
      id: number;
      method: string;
      path: string;
      headers: Headers;
      /** The hub checked this came from the user's own browser */
      user: boolean;
      /** The hub's own call to this machine's inbox (lib/link/own-proof.ts) */
      own?: boolean;
    }
  | { t: "req-end"; id: number }
  | { t: "abort"; id: number }
  | { t: "ws"; id: number; path: string; headers: Headers; user: boolean }
  | { t: "ws-msg"; id: number; data: string }
  | { t: "ws-close"; id: number; code?: number }
  | { t: "ping" }
  /** Its switches or names changed */
  | ({ t: "up-allowed" } & UpAllowed)
  /** The answer to an upward request; its body follows as BIN_UP */
  | { t: "up-res"; id: number; status: number; headers: Headers }
  | { t: "up-res-end"; id: number }
  | { t: "up-res-error"; id: number; message: string }
  /** The hub took in this many more bytes of that request's body */
  | { t: "up-credit"; id: number; bytes: number }
  /**
   * Every session the hub continued from this machine's copies: sent
   * right after welcome (even empty) and again on change
   */
  | { t: "taken"; sessions: TakenSession[] };

/** Binary frame kinds: a body chunk of a request/response, a binary socket message */
export const BIN_BODY = 1;
export const BIN_WS = 2;
/** A body chunk of an upward request or of its answer; the id is the machine's */
export const BIN_UP = 3;

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
