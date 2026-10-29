import { hasApnsKey, readPushConfig, writePushConfig } from "./config";
import { sendNtfy } from "./ntfy";
import { sendApns } from "./apns";

export interface PushMessage {
  kind:
    | "needsYou"
    | "finished"
    | "agentNeedsYou"
    | "agentFinished"
    | "limited"
    | "resumed"
    | "settled"
    | "test";
  title: string;
  body: string;
  sessionId?: string;
  /** A background agent's id (`claude agents`) */
  agentId?: string;
  /** Opens the session in the iOS app */
  appUrl?: string;
  /** Opens the session in a browser */
  webUrl?: string;
}

/** Kinds that want an answer, so they ring louder */
export function isUrgent(kind: PushMessage["kind"]): boolean {
  return kind === "needsYou" || kind === "agentNeedsYou";
}

export interface SendReport {
  ntfy?: string;
  apns?: string;
}

/** Sends to every configured channel; reports what happened per channel */
export async function sendPush(message: PushMessage): Promise<SendReport> {
  const config = readPushConfig();
  if (message.sessionId) {
    message.appUrl ??= `agentos://session/${message.sessionId}`;
    if (config.publicUrl) {
      message.webUrl ??= `${config.publicUrl.replace(/\/+$/, "")}/?session=${message.sessionId}`;
    }
  } else if (message.agentId && config.publicUrl) {
    message.webUrl ??= config.publicUrl;
  }
  const report: SendReport = {};

  if (config.ntfy.enabled && config.ntfy.topic) {
    try {
      await sendNtfy(config.ntfy, message);
      report.ntfy = "sent";
    } catch (error) {
      report.ntfy = error instanceof Error ? error.message : "failed";
    }
  }

  const { apns } = config;
  if (apns.enabled && apns.teamId && apns.keyId && hasApnsKey()) {
    if (!config.devices.length) {
      report.apns = "no devices registered: open the iOS app once";
    } else {
      const results: string[] = [];
      let changed = false;
      for (const device of [...config.devices]) {
        try {
          const r = await sendApns(apns, device, message);
          if (r.result === "sent" && device.sandbox !== r.sandbox) {
            device.sandbox = r.sandbox;
            changed = true;
          }
          if (r.result === "gone") {
            config.devices = config.devices.filter((d) => d !== device);
            changed = true;
          }
          results.push(
            r.result === "sent" ? "sent" : `${r.result} (${r.reason})`
          );
        } catch (error) {
          results.push(error instanceof Error ? error.message : "failed");
        }
      }
      if (changed) writePushConfig(config);
      report.apns = results.join(", ");
    }
  }
  return report;
}
