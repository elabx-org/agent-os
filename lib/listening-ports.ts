/**
 * TCP ports listening in the container that the port proxy can reach
 * (loopback or wildcard addresses), with the process behind each when the
 * kernel shows it (only for this user's processes).
 */

import { execFile } from "child_process";
import fs from "fs";

export interface ListeningPort {
  port: number;
  addresses: string[];
  processes: { name: string; pid: number }[];
}

/** Addresses connectLoopback (127.0.0.1, then ::1) can reach */
export function isLoopbackReachable(address: string): boolean {
  const a = address.toLowerCase().replace(/%.*$/, "");
  return (
    a === "*" ||
    a === "0.0.0.0" ||
    a === "[::]" ||
    a === "::" ||
    a === "127.0.0.1" ||
    a === "[::1]" ||
    a === "::1" ||
    a === "[::ffff:127.0.0.1]" ||
    a === "::ffff:127.0.0.1" ||
    a === "[::ffff:0.0.0.0]"
  );
}

/** "0.0.0.0:8790", "*:3011", "[::1]:5173" -> [address, port] */
function splitLocal(local: string): [string, number] | null {
  const at = local.lastIndexOf(":");
  if (at <= 0) return null;
  const port = Number(local.slice(at + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return [local.slice(0, at), port];
}

function addTo(
  byPort: Map<number, ListeningPort>,
  port: number,
  address: string,
  processes: { name: string; pid: number }[]
): void {
  const entry = byPort.get(port) ?? { port, addresses: [], processes: [] };
  if (!entry.addresses.includes(address)) entry.addresses.push(address);
  for (const proc of processes) {
    if (!entry.processes.some((p) => p.pid === proc.pid)) {
      entry.processes.push(proc);
    }
  }
  byPort.set(port, entry);
}

/** Parses `ss -ltnpH`; only loopback-reachable addresses, sorted by port */
export function parseSs(text: string): ListeningPort[] {
  const byPort = new Map<number, ListeningPort>();
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0] !== "LISTEN") continue;
    const local = splitLocal(fields[3]);
    if (!local || !isLoopbackReachable(local[0])) continue;
    const processes: { name: string; pid: number }[] = [];
    const users = /users:\((.*)\)\s*$/.exec(line);
    if (users) {
      for (const match of users[1].matchAll(/\("([^"]*)",pid=(\d+)/g)) {
        processes.push({ name: match[1], pid: Number(match[2]) });
      }
    }
    addTo(byPort, local[1], local[0], processes);
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function hexToAddress(hex: string): string {
  if (hex.length === 8) {
    // Little-endian IPv4
    const bytes = hex
      .match(/../g)!
      .map((b) => parseInt(b, 16))
      .reverse();
    return bytes.join(".");
  }
  if (/^0{32}$/.test(hex)) return "[::]";
  if (hex === "00000000000000000000000001000000") return "[::1]";
  if (hex === "0000000000000000FFFF00000100007F") return "[::ffff:127.0.0.1]";
  return `[${hex}]`;
}

/** /proc/net/tcp{,6} (state 0A = LISTEN), when ss is missing; no processes */
export function parseProcNetTcp(text: string): ListeningPort[] {
  const byPort = new Map<number, ListeningPort>();
  for (const line of text.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || fields[3] !== "0A") continue;
    const [hexAddress, hexPort] = fields[1].split(":");
    if (!hexAddress || !hexPort) continue;
    const address = hexToAddress(hexAddress.toUpperCase());
    if (!isLoopbackReachable(address)) continue;
    addTo(byPort, parseInt(hexPort, 16), address, []);
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function mergePorts(lists: ListeningPort[][]): ListeningPort[] {
  const byPort = new Map<number, ListeningPort>();
  for (const list of lists) {
    for (const entry of list) {
      for (const address of entry.addresses) {
        addTo(byPort, entry.port, address, entry.processes);
      }
    }
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function fromProc(): ListeningPort[] {
  const lists: ListeningPort[][] = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      lists.push(parseProcNetTcp(fs.readFileSync(file, "utf8")));
    } catch {
      // No IPv6 table: fine
    }
  }
  return mergePorts(lists);
}

const CACHE_MS = 2000;
const shared = globalThis as typeof globalThis & {
  __agentosListeningPorts?: { at: number; ports: Promise<ListeningPort[]> };
};

/** The container's listening ports; cached 2s */
export function listListeningPorts(): Promise<ListeningPort[]> {
  const cached = shared.__agentosListeningPorts;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.ports;
  const ports = new Promise<ListeningPort[]>((resolve) => {
    execFile("ss", ["-ltnpH"], { timeout: 3000 }, (error, stdout) => {
      resolve(error ? fromProc() : parseSs(stdout));
    });
  });
  shared.__agentosListeningPorts = { at: Date.now(), ports };
  return ports;
}
