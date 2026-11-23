/**
 * server.ts's entry points for linked machines on the hub: the address a
 * machine dials, and the rule that sends a signed-in request to a machine
 * instead of answering it here. All of it is off unless the "machines"
 * flag is on.
 */

import { execFileSync } from "child_process";
import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";
import { getFlag } from "../flags";
import { hasUserCookie, requireUser } from "../user-proof";
import { LinkHub } from "./hub";
import { receiveNotice } from "./notices";
import { LINK_PATH } from "./protocol";
import * as store from "./store";
import { BASE_UP_RULES } from "./up";
import { AGENT_UP_RULES } from "./up-agent-rules";
import { BACKUP_UP_RULES } from "./up-backup-rules";
import { announceRefusal, announceUp } from "./up-announce";
import { linkProof } from "./up-guard";
import { OWN_PROOF_HEADER, isOwnCall } from "./own-proof";
import { allowStartDown, beforeUp } from "./up-policy";
import { CHAIN_HEADER } from "./from-machine";
import {
  SETUP_PATH,
  SETUP_PROOF_HEADER,
  isSetupProof,
} from "../claude-setup/proof";
import { getDb } from "../db";
import { depthOfActor } from "../session-started-by";
import { onTakenAck, takenFor } from "../backup/taken";
import { onMachineBack } from "../backup/takes";

// server.ts and the Next route bundles are separate module graphs in one
// process: the hub (with its live connections) lives on globalThis
const shared = globalThis as typeof globalThis & {
  __agentosLinkHub?: LinkHub;
  __agentosSha?: string | null;
};

/** The commit this copy runs, so a machine can match the hub's */
export function ownSha(): string | null {
  if (shared.__agentosSha === undefined) {
    try {
      shared.__agentosSha =
        process.env.AGENTOS_SHA ||
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() ||
        null;
    } catch {
      shared.__agentosSha = null;
    }
  }
  return shared.__agentosSha;
}

/**
 * What a machine may ask: hello, the agent table, and its AgentOS's own
 * copies (lib/backup)
 */
const UP_RULES = [...BASE_UP_RULES, ...AGENT_UP_RULES, ...BACKUP_UP_RULES];

export function linkHub(): LinkHub {
  shared.__agentosLinkHub ??= new LinkHub({
    ...store,
    sha: ownSha,
    onNotice: receiveNotice,
    // The same port lib/link/move.ts asks on
    localPort: () => Number(process.env.PORT || "3011"),
    linkProof,
    upRules: () => UP_RULES,
    serverName: store.serverName,
    setMachineCaps: store.setMachineCaps,
    beforeUp: (decision, machine) =>
      beforeUp(decision, machine, {
        hasCap: (id, cap) => shared.__agentosLinkHub?.hasCap(id, cap) ?? null,
      }),
    onUp: announceUp,
    onUpRefused: announceRefusal,
    // Copies of its sessions (lib/backup): what it must pause on connect
    takenFor: (machine) => takenFor(machine),
    onTakenAck: (machine, results) => onTakenAck(machine, results),
    onMachineBack,
  });
  return shared.__agentosLinkHub;
}

export const machinesOn = () => getFlag("machines");

/** Which machine a tab is looking at: sent by our pages on every call */
export const MACHINE_HEADER = "x-agentos-machine";
/** The same, for what a page can't put a header on (images, sockets) */
export const MACHINE_COOKIE = "agentos_machine";
export const MACHINE_QUERY = "machine";

const MACHINE_ID = /^m_[0-9a-f]{12}$/;
/**
 * A tab's way of saying "this server", whatever the cookie (shared by all
 * tabs) names. Reserved: never a machine's id.
 */
export const HUB_MARKER = "hub";

/**
 * API areas that are about the hub or this device, whichever machine the
 * tab is looking at: signing in, the machines themselves, this device's
 * notifications and logs, the hub's own switches.
 */
const HUB_ONLY = [
  "/api/machines",
  "/api/link",
  "/api/user-proof",
  "/api/client-log",
  "/api/push",
  "/api/notifications",
  "/api/build",
  // A machine's own way up to its hub: never asked of a machine from here
  "/api/hub",
];

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.split(",")[0].trim() || null;

function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export interface MachineTarget {
  machineId: string;
  /** The path on the machine, with its query */
  path: string;
}

/**
 * Pure: where a request is headed. "/m/<id>/api/..." names a machine
 * outright (the hub's own pages use it to read another machine's lists);
 * otherwise the tab's marker decides, for API and socket paths only.
 */
export function machineTarget(
  pathname: string,
  search: string,
  marker: string | null
): MachineTarget | null {
  const explicit = pathname.match(/^\/m\/([^/]+)(\/(?:api|ws)\/.*)$/);
  if (explicit) {
    return MACHINE_ID.test(explicit[1])
      ? { machineId: explicit[1], path: explicit[2] + search }
      : null;
  }
  if (!marker || marker === HUB_MARKER || !MACHINE_ID.test(marker)) return null;
  if (!pathname.startsWith("/api/") && !pathname.startsWith("/ws/")) {
    return null;
  }
  if (HUB_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }
  return { machineId: marker, path: pathname + search };
}

/** The query without the marker the page added for a socket */
function searchWithoutMarker(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete(MACHINE_QUERY);
  const text = params.toString();
  return text ? `?${text}` : "";
}

function targetOf(req: IncomingMessage, url: URL): MachineTarget | null {
  const marker =
    first(req.headers[MACHINE_HEADER]) ??
    url.searchParams.get(MACHINE_QUERY) ??
    cookie(req, MACHINE_COOKIE);
  return machineTarget(url.pathname, searchWithoutMarker(url), marker);
}

/** The hub's word that this is the user's own browser, not an agent */
function isUser(req: IncomingMessage): boolean {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  return requireUser(new Request("http://hub/", { headers })).ok;
}

/** Carries this boot's proof cookie: the user's own browser, not a tool */
function fromBrowser(req: IncomingMessage): boolean {
  const headers = new Headers();
  for (const name of ["cookie", "x-agentos-origin"]) {
    const value = req.headers[name];
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join("; ") : value);
    }
  }
  return hasUserCookie(new Request("http://hub/", { headers }));
}

type Entry = "ok" | "unknown" | "agents_off";

/**
 * Whether a request may go to a machine: it must be approved, and anything
 * that isn't the user's browser (a session's tool, a script on this server)
 * only when the user has let this server's sessions use that machine
 */
export function machineEntry(
  machine: Pick<store.MachineRow, "status" | "agents"> | null,
  browser: boolean
): Entry {
  if (machine?.status !== "approved") return "unknown";
  return browser || machine.agents === 1 ? "ok" : "agents_off";
}

/**
 * This server's own "keep matching" calls (lib/claude-setup/hub.ts): its
 * per-boot proof, and only for a machine's Claude setup routes
 */
const ownSetupCall = (req: IncomingMessage, path: string) =>
  SETUP_PATH.test(path) && isSetupProof(first(req.headers[SETUP_PROOF_HEADER]));

/** This server's own calls to a machine's inbox (lib/link/own-proof.ts) */
const ownInboxCall = (req: IncomingMessage, path: string) =>
  isOwnCall(path, first(req.headers[OWN_PROOF_HEADER]));

const entryOf = (machineId: string, req: IncomingMessage, path: string) =>
  machineEntry(
    store.machineById(machineId),
    fromBrowser(req) || ownSetupCall(req, path) || ownInboxCall(req, path)
  );

/**
 * "no_proof" is what the page's own calls retry on after fetching a fresh
 * proof cookie (it goes stale when this server restarts)
 */
const AGENTS_OFF = JSON.stringify({
  error:
    "Sessions on this server aren't allowed to use this machine. The user can allow it in AgentOS: Settings, Machines.",
  code: "machine_agents_off",
  reason: "no_proof",
});

/**
 * server.ts, after the sign-in check: answers from a machine when the
 * request is headed to one. Returns false to carry on here.
 */
export function linkRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): boolean {
  if (!machinesOn()) return false;
  const target = targetOf(req, url);
  if (!target) return false;
  const entry = entryOf(target.machineId, req, target.path);
  if (entry === "unknown") {
    res.writeHead(404, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({ error: "No such machine", code: "machine_unknown" })
    );
    return true;
  }
  if (entry === "agents_off") {
    res.writeHead(403, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(AGENTS_OFF);
    return true;
  }
  if (!fromBrowser(req)) {
    // A start that isn't the user's: the same limits a machine's starts
    // have here (lib/link/up-policy.ts)
    if (
      req.method === "POST" &&
      /^\/api\/sessions(\?|$)/.test(target.path) &&
      !allowStartDown(target.machineId)
    ) {
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          error:
            "Too many sessions started on that machine in a short time. Wait a minute and try again.",
          code: "too_many",
        })
      );
      return true;
    }
    // How far along a chain of cross-machine starts the asking session is,
    // so the machine can stop the chain (lib/session-started-by.ts)
    if (!req.headers[CHAIN_HEADER]) {
      req.headers[CHAIN_HEADER] = String(
        depthOfActor(first(req.headers["x-agentos-actor"]), getDb())
      );
    }
  }
  linkHub().forwardRequest(target.machineId, req, res, {
    path: target.path,
    user: isUser(req),
    own: ownInboxCall(req, target.path),
  });
  return true;
}

/** server.ts upgrade handler, before the sign-in check: a machine dialing in */
export function linkDialIn(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  pathname: string
): boolean {
  if (pathname !== LINK_PATH) return false;
  // Never from a browser page: machines send no Origin
  if (!machinesOn() || request.headers.origin) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }
  linkHub().handleUpgrade(request, socket, head);
  return true;
}

/** server.ts upgrade handler, after the sign-in check: a socket headed to a machine */
export function linkUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
): boolean {
  if (!machinesOn()) return false;
  const url = new URL(request.url ?? "/", "http://hub");
  const target = targetOf(request, url);
  if (!target) return false;
  const entry = entryOf(target.machineId, request, "");
  if (entry !== "ok") {
    socket.write(
      entry === "unknown"
        ? "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"
        : "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"
    );
    socket.destroy();
    return true;
  }
  linkHub().forwardUpgrade(target.machineId, request, socket, head, {
    path: target.path,
    user: isUser(request),
  });
  return true;
}
