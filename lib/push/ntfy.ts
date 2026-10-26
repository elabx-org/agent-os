import type { PushConfig } from "./config";
import { isUrgent, type PushMessage } from "./send";

/** Publishes to ntfy (https://docs.ntfy.sh/publish/) */
export async function sendNtfy(
  ntfy: PushConfig["ntfy"],
  message: PushMessage
): Promise<void> {
  const headers: Record<string, string> = {
    Title: encodeHeader(message.title),
    Tags: isUrgent(message.kind) ? "warning" : "white_check_mark",
    Priority: isUrgent(message.kind) ? "high" : "default",
  };
  if (message.appUrl) headers.Click = message.appUrl;
  if (message.webUrl) {
    headers.Actions = `view, Open in browser, ${message.webUrl}`;
  }
  if (ntfy.token) headers.Authorization = `Bearer ${ntfy.token}`;

  const url = `${ntfy.server.replace(/\/+$/, "")}/${encodeURIComponent(ntfy.topic)}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: message.body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`ntfy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// Header values must be Latin-1; ntfy decodes RFC 2047 encoded words
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}
