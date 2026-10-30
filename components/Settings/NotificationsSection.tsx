"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import {
  ApnsFields,
  NtfyFields,
  usePushSettings,
  type ApnsDraft,
  type NtfyDraft,
  type PushSettingsView,
} from "@/components/PushSettings";
import { SectionHeader } from "@/components/rows/AgentRow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { timeAgo } from "@/lib/agent-state";
import {
  eventsFromServer,
  SERVER_TO_LOCAL_EVENT,
  type NotificationSettings,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { SettingGroup, SettingRow } from "./SettingGroup";
import { WidgetLink } from "./WidgetLink";

export interface NotificationsSectionProps {
  settings: NotificationSettings;
  permissionGranted: boolean;
  onUpdateSettings: (settings: Partial<NotificationSettings>) => void;
  onRequestPermission: () => Promise<boolean>;
}

type PushEvent = keyof PushSettingsView["events"];

const WHEN: { event: PushEvent; label: string; short: string }[] = [
  {
    event: "needsYou",
    label: "An agent needs me",
    short: "An agent needs you",
  },
  {
    event: "finished",
    label: "A session finishes",
    short: "a session finishes",
  },
  {
    event: "backgroundFinished",
    label: "A background agent finishes",
    short: "a background agent finishes",
  },
  {
    event: "limited",
    label: "Usage limit hit",
    short: "a usage limit is hit",
  },
  {
    event: "resumed",
    label: "Resumed after a limit",
    short: "a session resumes after a limit",
  },
  {
    event: "settled",
    label: "A session settles on its own",
    short: "a session settles",
  },
];

/**
 * Says what's really set up: the phone (ntfy) with its setup in place, this
 * device's alerts and sound, then one "Tell me when" for all of them. Apple
 * push stays a muted row until it can deliver.
 */
export function NotificationsSection({
  settings,
  permissionGranted,
  onUpdateSettings,
  onRequestPermission,
}: NotificationsSectionProps) {
  const push = usePushSettings();
  const data = push.data;

  // The server's events win: bring this device's in line once per load
  const synced = useRef(false);
  useEffect(() => {
    if (!data || synced.current) return;
    synced.current = true;
    const events = eventsFromServer(settings.events, data.events);
    if (events) onUpdateSettings({ events });
  }, [data, settings.events, onUpdateSettings]);

  const setEvent = (event: PushEvent, on: boolean) => {
    push.toggle({ events: { [event]: on } }, (s) => ({
      ...s,
      events: { ...s.events, [event]: on },
    }));
    if (event in SERVER_TO_LOCAL_EVENT) {
      const local =
        SERVER_TO_LOCAL_EVENT[event as keyof typeof SERVER_TO_LOCAL_EVENT];
      onUpdateSettings({ events: { ...settings.events, [local]: on } });
    }
  };

  const [whenOpen, setWhenOpen] = useState(false);

  if (!data) {
    return (
      <SettingGroup>
        <div className="flex min-h-[50px] items-center justify-center">
          {push.isError ? (
            <span className="text-muted-foreground text-xs">
              Couldn't load the phone settings
            </span>
          ) : (
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          )}
        </div>
      </SettingGroup>
    );
  }

  const whenToggles = WHEN.map(({ event, label }) => (
    <SettingRow key={event} label={label}>
      <Switch
        checked={data.events[event]}
        onCheckedChange={(on) => setEvent(event, on)}
      />
    </SettingRow>
  ));
  const whenSummary =
    WHEN.filter(({ event }) => data.events[event])
      .map(({ short }) => short)
      .join(" · ") || "Nothing";

  return (
    <>
      <SettingGroup>
        <PhoneRow push={push} data={data} />
        <BrowserRow
          settings={settings}
          permissionGranted={permissionGranted}
          onUpdateSettings={onUpdateSettings}
          onRequestPermission={onRequestPermission}
        />
        <SettingRow label="Sound">
          <Switch
            checked={settings.sound}
            onCheckedChange={(sound) => onUpdateSettings({ sound })}
          />
        </SettingRow>
        {/* Narrow (the closed Duo): one "When" row that opens in place */}
        <div className="md:hidden">
          <Disclosure
            label="When"
            hint={whenSummary}
            open={whenOpen}
            onToggle={() => setWhenOpen((o) => !o)}
          />
          {whenOpen && (
            <div className="divide-border border-border divide-y border-t pl-3">
              {whenToggles}
            </div>
          )}
        </div>
        <ApplePushRow push={push} data={data} />
      </SettingGroup>

      <div className="hidden md:block">
        <SectionHeader className="px-5 pt-4">Tell me when</SectionHeader>
        <SettingGroup>{whenToggles}</SettingGroup>
        <p className="text-muted-foreground px-5 pt-1.5 text-xs">
          For the phone and this device. The session you're looking at doesn't
          notify.
        </p>
      </div>

      <WidgetLink />
    </>
  );
}

type Push = ReturnType<typeof usePushSettings>;

/** "Phone (ntfy) · agent-os topic · tested 2h ago", setup behind the chevron */
function PhoneRow({ push, data }: { push: Push; data: PushSettingsView }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NtfyDraft | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The generated topic is agent-os-<random>: the random part says nothing
  const topic = data.ntfy.topic.replace(/-[0-9a-f]{16,}$/, "");
  const tested = data.lastTest
    ? `tested ${timeAgo(data.lastTest.at)}`
    : "not tested yet";

  const openSetup = (show: boolean) => {
    if (show) {
      setDraft({ server: data.ntfy.server, topic: data.ntfy.topic, token: "" });
      setNote(null);
    }
    setOpen(show);
  };

  const saveDraft = async () => {
    if (!draft) return;
    await push.save({
      ntfy: {
        server: draft.server.trim(),
        topic: draft.topic.trim(),
        ...(draft.token && { token: draft.token }),
      },
    });
    setDraft((d) => d && { ...d, token: "" });
  };

  const run = async (kind: "save" | "test") => {
    setBusy(kind);
    setNote(null);
    try {
      await saveDraft();
      if (kind === "save") {
        setNote("Saved");
        return;
      }
      const report = await push.test();
      const lines = [
        report.ntfy && `ntfy: ${report.ntfy}`,
        report.apns && `Apple push: ${report.apns}`,
      ].filter(Boolean);
      setNote(lines.length ? lines.join(" · ") : "Turn on ntfy first");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex min-h-[50px] items-center gap-1 pr-3.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => openSetup(!open)}
          className="active:bg-accent flex min-h-[50px] min-w-0 flex-1 items-center gap-3 py-1.5 pl-3.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm">Phone (ntfy)</span>
            <span className="text-muted-foreground block truncate text-xs">
              {topic} topic · {tested}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
              open && "rotate-90"
            )}
          />
        </button>
        <Switch
          aria-label="Phone (ntfy)"
          checked={data.ntfy.enabled}
          onCheckedChange={(enabled) => {
            push.toggle({ ntfy: { enabled } }, (s) => ({
              ...s,
              ntfy: { ...s.ntfy, enabled },
            }));
            // Never tried: the topic still has to reach the phone
            if (enabled && !data.lastTest && !open) openSetup(true);
          }}
          className="ml-2"
        />
      </div>
      {open && draft && (
        <div className="border-border space-y-3 border-t px-3.5 py-3">
          <p className="text-muted-foreground text-xs">
            Sent by the server, so they arrive with the app closed. Install the
            free ntfy app and subscribe to this topic.
          </p>
          <NtfyFields
            draft={draft}
            hasToken={data.ntfy.hasToken}
            onChange={setDraft}
          />
          {note && <p className="text-muted-foreground text-xs">{note}</p>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={!!busy}
              onClick={() => run("test")}
            >
              {busy === "test" && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Send test
            </Button>
            <Button
              className="flex-1"
              disabled={!!busy}
              onClick={() => run("save")}
            >
              {busy === "save" && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BrowserRow({
  settings,
  permissionGranted,
  onUpdateSettings,
  onRequestPermission,
}: NotificationsSectionProps) {
  // The iOS app's web view has no Notification API; denied can only be
  // undone in the browser's site settings
  const supported = typeof Notification !== "undefined";
  const denied = supported && Notification.permission === "denied";

  return (
    <SettingRow
      label="Browser alerts"
      hint={
        !supported
          ? "Not available here"
          : denied
            ? "Blocked in this browser's site settings"
            : "This device"
      }
    >
      <Switch
        checked={settings.browserNotifications && permissionGranted}
        disabled={!supported || denied}
        onCheckedChange={async (on) => {
          if (on && !permissionGranted && !(await onRequestPermission()))
            return;
          onUpdateSettings({ browserNotifications: on });
        }}
      />
    </SettingRow>
  );
}

/**
 * A switch once it can deliver (key, ids and a device: a build of your own);
 * until then muted and "not set up", with the fields behind the chevron.
 */
function ApplePushRow({ push, data }: { push: Push; data: PushSettingsView }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ApnsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { apns, devices } = data;
  // Ready less its own switch, so turning it off keeps the row a switch
  const configured =
    !!apns.teamId && !!apns.keyId && apns.hasKey && devices > 0;

  if (configured) {
    return (
      <SettingRow
        label="Apple push"
        hint={`${devices} device${devices === 1 ? "" : "s"} · the iOS app`}
      >
        <Switch
          checked={apns.enabled}
          onCheckedChange={(enabled) => {
            push.toggle({ apns: { enabled } }, (s) => ({
              ...s,
              apns: { ...s.apns, enabled },
            }));
          }}
        />
      </SettingRow>
    );
  }

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setNote(null);
    try {
      await push.save({
        apns: {
          enabled: true,
          teamId: draft.teamId.trim(),
          keyId: draft.keyId.trim(),
          bundleId: draft.bundleId.trim(),
          ...(draft.key && { key: draft.key }),
        },
      });
      setDraft((d) => d && { ...d, key: "" });
      setNote("Saved");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Disclosure
        label="Apple push"
        hint="Needs the App Store build · not set up"
        muted
        open={open}
        onToggle={() => {
          if (!open) {
            setDraft({
              teamId: apns.teamId,
              keyId: apns.keyId,
              bundleId: apns.bundleId,
              key: "",
            });
            setNote(null);
          }
          setOpen(!open);
        }}
      />
      {open && draft && (
        <div className="border-border space-y-3 border-t px-3.5 py-3">
          <ApnsFields
            draft={draft}
            hasKey={apns.hasKey}
            devices={devices}
            onChange={setDraft}
          />
          {note && <p className="text-muted-foreground text-xs">{note}</p>}
          <Button className="w-full" disabled={saving} onClick={save}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

/** A row that opens more below it, like Display's theme row */
function Disclosure({
  label,
  hint,
  muted,
  open,
  onToggle,
}: {
  label: ReactNode;
  hint: ReactNode;
  muted?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="active:bg-accent flex min-h-[50px] w-full items-center gap-3 px-3.5 py-1.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", muted && "text-muted-foreground")}>
          {label}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {hint}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
          open && "rotate-90"
        )}
      />
    </button>
  );
}
