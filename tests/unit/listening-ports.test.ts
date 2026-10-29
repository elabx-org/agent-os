import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLoopbackReachable,
  parseProcNetTcp,
  parseSs,
} from "../../lib/listening-ports";

// Lines as this container's `ss -ltnpH` prints them
const SS = `LISTEN 0      5         0.0.0.0:8790  0.0.0.0:* users:(("python3",pid=3090788,fd=3))
LISTEN 0      511       0.0.0.0:8443  0.0.0.0:* users:(("node",pid=219,fd=19))
LISTEN 0      4096   127.0.0.11:37695 0.0.0.0:*
LISTEN 0      511             *:3011        *:* users:(("node",pid=3340175,fd=47))
LISTEN 0      511         [::1]:5173     [::]:* users:(("node",pid=42,fd=20),("node",pid=43,fd=20))
LISTEN 0      511     127.0.0.1:5173  0.0.0.0:* users:(("node",pid=42,fd=21))
LISTEN 0      128      10.0.0.5:9000  0.0.0.0:* users:(("lan",pid=7,fd=3))
LISTEN 0      128          [::]:22         [::]:*
garbage line
`;

test("parseSs: loopback-reachable ports, grouped, with processes", () => {
  assert.deepEqual(parseSs(SS), [
    { port: 22, addresses: ["[::]"], processes: [] },
    {
      port: 3011,
      addresses: ["*"],
      processes: [{ name: "node", pid: 3340175 }],
    },
    {
      port: 5173,
      addresses: ["[::1]", "127.0.0.1"],
      processes: [
        { name: "node", pid: 42 },
        { name: "node", pid: 43 },
      ],
    },
    {
      port: 8443,
      addresses: ["0.0.0.0"],
      processes: [{ name: "node", pid: 219 }],
    },
    {
      port: 8790,
      addresses: ["0.0.0.0"],
      processes: [{ name: "python3", pid: 3090788 }],
    },
  ]);
});

test("isLoopbackReachable: not Docker's DNS or a LAN-only bind", () => {
  assert.ok(!isLoopbackReachable("127.0.0.11"));
  assert.ok(!isLoopbackReachable("10.0.0.5"));
  assert.ok(isLoopbackReachable("[::ffff:127.0.0.1]"));
  assert.ok(isLoopbackReachable("*"));
});

test("parseProcNetTcp: LISTEN rows only, little-endian IPv4", () => {
  const text = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1
   1: 00000000:0BC3 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1
   2: 0B00007F:934F 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1
   3: 0100007F:1F90 0100007F:D2F0 01 00000000:00000000 00:00000000 00000000  1000        0 1 1
`;
  assert.deepEqual(parseProcNetTcp(text), [
    { port: 3011, addresses: ["0.0.0.0"], processes: [] },
    { port: 5173, addresses: ["127.0.0.1"], processes: [] },
  ]);
});
