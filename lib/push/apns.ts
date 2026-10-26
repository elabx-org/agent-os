/**
 * Apple Push Notification service, token-based (.p8 key):
 * https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 */

import fs from "fs";
import http2 from "http2";
import { createPrivateKey, sign } from "crypto";
import { apnsKeyFile, type PushConfig, type PushDevice } from "./config";
import { isUrgent, type PushMessage } from "./send";

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

let cachedJwt: { token: string; at: number; keyId: string } | null = null;

function jwt(apns: PushConfig["apns"]): string {
  // Apple accepts a token for an hour and rejects refreshing more than every 20 minutes
  if (
    cachedJwt &&
    cachedJwt.keyId === apns.keyId &&
    Date.now() - cachedJwt.at < 40 * 60_000
  ) {
    return cachedJwt.token;
  }
  const b64 = (v: object | Buffer) =>
    (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString(
      "base64url"
    );
  const unsigned = `${b64({ alg: "ES256", kid: apns.keyId })}.${b64({
    iss: apns.teamId,
    iat: Math.floor(Date.now() / 1000),
  })}`;
  const key = createPrivateKey(fs.readFileSync(apnsKeyFile()));
  const signature = sign("sha256", Buffer.from(unsigned), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  cachedJwt = {
    token: `${unsigned}.${b64(signature)}`,
    at: Date.now(),
    keyId: apns.keyId,
  };
  return cachedJwt.token;
}

function post(
  host: string,
  path: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; reason?: string }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(host);
    client.on("error", reject);
    const req = client.request({
      ":method": "POST",
      ":path": path,
      ...headers,
    });
    let status = 0;
    let data = "";
    req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on("response", (h) => (status = Number(h[":status"])));
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      client.close();
      let reason: string | undefined;
      try {
        reason = data ? JSON.parse(data).reason : undefined;
      } catch {}
      resolve({ status, reason });
    });
    req.on("error", (err) => {
      client.close();
      reject(err);
    });
    req.end(body);
  });
}

export type ApnsResult = "sent" | "gone" | "failed";

/**
 * Sends to one device. Development-signed builds only work against the
 * sandbox, so an unknown device tries production first, then the sandbox.
 */
export async function sendApns(
  apns: PushConfig["apns"],
  device: PushDevice,
  message: PushMessage
): Promise<{ result: ApnsResult; sandbox?: boolean; reason?: string }> {
  const payload = JSON.stringify({
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      "thread-id": message.sessionId ?? "agent-os",
      "interruption-level": isUrgent(message.kind)
        ? "time-sensitive"
        : "active",
    },
    sessionId: message.sessionId,
  });
  const headers = {
    authorization: `bearer ${jwt(apns)}`,
    "apns-topic": apns.bundleId,
    "apns-push-type": "alert",
    "apns-priority": "10",
  };
  const order = device.sandbox === undefined ? [false, true] : [device.sandbox];
  let last: { status: number; reason?: string } = { status: 0 };
  for (const sandbox of order) {
    last = await post(
      sandbox ? HOSTS.sandbox : HOSTS.production,
      `/3/device/${device.token}`,
      headers,
      payload
    );
    if (last.status === 200) return { result: "sent", sandbox };
    // The token belongs to the other environment
    if (last.reason === "BadDeviceToken" && order.length > 1) continue;
    break;
  }
  if (last.status === 410 || last.reason === "Unregistered") {
    return { result: "gone", reason: last.reason };
  }
  return { result: "failed", reason: last.reason ?? `HTTP ${last.status}` };
}
