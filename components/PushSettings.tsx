"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PushSettingsView } from "@/app/api/push/route";

export type { PushSettingsView };

/** What PUT /api/push takes: any part, merged on the server */
export interface PushPatch {
  events?: Partial<PushSettingsView["events"]>;
  ntfy?: Partial<{
    enabled: boolean;
    server: string;
    topic: string;
    token: string;
  }>;
  apns?: Partial<{
    enabled: boolean;
    teamId: string;
    keyId: string;
    bundleId: string;
    key: string;
  }>;
}

// Shared with the Settings list's "ntfy on" summary
const PUSH_KEY = ["push-settings"];

/**
 * The server's phone notification settings, with save (a partial update) and
 * test. Both write the answer into the shared query, so every reader agrees.
 */
export function usePushSettings() {
  const queryClient = useQueryClient();
  const query = useQuery<PushSettingsView>({
    queryKey: PUSH_KEY,
    queryFn: async () => {
      const res = await fetch("/api/push");
      if (!res.ok) throw new Error("Failed to load push settings");
      return res.json();
    },
  });

  const save = useCallback(
    async (patch: PushPatch): Promise<PushSettingsView> => {
      const res = await fetch("/api/push", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Where notification links open: wherever settings were last saved
        body: JSON.stringify({ publicUrl: window.location.origin, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save");
      queryClient.setQueryData(PUSH_KEY, data);
      return data;
    },
    [queryClient]
  );

  /** Sends on every channel; the server keeps when, for "tested 2h ago" */
  const test = useCallback(async () => {
    const res = await fetch("/api/push/test", { method: "POST" });
    if (!res.ok) throw new Error("Couldn't reach the server");
    const { report, lastTest } = (await res.json()) as {
      report: { ntfy?: string; apns?: string };
      lastTest: PushSettingsView["lastTest"];
    };
    queryClient.setQueryData<PushSettingsView>(PUSH_KEY, (s) =>
      s ? { ...s, lastTest } : s
    );
    return report;
  }, [queryClient]);

  /**
   * A switch: shown at once, then saved; a failed save says so and puts the
   * server's value back
   */
  const toggle = useCallback(
    (patch: PushPatch, apply: (s: PushSettingsView) => PushSettingsView) => {
      queryClient.setQueryData<PushSettingsView>(PUSH_KEY, (s) =>
        s ? apply(s) : s
      );
      save(patch).catch((e: Error) => {
        toast.error(e.message);
        queryClient.invalidateQueries({ queryKey: PUSH_KEY });
      });
    },
    [queryClient, save]
  );

  return { ...query, save, test, toggle };
}

export interface NtfyDraft {
  server: string;
  topic: string;
  token: string;
}

/** ntfy's server, topic (with a copy button) and optional access token */
export function NtfyFields({
  draft,
  hasToken,
  onChange,
}: {
  draft: NtfyDraft;
  hasToken: boolean;
  onChange: (draft: NtfyDraft) => void;
}) {
  const [copied, setCopied] = useState(false);
  const topicUrl = `${draft.server.trim().replace(/\/+$/, "")}/${draft.topic.trim()}`;

  return (
    <div className="space-y-2">
      <Field label="Server">
        <Input
          value={draft.server}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => onChange({ ...draft, server: e.target.value })}
        />
      </Field>
      <Field label="Topic">
        <div className="flex gap-2">
          <Input
            value={draft.topic}
            autoCapitalize="off"
            autoCorrect="off"
            className="font-mono text-xs"
            onChange={(e) => onChange({ ...draft, topic: e.target.value })}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy topic link"
            onClick={() => {
              navigator.clipboard?.writeText(topicUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          Anyone who knows the topic can read it, so keep the random name. In
          the ntfy app, tap + and paste it
          {draft.server.includes("ntfy.sh") ? "" : ", with your server"}.
        </p>
      </Field>
      <Field label="Access token (optional)">
        <Input
          type="password"
          value={draft.token}
          placeholder={hasToken ? "Saved" : "tk_…"}
          autoComplete="off"
          onChange={(e) => onChange({ ...draft, token: e.target.value })}
        />
      </Field>
    </div>
  );
}

export interface ApnsDraft {
  teamId: string;
  keyId: string;
  bundleId: string;
  key: string;
}

/** Apple push for a build of your own: the developer key and app id */
export function ApnsFields({
  draft,
  hasKey,
  devices,
  onChange,
}: {
  draft: ApnsDraft;
  hasKey: boolean;
  devices: number;
  onChange: (draft: ApnsDraft) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Team ID">
          <Input
            value={draft.teamId}
            autoCapitalize="characters"
            autoCorrect="off"
            onChange={(e) => onChange({ ...draft, teamId: e.target.value })}
          />
        </Field>
        <Field label="Key ID">
          <Input
            value={draft.keyId}
            autoCapitalize="characters"
            autoCorrect="off"
            onChange={(e) => onChange({ ...draft, keyId: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Bundle ID">
        <Input
          value={draft.bundleId}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => onChange({ ...draft, bundleId: e.target.value })}
        />
      </Field>
      <Field label="Key (.p8)">
        <textarea
          value={draft.key}
          placeholder={
            hasKey
              ? "Saved. Paste a new key to replace it."
              : "-----BEGIN PRIVATE KEY-----"
          }
          autoComplete="off"
          spellCheck={false}
          rows={3}
          onChange={(e) => onChange({ ...draft, key: e.target.value })}
          className="border-input bg-background w-full rounded-md border px-3 py-2 font-mono text-xs"
        />
      </Field>
      <p className="text-muted-foreground text-xs">
        {devices
          ? `${devices} device${devices === 1 ? "" : "s"} registered.`
          : "No devices yet: open the iOS app and allow notifications."}{" "}
        Needs a paid developer account, and the app's profile needs the Push
        Notifications capability.
      </p>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="text-muted-foreground block text-xs font-medium">
        {label}
      </span>
      {children}
    </div>
  );
}
