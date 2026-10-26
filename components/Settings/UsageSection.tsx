"use client";

import { UsageMonitor } from "@/components/UsageMonitor";
import { MinimaxUsageMonitor } from "@/components/MinimaxUsageMonitor";
import { SettingGroup } from "./SettingGroup";

/** Plan limits; each monitor opens its own detail and hides without data */
export function UsageSection() {
  return (
    <SettingGroup className="divide-y-0">
      <div className="peer space-y-1 p-2 empty:hidden">
        <UsageMonitor />
        <MinimaxUsageMonitor />
      </div>
      <p className="text-muted-foreground hidden px-3.5 py-3 text-sm peer-empty:block">
        No usage reported yet
      </p>
    </SettingGroup>
  );
}
