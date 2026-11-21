/**
 * The hub's end of the link (lib/link/protocol.ts): accepts machines that
 * dial in, checks their key, and sends the user's requests and sockets
 * down to them. Nothing here opens a connection to a machine; a machine
 * that isn't connected is simply offline.
 */

import http, { type IncomingMessage, type ServerResponse } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { CreditReceiver } from "./flow";
import { matchCode, newNonce, newPairingCode, verifyProof } from "./keys";
import {
  BIN_BODY,
  BIN_UP,
  BIN_WS,
  CAP_UP,
  LINK_MAX_FRAME,
  LINK_VERSION,
  UP_ANSWER_MAX,
  UP_CHUNK,
  UP_WINDOW,
  decodeBinary,
  encodeBinary,
  parseFrame,
  proofText,
  requestHeadersForLink,
  responseHeadersFromLink,
  type HubFrame,
  type LinkNotice,
  type MachineFrame,
  type UpAllowed,
  type UpKind,
} from "./protocol";
import type { MachineRow } from "./store";
import {
  UP_LIMITS,
  UP_LOCAL_ERRORS,
  UpCounter,
  decideUp,
  upRefusal,
  type UpDecision,
  type UpLimits,
  type UpRefusal,
  type UpRule,
} from "./up";

/** An upward request the hub answered, for the audit (stage 2) */
export interface UpEvent {
  machine: MachineRow;
  rule: UpRule;
  targetMachineId: string | null;
  pathname: string;
  status: number;
  sent: unknown;
  answer: unknown;
}

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
  setMachineAgents(id: string, allowed: boolean): void;
  removeMachine(id: string): boolean;
  /** This hub's commit, sent to machines so they can match it */
  sha(): string | null;
  /** An approved, connected machine has something to tell the user */
  onNotice?(machine: MachineRow, notice: LinkNotice): void;
  /** This server's own port, where a machine's upward requests are asked */
  localPort(): number;
  /** The per-boot proof added to AgentOS's own upward calls (lib/link/up-guard.ts) */
  linkProof(): string;
  /** What machines may ask (lib/link/up.ts) */
  upRules(): UpRule[];
  /** What the user calls this server */
  serverName(): string | null;
  /** What the machine said it can do in its hello */
  setMachineCaps(id: string, caps: string[]): void;
  /** An upward request with an audit label was answered */
  onUp?(event: UpEvent): void;
  /** An approved machine's request was refused before it was asked */
  onUpRefused?(machine: MachineRow, refusal: UpRefusal): void;
  /** Last word before an allowed upward request is asked (stage 2 limits) */
  beforeUp?(
    decision: Extract<UpDecision, { ok: true }>,
    machine: MachineRow
  ): UpRefusal | null;
  /** Tests: smaller limits and timeouts */
  upLimits?: UpLimits;
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

/** One upward request from a machine (ids are the machine's) */
interface UpPending {
  kind: UpKind;
  req: http.ClientRequest | null;
  /** Agent bodies are read whole, then rebuilt (rule.body) */
  chunks: Buffer[];
  bytes: number;
  rule: UpRule | null;
  decision: Extract<UpDecision, { ok: true }> | null;
  receiver: CreditReceiver;
  /** Head timeout after the body ends */
  timer: NodeJS.Timeout | null;
  /** No word either way for this long: it's given up */
  idle: NodeJS.Timeout | null;
  answered: boolean;
  answerBytes: number;
  /** Part of a JSON answer kept for deps.onUp */
  kept: Buffer[];
  keptBytes: number;
  sent: unknown;
}

interface Tunnel {
  machineId: string;
  ws: WebSocket;
  nextId: number;
  requests: Map<number, PendingResponse>;
  relays: Map<number, Relay>;
  alive: boolean;
  ping: NodeJS.Timeout;
  /** What the machine said it can do in its hello */
  caps: Set<string>;
  ups: Map<number, UpPending>;
}

export type MachinePresence = "online" | "offline" | "waiting";

const HANDSHAKE_MS = 10_000;
const PING_MS = 25_000;
const HEAD_MS = 120_000;
/**
 * A session's code and conversation moving between machines
 * (lib/link/move.ts): the answer comes once the whole file is across, or
 * once git has packed it
 */
const MOVE_HEAD_MS = 45 * 60_000;
const MOVE_PATH = /^\/api\/(session-moves\/|sessions\/[^/]+\/move-out)/;
/** Past this much unsent on the link, a body waits for it to drain */
const BUFFER_HIGH = 4 * 1024 * 1024;
const CODE_MS = 10 * 60_000;
/** A relay may hold this much before the machine's socket opens */
const QUEUE_MAX = 256;
/** An answer with an audit label keeps this much of itself for deps.onUp */
const KEEP_MAX = 256 * 1024;

/** At most 16 short names; anything else is dropped */
function capsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = value.filter(
    (c): c is string => typeof c === "string" && c.length > 0 && c.length <= 16
  );
  return [...new Set(out)].slice(0, 16);
}

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
  private machineWss = new WebSocketServer({
    noServer: true,
    maxPayload: LINK_MAX_FRAME,
  });
  private browserWss = new WebSocketServer({ noServer: true });
  private upCounter: UpCounter;

  constructor(private deps: HubDeps) {
    this.upCounter = new UpCounter(deps.upLimits ?? UP_LIMITS);
  }

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

  /** Tells a connected machine whether this hub's sessions may use it */
  tellAgents(id: string): void {
    const tunnel = this.tunnels.get(id);
    const machine = this.deps.machineById(id);
    if (!tunnel || !machine) return;
    const frame: HubFrame = { t: "agents", allowed: machine.agents === 1 };
    tunnel.ws.send(JSON.stringify(frame));
  }

  /** What a machine may ask of this hub: its two switches and the names */
  private upAllowed(machine: MachineRow): UpAllowed {
    return {
      agents: machine.uses_hub === 1,
      backup: machine.backup === 1,
      name: machine.name,
      hubName: this.deps.serverName(),
    };
  }

  /** Tells a connected machine what it may ask, when a switch or a name changes */
  tellUp(id: string): void {
    const tunnel = this.tunnels.get(id);
    const machine = this.deps.machineById(id);
    if (!tunnel?.caps.has(CAP_UP) || machine?.status !== "approved") return;
    const frame: HubFrame = { t: "up-allowed", ...this.upAllowed(machine) };
    tunnel.ws.send(JSON.stringify(frame));
  }

  /** The same for every connected machine: this server's name changed */
  tellUpAll(): void {
    for (const id of this.tunnels.keys()) this.tellUp(id);
  }

  /** Whether a connected machine named a cap in its hello; null when offline */
  hasCap(id: string, cap: string): boolean | null {
    const tunnel = this.tunnels.get(id);
    return tunnel ? tunnel.caps.has(cap) : null;
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
        caps: new Set(capsOf(hello?.caps)),
        ups: new Map(),
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
        agents: machine.agents === 1,
        caps: [CAP_UP],
        ...(t.caps.has(CAP_UP) ? { up: this.upAllowed(machine) } : {}),
      });
    };

    ws.on("message", (data, isBinary) => {
      if (stage === "open" && tunnel) {
        // Anything it sends shows it is there: a pong can wait behind a
        // large body on the same socket
        tunnel.alive = true;
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
        this.deps.setMachineCaps(machine.id, capsOf(hello.caps));
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
    for (const id of [...tunnel.ups.keys()]) this.endUp(tunnel, id);
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
      if (frame.kind === BIN_UP) {
        if (!tunnel.caps.has(CAP_UP)) return;
        if (frame.data.length > UP_CHUNK) {
          return this.closeTunnel(tunnel, 1009, "chunk too large");
        }
        this.upBody(tunnel, frame.id, frame.data);
      } else if (frame.kind === BIN_BODY) {
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
      case "agents": {
        // Its owner changed it on the machine: only its own switch, and
        // only while it is still approved
        const machine = this.deps.machineById(tunnel.machineId);
        if (machine?.status !== "approved") return;
        if (typeof frame.allowed !== "boolean") return;
        this.deps.setMachineAgents(machine.id, frame.allowed);
        this.tellAgents(machine.id);
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
      case "up":
        if (tunnel.caps.has(CAP_UP)) this.upStart(tunnel, frame);
        return;
      case "up-end":
        if (tunnel.caps.has(CAP_UP)) this.upEnd(tunnel, frame.id);
        return;
      case "up-abort":
        if (tunnel.ups.has(frame.id)) this.endUp(tunnel, frame.id);
        return;
    }
  }

  // --- A machine asks this hub (lib/link/up.ts) ---

  private sendUp(tunnel: Tunnel, frame: HubFrame): void {
    if (tunnel.ws.readyState === WebSocket.OPEN) {
      tunnel.ws.send(JSON.stringify(frame));
    }
  }

  /** A whole answer made here: a refusal, a timeout, an unreachable API */
  private answerUp(
    tunnel: Tunnel,
    id: number,
    status: number,
    body: { error: string; code: string }
  ): void {
    this.sendUp(tunnel, {
      t: "up-res",
      id,
      status,
      headers: { "content-type": "application/json" },
    });
    if (tunnel.ws.readyState === WebSocket.OPEN) {
      tunnel.ws.send(
        encodeBinary(id, BIN_UP, Buffer.from(JSON.stringify(body)))
      );
    }
    this.sendUp(tunnel, { t: "up-res-end", id });
  }

  private refuseUp(tunnel: Tunnel, id: number, refusal: UpRefusal): void {
    this.answerUp(tunnel, id, refusal.status, {
      error: refusal.error,
      code: refusal.code,
    });
  }

  /** Forgets one upward request: its loopback call, timers and count */
  private endUp(tunnel: Tunnel, id: number): void {
    const up = tunnel.ups.get(id);
    if (!up) return;
    tunnel.ups.delete(id);
    if (up.timer) clearTimeout(up.timer);
    if (up.idle) clearTimeout(up.idle);
    up.req?.destroy();
    if (up.decision) this.upCounter.leave(tunnel.machineId, up.kind);
  }

  /** Stops it and tells the machine why: a full answer, or an error after the head */
  private failUp(
    tunnel: Tunnel,
    id: number,
    status: number,
    body: { error: string; code: string }
  ): void {
    const up = tunnel.ups.get(id);
    if (!up) return;
    this.endUp(tunnel, id);
    if (up.answered) {
      this.sendUp(tunnel, { t: "up-res-error", id, message: body.code });
    } else {
      this.answerUp(tunnel, id, status, body);
    }
  }

  private touchUp(tunnel: Tunnel, id: number): void {
    const up = tunnel.ups.get(id);
    if (!up) return;
    if (up.idle) clearTimeout(up.idle);
    const limits = this.deps.upLimits ?? UP_LIMITS;
    up.idle = setTimeout(
      () =>
        this.failUp(tunnel, id, 504, {
          error: UP_LOCAL_ERRORS.timeout.error,
          code: "timeout",
        }),
      limits[up.kind].idleMs
    );
  }

  private upStart(
    tunnel: Tunnel,
    frame: Extract<MachineFrame, { t: "up" }>
  ): void {
    const { id } = frame;
    if (!Number.isInteger(id) || id < 1 || id > 0xffffffff) return;
    if (tunnel.ups.has(id)) {
      return this.sendUp(tunnel, {
        t: "up-res-error",
        id,
        message: "duplicate id",
      });
    }
    // Re-read: a switch flipped since the last request applies to this one
    const machine = this.deps.machineById(tunnel.machineId);
    const decision = decideUp(this.deps.upRules(), machine, frame, {
      port: this.deps.localPort(),
      proof: this.deps.linkProof(),
    });
    if (!decision.ok) {
      if (machine?.status === "approved") {
        try {
          this.deps.onUpRefused?.(machine, decision);
        } catch (error) {
          console.error("[link] onUpRefused failed:", error);
        }
      }
      return this.refuseUp(tunnel, id, decision);
    }
    const kind = decision.rule.kind;
    if (!this.upCounter.enter(tunnel.machineId, kind, Date.now())) {
      return this.refuseUp(tunnel, id, upRefusal("too_many"));
    }
    const up: UpPending = {
      kind,
      req: null,
      chunks: [],
      bytes: 0,
      rule: decision.rule,
      decision,
      receiver: new CreditReceiver({
        window: UP_WINDOW,
        grant: (bytes) => this.sendUp(tunnel, { t: "up-credit", id, bytes }),
        overrun: () => this.closeTunnel(tunnel, 1009, "window overrun"),
      }),
      timer: null,
      idle: null,
      answered: false,
      answerBytes: 0,
      kept: [],
      keptBytes: 0,
      sent: undefined,
    };
    tunnel.ups.set(id, up);
    const veto = this.deps.beforeUp?.(decision, machine!);
    if (veto) {
      this.endUp(tunnel, id);
      return this.refuseUp(tunnel, id, veto);
    }
    this.touchUp(tunnel, id);
    // Copies stream straight through; an agent's body is read whole first
    if (kind === "system") this.upAsk(tunnel, id, decision.headers, null);
  }

  private upBody(tunnel: Tunnel, id: number, chunk: Buffer): void {
    const up = tunnel.ups.get(id);
    if (!up?.rule) return;
    up.receiver.received(chunk.length);
    if (!tunnel.ups.has(id)) return;
    this.touchUp(tunnel, id);
    up.bytes += chunk.length;
    if (up.bytes > up.rule.maxBody) {
      const refusal = upRefusal("too_large");
      return this.failUp(tunnel, id, refusal.status, {
        error: refusal.error,
        code: refusal.code,
      });
    }
    if (up.kind === "agent") {
      up.chunks.push(chunk);
      return;
    }
    up.req?.write(chunk, () => up.receiver.consumed(chunk.length));
  }

  private upEnd(tunnel: Tunnel, id: number): void {
    const up = tunnel.ups.get(id);
    if (!up?.rule || !up.decision) return;
    this.touchUp(tunnel, id);
    const rule = up.rule;
    // The head may already be here (a system call answered early)
    if (!up.answered) {
      // Until the head, only rule.headMs counts: a rule may wait longer
      // than the idle limit (the idle timer starts again with the head)
      if (up.idle) clearTimeout(up.idle);
      up.idle = null;
      up.timer = setTimeout(
        () =>
          this.failUp(tunnel, id, 504, {
            error: UP_LOCAL_ERRORS.timeout.error,
            code: "timeout",
          }),
        rule.headMs
      );
    }
    if (up.kind === "system") {
      up.req?.end();
      return;
    }
    // Agent: only what the rule builds is sent on, never the machine's bytes
    let body: Buffer | null = null;
    if (rule.body) {
      let input: unknown;
      try {
        const raw = Buffer.concat(up.chunks).toString("utf8");
        input = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        const refusal = upRefusal("bad_request");
        return this.failUp(tunnel, id, refusal.status, {
          error: refusal.error,
          code: refusal.code,
        });
      }
      const machine = this.deps.machineById(tunnel.machineId);
      if (!machine) {
        const refusal = upRefusal("machine_unknown");
        return this.failUp(tunnel, id, refusal.status, {
          error: refusal.error,
          code: refusal.code,
        });
      }
      const built = rule.body(input, {
        machine,
        targetMachineId: up.decision.targetMachineId,
        pathname: up.decision.path.split("?")[0],
      });
      if ("ok" in built && built.ok === false) {
        return this.failUp(tunnel, id, built.status, {
          error: built.error,
          code: built.code,
        });
      }
      up.sent = (built as { body: unknown }).body;
      body = Buffer.from(JSON.stringify(up.sent));
    }
    up.chunks = [];
    const headers = { ...up.decision.headers };
    delete headers["content-type"];
    delete headers["content-length"];
    if (body) headers["content-type"] = "application/json";
    if (body || rule.method !== "GET") {
      headers["content-length"] = String(body?.length ?? 0);
    }
    this.upAsk(tunnel, id, headers, body);
  }

  /** The loopback call to this server's own API; streams the answer back */
  private upAsk(
    tunnel: Tunnel,
    id: number,
    headers: Record<string, string>,
    body: Buffer | null
  ): void {
    const up = tunnel.ups.get(id);
    if (!up?.decision || !up.rule) return;
    const rule = up.rule;
    const decision = up.decision;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: this.deps.localPort(),
        method: rule.method,
        path: decision.path,
        headers,
      },
      (response) => {
        if (tunnel.ups.get(id) !== up) return void response.resume();
        if (up.timer) clearTimeout(up.timer);
        up.timer = null;
        up.answered = true;
        this.touchUp(tunnel, id);
        const status = response.statusCode ?? 502;
        this.sendUp(tunnel, {
          t: "up-res",
          id,
          status,
          headers: responseHeadersFromLink(response.headers),
        });
        const json = /json/.test(String(response.headers["content-type"]));
        response.on("data", (chunk: Buffer) => {
          if (tunnel.ups.get(id) !== up) return;
          this.touchUp(tunnel, id);
          up.answerBytes += chunk.length;
          if (up.answerBytes > UP_ANSWER_MAX) {
            return this.failUp(tunnel, id, 502, {
              error: "too large",
              code: "too_large",
            });
          }
          if (rule.action && json && up.keptBytes < KEEP_MAX) {
            up.kept.push(chunk);
            up.keptBytes += chunk.length;
          }
          for (let at = 0; at < chunk.length; at += UP_CHUNK) {
            if (tunnel.ws.readyState !== WebSocket.OPEN) return;
            tunnel.ws.send(
              encodeBinary(id, BIN_UP, chunk.subarray(at, at + UP_CHUNK))
            );
          }
          // A large answer waits for the link, so pings still get through
          if (tunnel.ws.bufferedAmount > BUFFER_HIGH) {
            response.pause();
            const drain = setInterval(() => {
              if (
                tunnel.ws.readyState !== WebSocket.OPEN ||
                tunnel.ws.bufferedAmount < BUFFER_HIGH / 4 ||
                tunnel.ups.get(id) !== up
              ) {
                clearInterval(drain);
                response.resume();
              }
            }, 50);
          }
        });
        response.on("end", () => {
          if (tunnel.ups.get(id) !== up) return;
          up.req = null;
          this.endUp(tunnel, id);
          this.sendUp(tunnel, { t: "up-res-end", id });
          if (rule.action && this.deps.onUp) this.reportUp(tunnel, up, status);
        });
        response.on("error", () =>
          this.failUp(tunnel, id, 502, {
            error: UP_LOCAL_ERRORS.link_dropped.error,
            code: "link_dropped",
          })
        );
      }
    );
    req.on("error", () =>
      this.failUp(tunnel, id, 502, {
        error: "The server couldn't answer",
        code: "hub_unreachable",
      })
    );
    up.req = req;
    if (up.kind === "agent") req.end(body ?? undefined);
  }

  private reportUp(tunnel: Tunnel, up: UpPending, status: number): void {
    const machine = this.deps.machineById(tunnel.machineId);
    if (!machine || !up.rule || !up.decision) return;
    let answer: unknown = null;
    try {
      answer = JSON.parse(Buffer.concat(up.kept).toString("utf8"));
    } catch {
      // Not JSON, or more than was kept
    }
    try {
      this.deps.onUp?.({
        machine,
        rule: up.rule,
        targetMachineId: up.decision.targetMachineId,
        pathname: up.decision.path.split("?")[0],
        status,
        sent: up.sent,
        answer,
      });
    } catch (error) {
      console.error("[link] onUp failed:", error);
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
      timer: setTimeout(
        () => {
          if (tunnel.requests.delete(id)) {
            send({ t: "abort", id });
            this.failResponse(pending, 504, "The machine took too long");
          }
        },
        MOVE_PATH.test(options.path) ? MOVE_HEAD_MS : HEAD_MS
      ),
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
      if (tunnel.ws.readyState !== WebSocket.OPEN) return;
      tunnel.ws.send(encodeBinary(id, BIN_BODY, chunk));
      if (tunnel.ws.bufferedAmount > BUFFER_HIGH) {
        req.pause();
        const drain = setInterval(() => {
          if (
            tunnel.ws.readyState !== WebSocket.OPEN ||
            tunnel.ws.bufferedAmount < BUFFER_HIGH / 4
          ) {
            clearInterval(drain);
            req.resume();
          }
        }, 50);
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
