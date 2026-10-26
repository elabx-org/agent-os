"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { PushSettingsView } from "@/app/api/push/route";

interface PushSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Phone notifications: what notifies, and through ntfy or Apple push */
export function PushSettings({ open, onOpenChange }: PushSettingsProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90dvh,760px)] flex-col gap-4 overflow-hidden p-4 sm:max-w-md">
        <div>
          <DialogTitle className="text-base">Phone notifications</DialogTitle>
          <DialogDescription className="text-xs">
            Sent by the server, so they arrive with the app closed. The session
            you're looking at doesn't notify.
          </DialogDescription>
        </div>
        {/* Mounts with the dialog, so each opening loads afresh */}
        <PushSettingsForm onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The form itself, loaded on mount; shared by the dialog and the Settings
 * page. Without onSaved it stays put and says it saved.
 */
export function PushSettingsForm({
  onSaved,
  className,
}: {
  onSaved?: () => void;
  className?: string;
}) {
  const [settings, setSettings] = useState<PushSettingsView | null>(null);
  const [ntfyToken, setNtfyToken] = useState("");
  const [apnsKey, setApnsKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/push")
      .then((res) => res.json())
      .then(setSettings)
      .catch(() => setNote("Couldn't load the settings"));
  }, []);

  const save = async (patch: Record<string, unknown> = {}) => {
    if (!settings) return null;
    setSaving(true);
    try {
      const res = await fetch("/api/push", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: settings.events,
          publicUrl: window.location.origin,
          ntfy: {
            enabled: settings.ntfy.enabled,
            server: settings.ntfy.server.trim(),
            topic: settings.ntfy.topic.trim(),
            ...(ntfyToken && { token: ntfyToken }),
          },
          apns: {
            enabled: settings.apns.enabled,
            teamId: settings.apns.teamId.trim(),
            keyId: settings.apns.keyId.trim(),
            bundleId: settings.apns.bundleId.trim(),
            ...(apnsKey && { key: apnsKey }),
          },
          ...patch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error ?? "Couldn't save");
        return null;
      }
      setSettings(data);
      setNtfyToken("");
      setApnsKey("");
      return data as PushSettingsView;
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setNote(null);
    try {
      if (!(await save())) return;
      const res = await fetch("/api/push/test", { method: "POST" });
      const { report } = (await res.json()) as {
        report: { ntfy?: string; apns?: string };
      };
      const lines = [
        report.ntfy && `ntfy: ${report.ntfy}`,
        report.apns && `Apple push: ${report.apns}`,
      ].filter(Boolean);
      setNote(
        lines.length ? lines.join(" · ") : "Turn on ntfy or Apple push first"
      );
    } catch {
      setNote("Couldn't reach the server");
    } finally {
      setTesting(false);
    }
  };

  const update = (fn: (s: PushSettingsView) => PushSettingsView) =>
    setSettings((s) => (s ? fn(s) : s));

  const topicUrl = settings
    ? `${settings.ntfy.server.replace(/\/+$/, "")}/${settings.ntfy.topic}`
    : "";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4", className)}>
      {!settings ? (
        <div className="flex justify-center py-10">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
          <section className="space-y-2">
            <Row
              label="Needs you"
              hint="Claude stops at a permission prompt"
              checked={settings.events.needsYou}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  events: { ...s.events, needsYou: v },
                }))
              }
            />
            <Row
              label="Finished"
              hint="Claude ends its turn after working a while"
              checked={settings.events.finished}
              onChange={(v) =>
                update((s) => ({
                  ...s,
                  events: { ...s.events, finished: v },
                }))
              }
            />
          </section>

          <section className="border-border space-y-3 rounded-2xl border p-3">
            <Row
              label="ntfy"
              hint="Free; install the ntfy app and subscribe to the topic"
              checked={settings.ntfy.enabled}
              onChange={(v) =>
                update((s) => ({ ...s, ntfy: { ...s.ntfy, enabled: v } }))
              }
            />
            {settings.ntfy.enabled && (
              <div className="space-y-2">
                <Field label="Server">
                  <Input
                    value={settings.ntfy.server}
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    onChange={(e) =>
                      update((s) => ({
                        ...s,
                        ntfy: { ...s.ntfy, server: e.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Topic">
                  <div className="flex gap-2">
                    <Input
                      value={settings.ntfy.topic}
                      autoCapitalize="off"
                      autoCorrect="off"
                      className="font-mono text-xs"
                      onChange={(e) =>
                        update((s) => ({
                          ...s,
                          ntfy: { ...s.ntfy, topic: e.target.value },
                        }))
                      }
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
                    Anyone who knows the topic can read it, so keep the random
                    name. In the ntfy app, tap + and paste it
                    {settings.ntfy.server.includes("ntfy.sh")
                      ? ""
                      : ", with your server"}
                    .
                  </p>
                </Field>
                <Field label="Access token (optional)">
                  <Input
                    type="password"
                    value={ntfyToken}
                    placeholder={settings.ntfy.hasToken ? "Saved" : "tk_…"}
                    autoComplete="off"
                    onChange={(e) => setNtfyToken(e.target.value)}
                  />
                </Field>
              </div>
            )}
          </section>

          <section className="border-border space-y-3 rounded-2xl border p-3">
            <Row
              label="Apple push"
              hint="Straight to the Agent-OS app; needs a paid developer account"
              checked={settings.apns.enabled}
              onChange={(v) =>
                update((s) => ({ ...s, apns: { ...s.apns, enabled: v } }))
              }
            />
            {settings.apns.enabled && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Team ID">
                    <Input
                      value={settings.apns.teamId}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      onChange={(e) =>
                        update((s) => ({
                          ...s,
                          apns: { ...s.apns, teamId: e.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Key ID">
                    <Input
                      value={settings.apns.keyId}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      onChange={(e) =>
                        update((s) => ({
                          ...s,
                          apns: { ...s.apns, keyId: e.target.value },
                        }))
                      }
                    />
                  </Field>
                </div>
                <Field label="Bundle ID">
                  <Input
                    value={settings.apns.bundleId}
                    autoCapitalize="off"
                    autoCorrect="off"
                    onChange={(e) =>
                      update((s) => ({
                        ...s,
                        apns: { ...s.apns, bundleId: e.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Key (.p8)">
                  <textarea
                    value={apnsKey}
                    placeholder={
                      settings.apns.hasKey
                        ? "Saved. Paste a new key to replace it."
                        : "-----BEGIN PRIVATE KEY-----"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    rows={3}
                    onChange={(e) => setApnsKey(e.target.value)}
                    className="border-input bg-background w-full rounded-md border px-3 py-2 font-mono text-xs"
                  />
                </Field>
                <p className="text-muted-foreground text-xs">
                  {settings.devices
                    ? `${settings.devices} device${settings.devices === 1 ? "" : "s"} registered.`
                    : "No devices yet: open the iOS app and allow notifications."}{" "}
                  The app's profile needs the Push Notifications capability.
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {note && <p className="text-muted-foreground text-xs">{note}</p>}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={!settings || testing || saving}
          onClick={test}
        >
          {testing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Send test
        </Button>
        <Button
          className="flex-1"
          disabled={!settings || saving}
          onClick={async () => {
            if (!(await save())) return;
            if (onSaved) onSaved();
            else setNote("Saved");
          }}
        >
          {saving && !testing && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-[44px] items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Field({
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
