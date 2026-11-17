/**
 * The hub's end of the link (lib/link/protocol.ts): accepts machines that
 * dial in, checks their key, and sends the user's requests and sockets
 * down to them. Nothing here opens a connection to a machine; a machine
 * that isn't connected is simply offline.
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { matchCode, newNonce, newPairingCode, verifyProof } from "./keys";
import {
  BIN_BODY,
  BIN_WS,
  LINK_VERSION,
  decodeBinary,
  encodeBinary,
  parseFrame,
  proofText,
  requestHeadersForLink,
  responseHeadersFromLink,
  type HubFrame,
  type LinkNotice,
  type MachineFrame,
} from "./protocol";
import type { MachineRow } from "./store";

export interface HubDeps {
  machineByKey(publicKey: string): MachineRow | null;
  machineById(id: string): MachineRow | null;
  createPendingMachine(input: {
    name: string;
    publicKey: string;
    platform: string;
    sha: string | null;
    signedInAs: string | null;
  }): MachineRow;
  touchMachine(
    id: string,
    seen: { platform: string; sha: string | null; signedInAs: string | null }
  ): void;
  approveMachine(id: string): MachineRow | null;
  removeMachine(id: string): boolean;
  /** This hub's commit, sent to machines so they can match it */
  sha(): string | null;
  /** An approved, connected machine has something to tell the user */
  onNotice?(machine: MachineRow, notice: LinkNotice): void;
}

interface PendingResponse {
  res: ServerResponse;
  timer: NodeJS.Timeout | null;
}

interface Relay {
  browser: WebSocket;
  open: boolean;
  queue: { data: RawData; binary: boolean }[];
}

interface Tunnel {
  machineId: string;
  ws: WebSocket;
  nextId: number;
  requests: Map<number, PendingResponse>;
  relays: Map<number, Relay>;
  alive: boolean;
  ping: NodeJS.Timeout;
}

export type MachinePresence = "online" | "offline" | "waiting";

const HANDSHAKE_MS = 10_000;
const PING_MS = 25_000;
const HEAD_MS = 120_000;
const CODE_MS = 10 * 60_000;
/** A relay may hold this much before the machine's socket opens */
const QUEUE_MAX = 256;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.split(",")[0].trim() || null;

const text = (data: RawData) =>
  Array.isArray(data)
    ? Buffer.concat(data).toString()
    : Buffer.from(data as ArrayBuffer).toString();

const bytes = (data: RawData) =>
  Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);

/** close() only takes 1000 or 3000-4999 */
const closeCode = (code: number | undefined) =>
  code === 1000 || (code !== undefined && code >= 3000 && code <= 4999)
    ? code
    : 1000;

export class LinkHub {
  private tunnels = new Map<string, Tunnel>();
  /** Machines that proved their key and wait for the user's approval */
  private waiting = new Map<string, { ws: WebSocket; open: () => void }>();
  private codes = new Map<string, number>();
  private machineWss = new WebSocketServer({ noServer: true });
  private browserWss = new WebSocketServer({ noServer: true });

  constructor(private deps: HubDeps) {}

  // --- Adding and removing machines ---

  /** A one-time code for Settings -> Machines -> Add; good for ten minutes */
  createPairingCode(): { code: string; expiresAt: number } {
    const now = Date.now();
    for (const [code, expires] of this.codes) {
      if (expires < now) this.codes.delete(code);
    }
    const code = newPairingCode();
    const expiresAt = now + CODE_MS;
    this.codes.set(code, expiresAt);
    return { code, expiresAt };
  }

  private takeCode(code: unknown): boolean {
    if (typeof code !== "string") return false;
    const expires = this.codes.get(code);
    if (expires === undefined) return false;
    this.codes.delete(code);
    return expires >= Date.now();
  }

  presence(id: string): MachinePresence {
    if (this.tunnels.has(id)) return "online";
    return this.waiting.has(id) ? "waiting" : "offline";
  }

  /** The user approved a machine: it joins at once if it's waiting */
  approve(id: string): MachineRow | null {
    const row = this.deps.approveMachine(id);
    if (row?.status === "approved") this.waiting.get(id)?.open();
    return row;
  }

  /** Cuts a machine off and forgets its key */
  remove(id: string): boolean {
    this.waiting.get(id)?.ws.close(4403, "removed");
    this.waiting.delete(id);
    const tunnel = this.tunnels.get(id);
    if (tunnel) this.closeTunnel(tunnel, 4403, "removed");
    return this.deps.removeMachine(id);
  }

  // --- A machine dials in ---

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.machineWss.handleUpgrade(request, socket, head, (ws) =>
      this.accept(ws, request)
    );
  }

  private accept(ws: WebSocket, request: IncomingMessage): void {
    const send = (frame: HubFrame) => ws.send(JSON.stringify(frame));
    const refuse = (reason: string) => {
      clearTimeout(timer);
      if (ws.readyState === WebSocket.OPEN) {
        send({ t: "refused", reason });
        ws.close(4401, reason.slice(0, 100));
      }
    };
    const timer = setTimeout(() => refuse("handshake timeout"), HANDSHAKE_MS);
    const hubHost = (
      first(request.headers["x-forwarded-host"]) ??
      first(request.headers.host) ??
      ""
    ).toLowerCase();
    const signedInAs = first(request.headers["remote-user"]);

    let stage: "hello" | "proof" | "waiting" | "open" = "hello";
    let machine: MachineRow | null = null;
    let hello: Extract<MachineFrame, { t: "hello" }> | null = null;
    let nonce = "";
    let tunnel: Tunnel | null = null;

    const open = () => {
      if (!machine || stage === "open" || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      this.waiting.delete(machine.id);
      const old = this.tunnels.get(machine.id);
      if (old) this.closeTunnel(old, 4409, "replaced");
      stage = "open";
      const t: Tunnel = {
        machineId: machine.id,
        ws,
        nextId: 1,
        requests: new Map(),
        relays: new Map(),
        alive: true,
        ping: setInterval(() => {
          if (!t.alive) return ws.terminate();
          t.alive = false;
          send({ t: "ping" });
        }, PING_MS),
      };
      tunnel = t;
      this.tunnels.set(machine.id, t);
      send({
        t: "welcome",
        machineId: machine.id,
        status: "approved",
        sha: this.deps.sha(),
        code: matchCode(machine.public_key),
      });
    };

    ws.on("message", (data, isBinary) => {
      if (stage === "open" && tunnel) {
        this.fromMachine(tunnel, data, isBinary);
        return;
      }
      if (isBinary) return refuse("unexpected frame");
      const frame = parseFrame<MachineFrame>(text(data));
      if (!frame) return refuse("unexpected frame");

      if (stage === "hello") {
        if (frame.t !== "hello" || frame.v !== LINK_VERSION) {
          return refuse("unsupported link version");
        }
        if (
          typeof frame.hubHost !== "string" ||
          frame.hubHost.toLowerCase() !== hubHost
        ) {
          return refuse("wrong hub address");
        }
        const known = this.deps.machineByKey(frame.key);
        if (!known && !this.takeCode(frame.code)) {
          return refuse("this machine isn't linked: add it from Settings");
        }
        hello = frame;
        machine =
          known ??
          this.deps.createPendingMachine({
            name: String(frame.name ?? ""),
            publicKey: frame.key,
            platform: String(frame.platform ?? ""),
            sha: typeof frame.sha === "string" ? frame.sha : null,
            signedInAs,
          });
        nonce = newNonce();
        stage = "proof";
        send({ t: "challenge", nonce });
        return;
      }

      if (stage === "proof") {
        if (
          frame.t !== "proof" ||
          !machine ||
          !hello ||
          !verifyProof(machine.public_key, proofText(hubHost, nonce), frame.sig)
        ) {
          return refuse("signature check failed");
        }
        clearTimeout(timer);
        this.deps.touchMachine(machine.id, {
          platform: String(hello.platform ?? ""),
          sha: typeof hello.sha === "string" ? hello.sha : null,
          signedInAs,
        });
        // Re-read: it may have been approved or removed since hello
        machine = this.deps.machineById(machine.id);
        if (!machine) return refuse("removed");
        if (machine.status === "approved") return open();
        stage = "waiting";
        this.waiting.get(machine.id)?.ws.close(4409, "replaced");
        this.waiting.set(machine.id, { ws, open });
        send({
          t: "welcome",
          machineId: machine.id,
          status: "pending",
          sha: this.deps.sha(),
          code: matchCode(machine.public_key),
        });
      }
      // waiting: nothing to hear until the user approves
    });

    ws.on("close", () => {
      clearTimeout(timer);
      if (machine && this.waiting.get(machine.id)?.ws === ws) {
        this.waiting.delete(machine.id);
      }
      if (tunnel) this.dropTunnel(tunnel);
    });
    ws.on("error", () => ws.terminate());
  }

  private closeTunnel(tunnel: Tunnel, code: number, reason: string): void {
    this.dropTunnel(tunnel);
    tunnel.ws.close(code, reason);
  }

  /** Fails whatever was in flight; the machine may dial in again */
  private dropTunnel(tunnel: Tunnel): void {
    clearInterval(tunnel.ping);
    if (this.tunnels.get(tunnel.machineId) === tunnel) {
      this.tunnels.delete(tunnel.machineId);
    }
    for (const [id, pending] of tunnel.requests) {
      this.failResponse(pending, 502, "The machine disconnected");
      tunnel.requests.delete(id);
    }
    for (const [id, relay] of tunnel.relays) {
      relay.browser.close(1012, "machine disconnected");
      tunnel.relays.delete(id);
    }
  }

  private failResponse(
    pending: PendingResponse,
    status: number,
    message: string
  ): void {
    if (pending.timer) clearTimeout(pending.timer);
    const { res } = pending;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ error: message, code: "machine_unreachable" }));
  }

  private fromMachine(tunnel: Tunnel, data: RawData, isBinary: boolean): void {
    if (isBinary) {
      const frame = decodeBinary(bytes(data));
      if (!frame) return;
      if (frame.kind === BIN_BODY) {
        tunnel.requests.get(frame.id)?.res.write(frame.data);
      } else if (frame.kind === BIN_WS) {
        const relay = tunnel.relays.get(frame.id);
        if (relay?.browser.readyState === WebSocket.OPEN) {
          relay.browser.send(frame.data, { binary: true });
        }
      }
      return;
    }
    const frame = parseFrame<MachineFrame>(text(data));
    if (!frame) return;
    switch (frame.t) {
      case "pong":
        tunnel.alive = true;
        return;
      case "notify": {
        const { t: _t, ...notice } = frame;
        // Re-read: only a machine that is still approved gets a say
        const machine = this.deps.machineById(tunnel.machineId);
        if (machine?.status === "approved") {
          this.deps.onNotice?.(machine, notice);
        }
        return;
      }
      case "res": {
        const pending = tunnel.requests.get(frame.id);
        if (!pending || pending.res.headersSent) return;
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = null;
        const status =
          Number.isInteger(frame.status) &&
          frame.status >= 100 &&
          frame.status <= 599
            ? frame.status
            : 502;
        pending.res.writeHead(
          status,
          responseHeadersFromLink(frame.headers ?? {}) as Record<
            string,
            string | string[]
          >
        );
        return;
      }
      case "res-end": {
        const pending = tunnel.requests.get(frame.id);
        if (!pending) return;
        tunnel.requests.delete(frame.id);
        pending.res.end();
        return;
      }
      case "res-error": {
        const pending = tunnel.requests.get(frame.id);
        if (!pending) return;
        tunnel.requests.delete(frame.id);
        this.failResponse(pending, 502, "The machine couldn't answer");
        return;
      }
      case "ws-open": {
        const relay = tunnel.relays.get(frame.id);
        if (!relay) return;
        relay.open = true;
        for (const item of relay.queue) {
          this.toMachineSocket(tunnel, frame.id, item.data, item.binary);
        }
        relay.queue = [];
        return;
      }
      case "ws-msg": {
        const relay = tunnel.relays.get(frame.id);
        if (relay?.browser.readyState === WebSocket.OPEN) {
          relay.browser.send(frame.data);
        }
        return;
      }
      case "ws-close": {
        const relay = tunnel.relays.get(frame.id);
        if (!relay) return;
        tunnel.relays.delete(frame.id);
        relay.browser.close(closeCode(frame.code));
        return;
      }
    }
  }

  private toMachineSocket(
    tunnel: Tunnel,
    id: number,
    data: RawData,
    binary: boolean
  ): void {
    if (tunnel.ws.readyState !== WebSocket.OPEN) return;
    if (binary) tunnel.ws.send(encodeBinary(id, BIN_WS, bytes(data)));
    else tunnel.ws.send(JSON.stringify({ t: "ws-msg", id, data: text(data) }));
  }

  // --- The user's requests go down the link ---

  /**
   * Sends one HTTP request to a machine and pipes the answer back.
   * `user` is the hub's word that it came from the user's own browser.
   */
  forwardRequest(
    machineId: string,
    req: IncomingMessage,
    res: ServerResponse,
    options: { path: string; user: boolean }
  ): void {
    const tunnel = this.tunnels.get(machineId);
    if (!tunnel || tunnel.ws.readyState !== WebSocket.OPEN) {
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          error: "That machine is offline",
          code: "machine_offline",
        })
      );
      return;
    }
    const id = tunnel.nextId++;
    const send = (frame: HubFrame) => {
      if (tunnel.ws.readyState === WebSocket.OPEN) {
        tunnel.ws.send(JSON.stringify(frame));
      }
    };
    const pending: PendingResponse = {
      res,
      timer: setTimeout(() => {
        if (tunnel.requests.delete(id)) {
          send({ t: "abort", id });
          this.failResponse(pending, 504, "The machine took too long");
        }
      }, HEAD_MS),
    };
    tunnel.requests.set(id, pending);
    send({
      t: "req",
      id,
      method: req.method ?? "GET",
      path: options.path,
      headers: requestHeadersForLink(req.headers),
      user: options.user,
    });
    req.on("data", (chunk: Buffer) => {
      if (tunnel.ws.readyState === WebSocket.OPEN) {
        tunnel.ws.send(encodeBinary(id, BIN_BODY, chunk));
      }
    });
    req.on("end", () => send({ t: "req-end", id }));
    res.on("close", () => {
      if (pending.timer) clearTimeout(pending.timer);
      // The browser went away before the answer finished
      if (tunnel.requests.delete(id)) send({ t: "abort", id });
    });
  }

  /** Relays a browser WebSocket (the terminal) to the same path on a machine */
  forwardUpgrade(
    machineId: string,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    options: { path: string; user: boolean }
  ): void {
    const tunnel = this.tunnels.get(machineId);
    if (!tunnel || tunnel.ws.readyState !== WebSocket.OPEN) {
      socket.write(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"
      );
      socket.destroy();
      return;
    }
    this.browserWss.handleUpgrade(request, socket, head, (browser) => {
      if (tunnel.ws.readyState !== WebSocket.OPEN) {
        browser.close(1012, "machine disconnected");
        return;
      }
      const id = tunnel.nextId++;
      const relay: Relay = { browser, open: false, queue: [] };
      tunnel.relays.set(id, relay);
      tunnel.ws.send(
        JSON.stringify({
          t: "ws",
          id,
          path: options.path,
          headers: requestHeadersForLink(request.headers),
          user: options.user,
        } satisfies HubFrame)
      );
      browser.on("message", (data, isBinary) => {
        if (relay.open) {
          this.toMachineSocket(tunnel, id, data, isBinary);
        } else if (relay.queue.length < QUEUE_MAX) {
          relay.queue.push({ data, binary: isBinary });
        }
      });
      browser.on("close", (code) => {
        if (
          tunnel.relays.delete(id) &&
          tunnel.ws.readyState === WebSocket.OPEN
        ) {
          tunnel.ws.send(
            JSON.stringify({ t: "ws-close", id, code } satisfies HubFrame)
          );
        }
      });
      browser.on("error", () => browser.terminate());
    });
  }
}
