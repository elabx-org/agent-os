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
import { requireUser } from "../user-proof";
import { LinkHub } from "./hub";
import { receiveNotice } from "./notices";
import { LINK_PATH } from "./protocol";
import * as store from "./store";

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

export function linkHub(): LinkHub {
  shared.__agentosLinkHub ??= new LinkHub({
    ...store,
    sha: ownSha,
    onNotice: receiveNotice,
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

function approved(machineId: string): boolean {
  return store.machineById(machineId)?.status === "approved";
}

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
  if (!approved(target.machineId)) {
    res.writeHead(404, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({ error: "No such machine", code: "machine_unknown" })
    );
    return true;
  }
  linkHub().forwardRequest(target.machineId, req, res, {
    path: target.path,
    user: isUser(req),
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
  if (!approved(target.machineId)) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }
  linkHub().forwardUpgrade(target.machineId, request, socket, head, {
    path: target.path,
    user: isUser(request),
  });
  return true;
}
