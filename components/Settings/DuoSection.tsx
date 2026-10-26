"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  duoPreviewStore,
  loadDuoPreview,
  setDuoPreview,
} from "@/stores/duoPreview";
import {
  DUO_LAYOUT_OPTIONS,
  Segmented,
  ToolbarSettings,
} from "@/components/Terminal/ToolbarSettings";
import { useToolbarPreferences } from "@/components/Terminal/toolbar-config";
import { SettingGroup, SettingRow } from "./SettingGroup";

/** iPhone Duo only (the iOS app): the closed-screen layout on trial, the
    open Duo's controls and the keys */
export function DuoSection() {
  const { on } = useSnapshot(duoPreviewStore);
  // The open display's layout never loaded it
  useEffect(loadDuoPreview, []);
  const { preferences, updatePreferences } = useToolbarPreferences();
  const [keysOpen, setKeysOpen] = useState(false);

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
        </div>
        <SettingRow as="div" label="Keys" hint="Each context's key row">
          <button
            type="button"
            onClick={() => setKeysOpen(true)}
            aria-label="Customise the keys"
            className="text-muted-foreground active:bg-accent hover:bg-accent -mr-1.5 grid h-[34px] w-[34px] place-items-center rounded-lg"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </SettingRow>
      </SettingGroup>
      <ToolbarSettings
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
        preferences={preferences}
        onUpdate={updatePreferences}
      />
    </>
  );
}
