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
        label="New closed-screen layout (trial)"
        hint="A glance as the home on the outer display"
      >
        <Switch checked={on} onCheckedChange={setDuoPreview} />
      </SettingRow>
    </SettingGroup>
  );
}
