/**
 * A linked machine's end of the link (lib/link/protocol.ts). It dials out
 * to the hub, proves its key, then answers the hub's requests from this
 * machine's own AgentOS on loopback. Nothing listens for the hub: if this
 * isn't running, the machine can't be reached.
 */

import http from "http";
import { WebSocket, type RawData } from "ws";
import { signProof, type MachineKey } from "./keys";
import {
  BIN_BODY,
  BIN_WS,
  LINK_PATH,
  LINK_VERSION,
  decodeBinary,
  encodeBinary,
  parseFrame,
  proofText,
  type Headers,
  type HubFrame,
  type MachineFrame,
} from "./protocol";

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
  onState?: (state: LinkState) => void;
}

const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];
/** No word from the hub (it pings every 25s) for this long: reconnect */
const QUIET_MS = 70_000;

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

/** Only this server's API and sockets; never an absolute or odd URL */
export function isForwardablePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    /^\/(api|ws)\/[^\s]*$/.test(path) &&
    !path.includes("//") &&
    !path.includes("\\")
  );
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
      this.setState({
        status: "offline",
        reason: error instanceof Error ? error.message : "sign-in failed",
      });
      return this.again();
    }
    const url = new URL(LINK_PATH, this.hub);
    url.protocol = this.hub.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, { headers, followRedirects: false });
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
        case "welcome":
          this.attempt = 0;
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
      this.dropAll();
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

  private dropAll(): void {
    for (const request of this.requests.values()) request.destroy();
    this.requests.clear();
    for (const socket of this.sockets.values()) socket.terminate();
    this.sockets.clear();
  }

  /** What this machine's server sees: a same-site call on the hub's host */
  private localHeaders(
    headers: Headers,
    user: boolean
  ): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(headers ?? {})) {
      const key = name.toLowerCase();
      if (value === undefined || key === "cookie" || key === "host") continue;
      if (key.startsWith("x-forwarded-") || key === "x-real-ip") continue;
      out[key] = value;
    }
    out.host = this.hub.host;
    if (user) out.cookie = this.options.userCookie();
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
        headers: this.localHeaders(frame.headers, frame.user === true),
      },
      (response) => {
        send({
          t: "res",
          id,
          status: response.statusCode ?? 502,
          headers: response.headers,
        });
        response.on("data", (chunk: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(encodeBinary(id, BIN_BODY, chunk));
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
    if (decoded.kind === BIN_BODY) {
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
      if (isBinary) ws.send(encodeBinary(id, BIN_WS, bytes(data)));
      else send({ t: "ws-msg", id, data: text(data) });
    });
    local.on("close", (code) => {
      if (this.sockets.delete(id)) send({ t: "ws-close", id, code });
    });
    local.on("error", () => local.terminate());
  }
}
