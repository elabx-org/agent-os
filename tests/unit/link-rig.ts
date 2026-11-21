/**
 * A hub and a machine on loopback, joined by a real link, for the link
 * tests. The hub's own API (where a machine's upward requests are asked)
 * is a third loopback server the test can supply.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import {
  LinkClient,
  type LinkClientOptions,
  type LinkState,
} from "../../lib/link/client";
import { LinkHub, type HubDeps } from "../../lib/link/hub";
import { generateMachineKey, type MachineKey } from "../../lib/link/keys";
import { LINK_PATH } from "../../lib/link/protocol";
import type { MachineRow } from "../../lib/link/store";
import { BASE_UP_RULES } from "../../lib/link/up";

export const TEST_PROOF = "p".repeat(64);

export function memoryDeps(): HubDeps & {
  rows: Map<string, MachineRow>;
  port: number;
} {
  const rows = new Map<string, MachineRow>();
  const deps = {
    rows,
    port: 0,
    machineByKey: (key: string) =>
      [...rows.values()].find((r) => r.public_key === key) ?? null,
    machineById: (id: string) => rows.get(id) ?? null,
    createPendingMachine: (input: {
      name: string;
      publicKey: string;
      platform: string;
      sha: string | null;
      signedInAs: string | null;
    }) => {
      const row: MachineRow = {
        id: `m_${String(rows.size + 1).padStart(12, "0")}`,
        name: input.name,
        public_key: input.publicKey,
        status: "pending",
        platform: input.platform,
        sha: input.sha,
        signed_in_as: input.signedInAs,
        created_at: 1,
        approved_at: null,
        last_seen: null,
        agents: 0,
        uses_hub: 0,
        backup: 0,
        caps: null,
      };
      rows.set(row.id, row);
      return row;
    },
    touchMachine: () => {},
    approveMachine: (id: string) => {
      const row = rows.get(id);
      if (row) row.status = "approved";
      return row ?? null;
    },
    removeMachine: (id: string) => rows.delete(id),
    setMachineAgents: (id: string, allowed: boolean) => {
      const row = rows.get(id);
      if (row) row.agents = allowed ? 1 : 0;
    },
    setMachineCaps: (id: string, caps: string[]) => {
      const row = rows.get(id);
      if (row) row.caps = JSON.stringify(caps);
    },
    sha: () => "hubsha",
    localPort: () => deps.port,
    linkProof: () => TEST_PROOF,
    upRules: () => BASE_UP_RULES,
    serverName: () => "Unraid",
  };
  return deps;
}

export const MACHINE_ID = "m_000000000001";

export const listen = (server: http.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port)
    )
  );

export async function rig(
  options: {
    deps?: Partial<HubDeps>;
    /** The hub's own API; by default it echoes what it was asked */
    hubApi?: http.RequestListener;
  } = {}
) {
  const deps = Object.assign(memoryDeps(), options.deps ?? {});
  const hub = new LinkHub(deps);
  const seen: http.IncomingMessage[] = [];

  // The machine's AgentOS: echoes what it was sent
  const machineServer = http.createServer((req, res) => {
    seen.push(req);
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(req.url === "/api/missing" ? 404 : 200, {
        "content-type": "application/json",
        "set-cookie": "machine=secret",
      });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          host: req.headers.host,
          cookie: req.headers.cookie ?? null,
          agent: req.headers["x-agentos-origin"] ?? null,
          body: Buffer.concat(chunks).toString(),
        })
      );
    });
  });
  const machineWss = new WebSocketServer({ server: machineServer });
  machineWss.on("connection", (socket, request) => {
    socket.send(`hello ${request.url} ${request.headers.cookie ?? "-"}`);
    socket.on("message", (data, isBinary) =>
      socket.send(data, { binary: isBinary })
    );
  });
  const machinePort = await listen(machineServer);

  // The hub's own API, asked on loopback for a machine's upward requests
  const apiSeen: http.IncomingMessage[] = [];
  const apiServer = http.createServer((req, res) => {
    apiSeen.push(req);
    if (options.hubApi) return options.hubApi(req, res);
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "hub=secret",
      });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        })
      );
    });
  });
  deps.port = await listen(apiServer);

  let target = MACHINE_ID;
  const hubServer = http.createServer((req, res) => {
    hub.forwardRequest(target, req, res, {
      path: req.url!.replace(/^\/m/, ""),
      user: req.headers["x-test-user"] === "1",
    });
  });
  hubServer.on("upgrade", (request, socket, head) => {
    if (request.url === LINK_PATH)
      return hub.handleUpgrade(request, socket, head);
    hub.forwardUpgrade(target, request, socket, head, {
      path: request.url!,
      user: true,
    });
  });
  const hubPort = await listen(hubServer);

  const states: LinkState[] = [];
  const waiters: { want: string; done: (s: LinkState) => void }[] = [];
  const until = (want: LinkState["status"]) =>
    new Promise<LinkState>((resolve, reject) => {
      const hit = states.find((s) => s.status === want);
      if (hit) return resolve(hit);
      waiters.push({ want, done: resolve });
      setTimeout(
        () => reject(new Error(`never ${want}: ${JSON.stringify(states)}`)),
        4000
      );
    });
  const key = generateMachineKey();
  const client = (
    code?: string,
    withKey: MachineKey = key,
    extra: Partial<LinkClientOptions> = {}
  ) =>
    new LinkClient({
      hubUrl: `http://127.0.0.1:${hubPort}`,
      key: withKey,
      name: "Test Mac",
      localPort: machinePort,
      sha: "macsha",
      code,
      userCookie: () => "agentos_u=proof",
      onState: (state) => {
        states.push(state);
        for (const w of [...waiters]) {
          if (w.want === state.status) {
            waiters.splice(waiters.indexOf(w), 1);
            w.done(state);
          }
        }
      },
      ...extra,
    });
  /** A machine added, approved and connected */
  const linked = async (extra: Partial<LinkClientOptions> = {}) => {
    const c = client(hub.createPairingCode().code, key, extra);
    c.start();
    await until("pending");
    hub.approve(MACHINE_ID);
    await until("linked");
    return c;
  };
  const close = async () => {
    machineWss.close();
    hubServer.closeAllConnections();
    machineServer.closeAllConnections();
    apiServer.closeAllConnections();
    await Promise.all([
      new Promise((r) => hubServer.close(r)),
      new Promise((r) => machineServer.close(r)),
      new Promise((r) => apiServer.close(r)),
    ]);
  };
  return {
    hub,
    deps,
    key,
    client,
    linked,
    until,
    states,
    close,
    hubPort,
    seen,
    apiSeen,
    setTarget: (id: string) => (target = id),
  };
}
