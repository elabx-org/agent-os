"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { Switch } from "@/components/ui/switch";
import {
  duoPreviewStore,
  loadDuoPreview,
  setDuoPreview,
} from "@/stores/duoPreview";
import {
  DUO_LAYOUT_OPTIONS,
  Segmented,
} from "@/components/Terminal/ToolbarSettings";
import { useToolbarPreferences } from "@/components/Terminal/toolbar-config";
import { SettingGroup, SettingRow } from "./SettingGroup";

/** iPhone Duo only (the iOS app): the closed-screen layout on trial and the
    open Duo's controls. The keys are Settings → Keys */
export function DuoSection() {
  const { on } = useSnapshot(duoPreviewStore);
  // The open display's layout never loaded it
  useEffect(loadDuoPreview, []);
  const { preferences, updatePreferences } = useToolbarPreferences();

  return (
    <>
      <SettingGroup>
        <SettingRow
          label="Closed layout: title in the page (trial)"
          hint="On the outer display, the session's title in the page instead of a header band"
        >
          <Switch checked={on} onCheckedChange={setDuoPreview} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup>
        <div className="space-y-1.5 px-3.5 py-2.5">
          <span className="block text-sm">Open Duo layout</span>
          <span className="text-muted-foreground block text-xs">
            A session across both pages: composer left and keys right (Split),
            the other way round, or both rows across the pages
          </span>
          <Segmented
            label="Open Duo layout"
            value={preferences.duoLayout ?? "split"}
            options={DUO_LAYOUT_OPTIONS}
            onChange={(duoLayout) =>
              updatePreferences({ ...preferences, duoLayout })
            }
          />
          {/* Two rows parts the context row; fixed rows keep to Split */}
          {preferences.duoLayout === "two-rows" &&
            preferences.mode === "custom" && (
              <span className="text-muted-foreground block text-xs">
                Two rows needs Follow context in Keys. With fixed rows the open
                Duo shows Split.
              </span>
            )}
        </div>
      </SettingGroup>
    </>
  );
}
