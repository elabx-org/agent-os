"use client";

import { useState } from "react";
import { X, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  type ToolbarPreferences,
  type ToolbarButtonId,
  type PresetId,
  TOOLBAR_BUTTONS,
  GROUP_LABELS,
  PRESETS,
  getButtonDef,
} from "./toolbar-config";

interface ToolbarSettingsProps {
  open: boolean;
  onClose: () => void;
  preferences: ToolbarPreferences;
  onUpdate: (prefs: ToolbarPreferences) => void;
}

export function ToolbarSettings({
  open,
  onClose,
  preferences,
  onUpdate,
}: ToolbarSettingsProps) {
  const [prefs, setPrefs] = useState<ToolbarPreferences>(() => ({
    ...preferences,
    row1: [...preferences.row1],
    row2: [...preferences.row2],
    hidden: [...preferences.hidden],
  }));

  const apply = (next: ToolbarPreferences) => {
    setPrefs(next);
    onUpdate(next);
  };

  const toggleLayout = () => {
    const next = { ...prefs, row1: [...prefs.row1], row2: [...prefs.row2], hidden: [...prefs.hidden] };
    if (prefs.layout === "single") {
      next.layout = "double";
      // Move nav+shell buttons to row2 by default when switching to double
      if (next.row2.length === 0) {
        const moveToRow2 = new Set<ToolbarButtonId>(["arrow-left", "arrow-right", "arrow-up", "arrow-down", "char-tilde", "char-slash", "char-pipe", "char-gt"]);
        next.row2 = next.row1.filter((id) => moveToRow2.has(id));
        next.row1 = next.row1.filter((id) => !moveToRow2.has(id));
      }
    } else {
      next.layout = "single";
      // Merge row2 back into row1
      next.row1 = [...next.row1, ...next.row2];
      next.row2 = [];
    }
    apply(next);
  };

  const applyPreset = (id: PresetId) => {
    const preset = PRESETS[id].get();
    apply({
      ...preset,
      row1: [...preset.row1],
      row2: [...preset.row2],
      hidden: [...preset.hidden],
    });
  };

  const toggleButton = (id: ToolbarButtonId) => {
    const next = { ...prefs, row1: [...prefs.row1], row2: [...prefs.row2], hidden: [...prefs.hidden] };
    if (next.hidden.includes(id)) {
      // Unhide: add to row1 (or row2 if double layout and it was there before)
      next.hidden = next.hidden.filter((h) => h !== id);
      next.row1.push(id);
    } else {
      // Hide: remove from whichever row it's in
      next.row1 = next.row1.filter((r) => r !== id);
      next.row2 = next.row2.filter((r) => r !== id);
      next.hidden.push(id);
    }
    apply(next);
  };

  const getButtonRow = (id: ToolbarButtonId): 1 | 2 | 0 => {
    if (prefs.row1.includes(id)) return 1;
    if (prefs.row2.includes(id)) return 2;
    return 0; // hidden
  };

  const toggleRow = (id: ToolbarButtonId) => {
    const next = { ...prefs, row1: [...prefs.row1], row2: [...prefs.row2], hidden: [...prefs.hidden] };
    const currentRow = getButtonRow(id);
    if (currentRow === 1) {
      next.row1 = next.row1.filter((r) => r !== id);
      next.row2.push(id);
    } else if (currentRow === 2) {
      next.row2 = next.row2.filter((r) => r !== id);
      next.row1.push(id);
    }
    apply(next);
  };

  const moveUp = (id: ToolbarButtonId) => {
    const next = { ...prefs, row1: [...prefs.row1], row2: [...prefs.row2], hidden: [...prefs.hidden] };
    const row1Idx = next.row1.indexOf(id);
    const row2Idx = next.row2.indexOf(id);

    if (row1Idx > 0) {
      [next.row1[row1Idx - 1], next.row1[row1Idx]] = [next.row1[row1Idx], next.row1[row1Idx - 1]];
    } else if (row1Idx === 0 && prefs.layout === "double" && next.row2.length > 0) {
      // Cross to end of row2
      next.row1 = next.row1.filter((r) => r !== id);
      next.row2.push(id);
    } else if (row2Idx > 0) {
      [next.row2[row2Idx - 1], next.row2[row2Idx]] = [next.row2[row2Idx], next.row2[row2Idx - 1]];
    } else if (row2Idx === 0) {
      // Cross to end of row1
      next.row2 = next.row2.filter((r) => r !== id);
      next.row1.push(id);
    }
    apply(next);
  };

  const moveDown = (id: ToolbarButtonId) => {
    const next = { ...prefs, row1: [...prefs.row1], row2: [...prefs.row2], hidden: [...prefs.hidden] };
    const row1Idx = next.row1.indexOf(id);
    const row2Idx = next.row2.indexOf(id);

    if (row1Idx >= 0 && row1Idx < next.row1.length - 1) {
      [next.row1[row1Idx], next.row1[row1Idx + 1]] = [next.row1[row1Idx + 1], next.row1[row1Idx]];
    } else if (row1Idx === next.row1.length - 1 && prefs.layout === "double") {
      // Cross to start of row2
      next.row1 = next.row1.filter((r) => r !== id);
      next.row2.unshift(id);
    } else if (row2Idx >= 0 && row2Idx < next.row2.length - 1) {
      [next.row2[row2Idx], next.row2[row2Idx + 1]] = [next.row2[row2Idx + 1], next.row2[row2Idx]];
    } else if (row2Idx === next.row2.length - 1) {
      // Cross to start of row1
      next.row2 = next.row2.filter((r) => r !== id);
      next.row1.unshift(id);
    }
    apply(next);
  };

  // Build ordered list: row1 buttons, then row2 buttons, then hidden — grouped by category
  const allButtonsOrdered = (() => {
    const ordered: ToolbarButtonId[] = [...prefs.row1, ...prefs.row2, ...prefs.hidden];
    // Deduplicate while preserving order
    const seen = new Set<ToolbarButtonId>();
    return ordered.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  })();

  // Group buttons by their group for display
  const groupedButtons = (() => {
    const groups: Record<string, ToolbarButtonId[]> = {};
    for (const id of allButtonsOrdered) {
      const def = getButtonDef(id);
      if (!def) continue;
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push(id);
    }
    return groups;
  })();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background flex max-h-[75vh] w-full flex-col rounded-t-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">Toolbar Settings</span>
          <button onClick={onClose} className="hover:bg-muted rounded-md p-1.5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Layout toggle + Presets */}
        <div className="border-border space-y-3 border-b px-4 py-3">
          {/* Layout toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm">Two rows</span>
            <Switch
              checked={prefs.layout === "double"}
              onCheckedChange={toggleLayout}
            />
          </div>

          {/* Presets */}
          <div className="flex gap-2">
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <button
                key={id}
                onClick={() => applyPreset(id)}
                className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium"
              >
                {PRESETS[id].label}
              </button>
            ))}
          </div>
        </div>

        {/* Button list */}
        <div className="flex-1 overflow-y-auto">
          {Object.entries(groupedButtons).map(([group, ids]) => (
            <div key={group}>
              <div className="bg-muted/50 text-muted-foreground px-4 py-1.5 text-xs font-medium uppercase tracking-wider">
                {GROUP_LABELS[group as keyof typeof GROUP_LABELS] || group}
              </div>
              {ids.map((id) => {
                const def = getButtonDef(id);
                if (!def) return null;
                const isHidden = prefs.hidden.includes(id);
                const row = getButtonRow(id);

                return (
                  <div
                    key={id}
                    className="border-border flex items-center gap-2 border-b px-4 py-2"
                  >
                    {/* Visibility checkbox */}
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggleButton(id)}
                      className="accent-primary h-4 w-4 rounded"
                    />

                    {/* Label */}
                    <div className="min-w-0 flex-1">
                      <span className="text-sm">{def.label}</span>
                      {def.conditional && (
                        <span className="text-muted-foreground ml-1 text-xs">
                          (when available)
                        </span>
                      )}
                    </div>

                    {/* Row toggle — only in double layout for visible buttons */}
                    {prefs.layout === "double" && !isHidden && (
                      <button
                        onClick={() => toggleRow(id)}
                        className="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs font-medium"
                      >
                        R{row}
                      </button>
                    )}

                    {/* Reorder arrows — only for visible buttons */}
                    {!isHidden && (
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => moveUp(id)}
                          className="hover:bg-muted rounded p-1"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => moveDown(id)}
                          className="hover:bg-muted rounded p-1"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-border border-t px-4 py-3">
          <button
            onClick={() => applyPreset("standard")}
            className="text-muted-foreground flex w-full items-center justify-center gap-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
}
