"use client";

import { useState } from "react";
import { ToolbarSettings } from "@/components/Terminal/ToolbarSettings";
import {
  useToolbarPreferences,
  type ToolbarPreferences,
} from "@/components/Terminal/toolbar-config";
import { RowValue, SettingGroup, SettingRow, Toggle } from "./SettingGroup";

/** "Adaptive", the Keys row's value in the Settings list */
export function keysSummary(prefs: ToolbarPreferences): string {
  if (prefs.adaptive !== false) return "Adaptive";
  return prefs.mode === "custom" ? "Fixed rows" : "Follow context";
}

/** The key rows above the keyboard: adaptive when closed, and each row's keys */
export function KeysSection() {
  const { preferences, updatePreferences } = useToolbarPreferences();
  const [editing, setEditing] = useState(false);

  return (
    <>
      <SettingGroup>
        <SettingRow
          label="Adaptive row when closed"
          hint="Keys follow what Claude is doing; ⋯ has every key"
        >
          <Toggle
            checked={preferences.adaptive !== false}
            onCheckedChange={(adaptive) =>
              updatePreferences({ ...preferences, adaptive })
            }
            aria-label="Adaptive row when closed"
          />
        </SettingRow>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="active:bg-accent flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Key rows</span>
            <span className="text-muted-foreground block text-[13px]">
              Each context&apos;s keys, the compose box and predictions
            </span>
          </span>
          <RowValue>
            {preferences.mode === "custom" ? "Fixed" : "Follow context"}
          </RowValue>
        </button>
      </SettingGroup>
      <ToolbarSettings
        open={editing}
        onClose={() => setEditing(false)}
        preferences={preferences}
        onUpdate={updatePreferences}
      />
    </>
  );
}
