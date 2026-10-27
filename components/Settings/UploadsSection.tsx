"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/Terminal/ToolbarSettings";
import {
  PRESETS,
  loadUploadPrefs,
  setUploadPrefs,
  uploadPrefs,
  type Preset,
  type UploadPrefs,
} from "@/stores/videoUploads";
import { SettingGroup, SettingRow } from "./SettingGroup";

const PRESET_OPTIONS = (Object.keys(PRESETS) as Preset[]).map((p) => ({
  value: p,
  label: PRESETS[p].label,
}));

// Tokens for a typical 40-second recording, from a measured one
const TYPICAL: Record<Preset, string> = {
  quick: "about 12 frames · ~6k tokens",
  balanced: "about 20 frames · ~20k tokens",
  detail: "about 20–40 frames · ~45k tokens",
};

const CHECK_OPTIONS: { value: UploadPrefs["check"]; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "large", label: "When large" },
  { value: "never", label: "Never" },
];

const CHECK_HINT: Record<UploadPrefs["check"], string> = {
  always: "The frames open to look over before anything is sent",
  large: "Only a video over the limit opens to look over first",
  never: "Frames go with the message as soon as they're ready",
};

const LIMITS = [20_000, 40_000, 80_000].map((n) => ({
  value: String(n),
  label: `${n / 1000}k tokens`,
}));

/** Videos sent to Claude as frames: how many, and when to check first */
export function UploadsSection() {
  const prefs = useSnapshot(uploadPrefs);
  useEffect(loadUploadPrefs, []);

  return (
    <>
      <SettingGroup>
        <div className="space-y-1.5 px-3.5 py-2.5">
          <span className="block text-sm">Video quality</span>
          <span className="text-muted-foreground block text-xs">
            {PRESETS[prefs.preset].hint}: {TYPICAL[prefs.preset]}
          </span>
          <Segmented
            label="Video quality"
            value={prefs.preset}
            options={PRESET_OPTIONS}
            onChange={(preset) => setUploadPrefs({ preset })}
          />
        </div>
      </SettingGroup>
      <SettingGroup>
        <div className="space-y-1.5 px-3.5 py-2.5">
          <span className="block text-sm">Check before sending frames</span>
          <span className="text-muted-foreground block text-xs">
            {CHECK_HINT[prefs.check]}
          </span>
          <Segmented
            label="Check before sending frames"
            value={prefs.check}
            options={CHECK_OPTIONS}
            onChange={(check) => setUploadPrefs({ check })}
          />
        </div>
        {prefs.check === "large" && (
          <div className="space-y-1.5 px-3.5 py-2.5">
            <span className="block text-sm">Limit</span>
            <Segmented
              label="Limit"
              value={String(prefs.limit)}
              options={LIMITS}
              onChange={(limit) => setUploadPrefs({ limit: Number(limit) })}
            />
          </div>
        )}
        <SettingRow
          label="Show token estimate on video pills"
          hint="The review sheet always shows it"
        >
          <Switch
            checked={prefs.showTokens}
            onCheckedChange={(showTokens) => setUploadPrefs({ showTokens })}
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}
