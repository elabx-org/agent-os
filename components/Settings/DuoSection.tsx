"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { Switch } from "@/components/ui/switch";
import {
  duoPreviewStore,
  loadDuoPreview,
  setDuoPreview,
} from "@/stores/duoPreview";
import { SettingGroup, SettingRow } from "./SettingGroup";

/** iPhone Duo only (the iOS app): the closed-screen layout on trial */
export function DuoSection() {
  const { on } = useSnapshot(duoPreviewStore);
  // The open display's layout never loaded it
  useEffect(loadDuoPreview, []);

  return (
    <SettingGroup>
      <SettingRow
        label="Closed layout: title in the page (trial)"
        hint="On the outer display, the session's title in the page instead of a header band"
      >
        <Switch checked={on} onCheckedChange={setDuoPreview} />
      </SettingRow>
    </SettingGroup>
  );
}
