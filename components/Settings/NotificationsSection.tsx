"use client";

import { PushSettingsForm } from "@/components/PushSettings";
import { Switch } from "@/components/ui/switch";
import type { NotificationSettings } from "@/lib/notifications";
import { SettingGroup, SettingRow } from "./SettingGroup";

export interface NotificationsSectionProps {
  settings: NotificationSettings;
  permissionGranted: boolean;
  onUpdateSettings: (settings: Partial<NotificationSettings>) => void;
  onRequestPermission: () => Promise<boolean>;
}

/** This device's alerts and sound, then the server's phone notifications */
export function NotificationsSection({
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
    <>
      <SettingGroup>
        <SettingRow
          label="Browser alerts"
          hint={
            !supported
              ? "Not available here"
              : denied
                ? "Blocked in this browser's site settings"
                : "This device, while Agent-OS is in the background"
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
        <SettingRow label="Sound" hint="A chime when a session needs you">
          <Switch
            checked={settings.sound}
            onCheckedChange={(sound) => onUpdateSettings({ sound })}
          />
        </SettingRow>
      </SettingGroup>

      <div className="px-5 pt-4 pb-1">
        <div className="text-sm font-medium">Phone</div>
        <p className="text-muted-foreground text-xs">
          Sent by the server, so they arrive with the app closed. The session
          you're looking at doesn't notify.
        </p>
      </div>
      <SettingGroup className="divide-y-0 p-3.5">
        <PushSettingsForm />
      </SettingGroup>
    </>
  );
}
