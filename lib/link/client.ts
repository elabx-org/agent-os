/**
 * A linked machine's end of the link (lib/link/protocol.ts). It dials out
 * to the hub, proves its key, then answers the hub's requests from this
 * machine's own AgentOS on loopback. Nothing listens for the hub: if this
 * isn't running, the machine can't be reached.
 */

import http from "http";
import { Readable } from "stream";
import { WebSocket, type RawData } from "ws";
import { CreditSender } from "./flow";
import { signProof, type MachineKey } from "./keys";
import {
  BIN_BODY,
  BIN_UP,
  BIN_WS,
  CAP_JOBS,
  CAP_PEER,
  HUB_PEER,
  LINK_MACHINE_HEADER,
  LINK_PROOF_HEADER,
  CAP_TAKE,
  CAP_UP,
  LINK_MAX_FRAME,
  LINK_PATH,
  LINK_VERSION,
  decodeBinary,
  encodeBinary,
  parseFrame,
  proofText,
  type Headers,
  type HubFrame,
  type LinkNotice,
  type MachineFrame,
  type TakenResult,
  type TakenSession,
  type UpAllowed,
  type UpKind,
} from "./protocol";

/** One request this machine asks of the hub (lib/link/up.ts) */
export interface UpInit {
  method: string;
  /** The hub's path, with its query */
  path: string;
  headers?: Record<string, string>;
  body?: Readable | Buffer | null;
  signal?: AbortSignal;
}

export interface UpAnswer {
  status: number;
  headers: Headers;
  body: Buffer;
}

/** Why the hub couldn't be asked at all; the texts are in lib/link/up.ts */
export class UpUnavailable extends Error {
  constructor(
    public code: "not_linked" | "hub_too_old" | "link_dropped" | "timeout"
  ) {
    super(code);
    this.name = "UpUnavailable";
  }
}

interface UpCall {
  resolve(answer: UpAnswer): void;
  reject(error: Error): void;
  status: number | null;
  headers: Headers;
  chunks: Buffer[];
  sender: CreditSender | null;
  timer: NodeJS.Timeout;
  unlisten: () => void;
}

/**
 * How long this side waits for a whole answer, whatever the hub's rule:
 * a copy may take the hub's 45 minutes, a session's call its 2
 */
const UP_WAIT_MS: Record<UpKind, number> = {
  system: 46 * 60_000,
  agent: 135_000,
};
export type LinkState =
  | { status: "connecting" }
  /** Key accepted; the user hasn't approved this machine yet */
  | { status: "pending"; code: string }
  | { status: "linked"; machineId: string; hubSha: string | null }
  /** The hub said no (not linked, removed, bad signature) */
  | { status: "refused"; reason: string }
  /** The sign-in in front of the hub turned the connection away */
  | { status: "signin"; httpStatus: number }
  | { status: "offline"; reason: string };

export interface LinkClientOptions {
  /** The hub's address as the user opens it, e.g. https://agent.example.com */
  hubUrl: string;
  key: MachineKey;
  name: string;
  /** This machine's AgentOS, on loopback */
  localPort: number;
  sha: string | null;
  /** One-time code from the hub's Settings; only for the first connection */
  code?: string;
  /** Headers for the dial-out, e.g. a bearer token for a sign-in proxy */
  authHeaders?: () => Promise<Record<string, string>>;
  /** This machine's own proof-of-user cookie, added when the hub vouches */
  userCookie: () => string;
  /** This machine's per-boot proof that a call came down the link from its hub */
  linkProof?: () => string;
  onState?: (state: LinkState) => void;
  /** What the hub lets this machine ask, when it says; null once the link drops */
  onUpAllowed?: (up: UpAllowed | null) => void;
  /** Tests: how long to wait for an answer to an upward request */
  upWaitMs?: Partial<Record<UpKind, number>>;
  /**
   * The hub continued these sessions from their copies: pause them here.
   * Called at once when the list arrives (before any later frame); what it
   * resolves to goes back as taken-ack (lib/backup/machine.ts pauseTaken)
   */
  onTaken?: (sessions: TakenSession[]) => Promise<TakenResult[]>;
}

const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];
/** No word from the hub (it pings every 25s) for this long: reconnect */
const QUIET_MS = 70_000;
/** Past this much unsent on the link, a body waits for it to drain */
const BUFFER_HIGH = 4 * 1024 * 1024;

const text = (data: RawData) =>
  Array.isArray(data)
    ? Buffer.concat(data).toString()
    : Buffer.from(data as ArrayBuffer).toString();

const bytes = (data: RawData) =>
  Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);

const closeCode = (code: number | undefined) =>
  code === 1000 || (code !== undefined && code >= 3000 && code <= 4999)
    ? code
    : 1000;

/**
 * Only this server's API and sockets; never an absolute or odd URL, and
 * never this machine's own way up to the hub (/api/hub)
 */
export function isForwardablePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    /^\/(api|ws)\/[^\s]*$/.test(path) &&
    !/^\/api\/hub(?:[/?#%]|$)/i.test(path) &&
    !path.includes("//") &&
    !path.includes("\\")
  );
}

/** The hub's word on what this machine may ask, checked field by field */
function upAllowedOf(value: unknown): UpAllowed | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return {
    agents: v.agents === true,
    backup: v.backup === true,
    name: typeof v.name === "string" ? v.name.slice(0, 80) : "",
    hubName: typeof v.hubName === "string" ? v.hubName.slice(0, 80) : null,
  };
}

export class LinkClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private retry: NodeJS.Timeout | null = null;
  private quiet: NodeJS.Timeout | null = null;
  private requests = new Map<number, http.ClientRequest>();
  private sockets = new Map<number, WebSocket>();
  private hub: URL;
  state: LinkState = { status: "connecting" };
  /** Whether the hub's sessions may use this machine; null when unknown */
  agents: boolean | null = null;
  /** What the hub said it can do in its welcome; empty on an older hub */
  hubCaps = new Set<string>();
  /** What the hub lets this machine ask; null when unknown */
  upAllowed: UpAllowed | null = null;
  /** The hub's "taken" list has come on this connection: copies may start */
  takenSeen = false;
  private ups = new Map<number, UpCall>();
  private upNext = 1;

  constructor(private options: LinkClientOptions) {
    this.hub = new URL(options.hubUrl);
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.quiet) clearTimeout(this.quiet);
    this.ws?.close(1000);
    this.dropAll();
  }

  /** Tells the hub; false when there's no link to tell it over */
  notify(notice: LinkNotice): boolean {
    if (this.state.status !== "linked") return false;
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ t: "notify", ...notice } as MachineFrame));
    return true;
  }

  /** This machine's owner allows or stops the hub's sessions using it */
  setAgents(allowed: boolean): boolean {
    if (this.state.status !== "linked") return false;
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ t: "agents", allowed } as MachineFrame));
    return true;
  }

  /**
   * Asks the hub. Rejects with UpUnavailable when there is no link, the
   * hub is too old to be asked, the link drops, or it takes too long.
   */
  up(kind: UpKind, init: UpInit): Promise<UpAnswer> {
    const ws = this.ws;
    if (
      this.state.status !== "linked" ||
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {
      return Promise.reject(new UpUnavailable("not_linked"));
    }
    // An older hub would ignore the frame: never send it
    if (!this.hubCaps.has(CAP_UP)) {
      return Promise.reject(new UpUnavailable("hub_too_old"));
    }
    if (init.signal?.aborted) {
      return Promise.reject(new Error("aborted"));
    }
    const id = this.upNext++;
    const send = (frame: MachineFrame) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    };
    return new Promise<UpAnswer>((resolve, reject) => {
      const finish = () => {
        const call = this.ups.get(id);
        if (!call) return null;
        this.ups.delete(id);
        clearTimeout(call.timer);
        call.unlisten();
        call.sender?.abort();
        return call;
      };
      const onAbort = () => {
        if (!finish()) return;
        send({ t: "up-abort", id });
        reject(new Error("aborted"));
      };
      init.signal?.addEventListener("abort", onAbort, { once: true });
      const wait = this.options.upWaitMs?.[kind] ?? UP_WAIT_MS[kind];
      const call: UpCall = {
        resolve: (answer) => {
          if (finish()) resolve(answer);
        },
        reject: (error) => {
          if (finish()) reject(error);
        },
        status: null,
        headers: {},
        chunks: [],
        sender: null,
        timer: setTimeout(() => {
          if (!finish()) return;
          send({ t: "up-abort", id });
          reject(new UpUnavailable("timeout"));
        }, wait),
        unlisten: () => init.signal?.removeEventListener("abort", onAbort),
      };
      this.ups.set(id, call);
      send({
        t: "up",
        id,
        kind,
        method: init.method,
        path: init.path,
        headers: init.headers ?? {},
      });
      const body = init.body;
      if (!body) return send({ t: "up-end", id });
      const sender = new CreditSender({
        send: (chunk) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(encodeBinary(id, BIN_UP, chunk));
          }
        },
        buffered: () => ws.bufferedAmount,
      });
      call.sender = sender;
      const source = Buffer.isBuffer(body) ? Readable.from([body]) : body;
      sender.pipe(source).then(
        () => {
          if (this.ups.has(id)) send({ t: "up-end", id });
        },
        () => {
          // Aborted, or the answer came first: nothing more to send
          if (!Buffer.isBuffer(body)) body.destroy();
        }
      );
    });
  }

  private fromHubUp(frame: HubFrame): void {
    switch (frame.t) {
      case "up-res": {
        const call = this.ups.get(frame.id);
        if (!call || call.status !== null) return;
        call.status = Number.isInteger(frame.status) ? frame.status : 502;
        call.headers = frame.headers ?? {};
        return;
      }
      case "up-res-end": {
        const call = this.ups.get(frame.id);
        if (!call) return;
        call.resolve({
          status: call.status ?? 502,
          headers: call.headers,
          body: Buffer.concat(call.chunks),
        });
        return;
      }
      case "up-res-error":
        this.ups.get(frame.id)?.reject(new UpUnavailable("link_dropped"));
        return;
      case "up-credit":
        this.ups.get(frame.id)?.sender?.credit(frame.bytes);
        return;
    }
  }

  private setUpAllowed(up: UpAllowed | null): void {
    this.upAllowed = up;
    this.options.onUpAllowed?.(up);
  }

  private setState(state: LinkState): void {
    this.state = state;
    this.options.onState?.(state);
  }

  private again(slow = false): void {
    if (this.stopped) return;
    const wait = slow
      ? 60_000
      : RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
    this.attempt++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.connect(), wait);
  }

  private heard(): void {
    if (this.quiet) clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.ws?.terminate(), QUIET_MS);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setState({ status: "connecting" });
    let headers: Record<string, string> = {};
    try {
      headers = (await this.options.authHeaders?.()) ?? {};
    } catch (error) {
      if (error instanceof Error && error.name === "SignInNeeded") {
        // Nothing to retry with until the user signs in again
        this.setState({ status: "signin", httpStatus: 0 });
        return this.again(true);
      }
      this.setState({
        status: "offline",
        reason: error instanceof Error ? error.message : "sign-in failed",
      });
      return this.again();
    }
    const url = new URL(LINK_PATH, this.hub);
    url.protocol = this.hub.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, {
      headers,
      followRedirects: false,
      maxPayload: LINK_MAX_FRAME,
    });
    this.ws = ws;
    let refused: string | null = null;

    const send = (frame: MachineFrame) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    };

    ws.on("open", () => {
      this.heard();
      send({
        t: "hello",
        v: LINK_VERSION,
        key: this.options.key.publicKey,
        name: this.options.name,
        platform: process.platform,
        sha: this.options.sha,
        hubHost: this.hub.host,
        code: this.options.code,
        caps: [CAP_UP, CAP_TAKE, CAP_PEER, CAP_JOBS],
      });
    });

    // A sign-in page or an error instead of a socket
    ws.on("unexpected-response", (_request, response) => {
      response.resume();
      this.setState({ status: "signin", httpStatus: response.statusCode ?? 0 });
      ws.terminate();
    });

    ws.on("message", (data, isBinary) => {
      this.heard();
      if (isBinary) return this.fromHubBinary(bytes(data));
      const frame = parseFrame<HubFrame>(text(data));
      if (!frame) return;
      switch (frame.t) {
        case "challenge":
          return send({
            t: "proof",
            sig: signProof(
              this.options.key.privateKey,
              proofText(this.hub.host, frame.nonce)
            ),
          });
        case "agents":
          this.agents = frame.allowed === true;
          return;
        case "up-allowed":
          return this.setUpAllowed(upAllowedOf(frame));
        case "up-res":
        case "up-res-end":
        case "up-res-error":
        case "up-credit":
          return this.fromHubUp(frame);
        case "taken":
          return this.taken(ws, frame.sessions);
        case "welcome":
          this.attempt = 0;
          this.agents =
            frame.status === "approved" && typeof frame.agents === "boolean"
              ? frame.agents
              : null;
          this.hubCaps = new Set(
            frame.status === "approved" && Array.isArray(frame.caps)
              ? frame.caps.filter((c) => typeof c === "string")
              : []
          );
          this.upNext = 1;
          this.takenSeen = false;
          this.setUpAllowed(
            frame.status === "approved" ? upAllowedOf(frame.up) : null
          );
          return this.setState(
            frame.status === "approved"
              ? {
                  status: "linked",
                  machineId: frame.machineId,
                  hubSha: frame.sha,
                }
              : { status: "pending", code: frame.code }
          );
        case "refused":
          refused = frame.reason;
          return;
        case "ping":
          return send({ t: "pong" });
        case "req":
          return this.request(ws, frame);
        case "req-end":
          this.requests.get(frame.id)?.end();
          return;
        case "abort":
          this.requests.get(frame.id)?.destroy();
          this.requests.delete(frame.id);
          return;
        case "ws":
          return this.socket(ws, frame);
        case "ws-msg":
          return this.toLocalSocket(frame.id, frame.data, false);
        case "ws-close": {
          const local = this.sockets.get(frame.id);
          this.sockets.delete(frame.id);
          local?.close(closeCode(frame.code));
          return;
        }
      }
    });

    ws.on("close", (code) => {
      if (this.quiet) clearTimeout(this.quiet);
      if (this.ws === ws) this.ws = null;
      this.agents = null;
      this.hubCaps = new Set();
      this.takenSeen = false;
      this.dropAll();
      if (this.upAllowed) this.setUpAllowed(null);
      if (this.stopped) return;
      if (code === 4403) {
        // Removed on the hub: stop for good until it's added again
        this.stopped = true;
        return this.setState({ status: "refused", reason: "removed" });
      }
      if (refused !== null) {
        this.setState({ status: "refused", reason: refused });
        return this.again(true);
      }
      if (this.state.status !== "signin") {
        this.setState({ status: "offline", reason: "disconnected" });
      }
      this.again(this.state.status === "signin");
    });
    ws.on("error", () => {
      // "close" follows; nothing else to do
    });
  }

  /** Pauses what the hub continued, then says what it did */
  private taken(ws: WebSocket, sessions: unknown): void {
    if (this.state.status !== "linked") return;
    const list = Array.isArray(sessions) ? (sessions as TakenSession[]) : [];
    const done = this.options.onTaken?.(list) ?? Promise.resolve([]);
    this.takenSeen = true;
    done.then(
      (results) => {
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "taken-ack", results } as MachineFrame));
        }
      },
      (error) => console.error("[link] pausing what the hub took:", error)
    );
  }

  private dropAll(): void {
    for (const request of this.requests.values()) request.destroy();
    this.requests.clear();
    for (const socket of this.sockets.values()) socket.terminate();
    this.sockets.clear();
    for (const call of [...this.ups.values()]) {
      call.reject(new UpUnavailable("link_dropped"));
    }
  }

  /** What this machine's server sees: a same-site call on the hub's host */
  private localHeaders(
    headers: Headers,
    user: boolean,
    own = false
  ): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(headers ?? {})) {
      const key = name.toLowerCase();
      if (value === undefined || key === "cookie" || key === "host") continue;
      if (key.startsWith("x-forwarded-") || key === "x-real-ip") continue;
      // Only this client says a call is the hub's own
      if (key.startsWith("x-agentos-link")) continue;
      out[key] = value;
    }
    out.host = this.hub.host;
    if (user) out.cookie = this.options.userCookie();
    if (own && this.options.linkProof) {
      out[LINK_PROOF_HEADER] = this.options.linkProof();
      out[LINK_MACHINE_HEADER] = HUB_PEER;
    }
    return out;
  }

  private request(ws: WebSocket, frame: Extract<HubFrame, { t: "req" }>): void {
    const { id } = frame;
    const send = (out: MachineFrame) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(out));
    };
    if (!isForwardablePath(frame.path)) {
      return send({ t: "res-error", id, message: "path not allowed" });
    }
    const request = http.request(
      {
        host: "127.0.0.1",
        port: this.options.localPort,
        method: frame.method,
        path: frame.path,
        headers: this.localHeaders(
          frame.headers,
          frame.user === true,
          frame.own === true
        ),
      },
      (response) => {
        send({
          t: "res",
          id,
          status: response.statusCode ?? 502,
          headers: response.headers,
        });
        response.on("data", (chunk: Buffer) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(encodeBinary(id, BIN_BODY, chunk));
          // A large body waits for the link, so pings still get through
          if (ws.bufferedAmount > BUFFER_HIGH) {
            response.pause();
            const drain = setInterval(() => {
              if (
                ws.readyState !== WebSocket.OPEN ||
                ws.bufferedAmount < BUFFER_HIGH / 4
              ) {
                clearInterval(drain);
                response.resume();
              }
            }, 50);
          }
        });
        response.on("end", () => {
          this.requests.delete(id);
          send({ t: "res-end", id });
        });
        response.on("error", () => {
          if (this.requests.delete(id)) {
            send({ t: "res-error", id, message: "response failed" });
          }
        });
      }
    );
    request.on("error", (error) => {
      if (this.requests.delete(id)) {
        send({ t: "res-error", id, message: error.message });
      }
    });
    this.requests.set(id, request);
  }

  private fromHubBinary(frame: Buffer): void {
    const decoded = decodeBinary(frame);
    if (!decoded) return;
    if (decoded.kind === BIN_UP) {
      const call = this.ups.get(decoded.id);
      if (call && call.status !== null) call.chunks.push(decoded.data);
    } else if (decoded.kind === BIN_BODY) {
      this.requests.get(decoded.id)?.write(decoded.data);
    } else if (decoded.kind === BIN_WS) {
      this.toLocalSocket(decoded.id, decoded.data, true);
    }
  }

  private toLocalSocket(
    id: number,
    data: string | Buffer,
    binary: boolean
  ): void {
    const local = this.sockets.get(id);
    if (local?.readyState === WebSocket.OPEN) local.send(data, { binary });
  }

  private socket(ws: WebSocket, frame: Extract<HubFrame, { t: "ws" }>): void {
    const { id } = frame;
    const send = (out: MachineFrame) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(out));
    };
    if (!isForwardablePath(frame.path)) return send({ t: "ws-close", id });
    const local = new WebSocket(
      `ws://127.0.0.1:${this.options.localPort}${frame.path}`,
      { headers: this.localHeaders(frame.headers, frame.user === true) }
    );
    this.sockets.set(id, local);
    local.on("open", () => send({ t: "ws-open", id }));
    local.on("message", (data, isBinary) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const out = isBinary
        ? encodeBinary(id, BIN_WS, bytes(data))
        : JSON.stringify({ t: "ws-msg", id, data: text(data) });
      // Past the link's frame limit the hub would drop the whole link:
      // only this socket closes instead
      if (Buffer.byteLength(out) > LINK_MAX_FRAME) {
        local.close(1009, "message too big");
        return;
      }
      ws.send(out);
    });
    local.on("close", (code) => {
      if (this.sockets.delete(id)) send({ t: "ws-close", id, code });
    });
    local.on("error", () => local.terminate());
  }
}
