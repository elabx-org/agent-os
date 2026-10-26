"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, ChevronRight } from "lucide-react";
import {
  BACKGROUND_EVENT,
  DARK_PRESETS,
  DARK_SWATCHES,
  LIGHT_PRESETS,
  LIGHT_SWATCHES,
  backgroundHex,
  getBackground,
  isHex,
  setBackground,
  type BackgroundMode,
} from "@/lib/background";
import { DARK_THEMES, LIGHT_THEMES, parseTheme } from "@/lib/theme-config";
import { cn } from "@/lib/utils";

/**
 * The page background for the mode on screen: the theme's own, a preset, or
 * any colour. Cards and borders follow it; the accent and text don't change.
 */
export function BackgroundChoice() {
  const { theme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const { mode: resolved, variant } = parseTheme(resolvedTheme || "dark");
  const mode: BackgroundMode = resolved === "light" ? "light" : "dark";
  const choice = useBackground(mode);
  const [draft, setDraft] = useState("");

  const presets = mode === "dark" ? DARK_PRESETS : LIGHT_PRESETS;
  const swatches = mode === "dark" ? DARK_SWATCHES : LIGHT_SWATCHES;
  const themes = mode === "dark" ? DARK_THEMES : LIGHT_THEMES;
  // "dark-purple" or, for System, the variant the theme string names
  const themeVariant =
    parseTheme(theme || "dark").mode === "system"
      ? variant
      : parseTheme(theme || "dark").variant;
  const own =
    themes.find((t) => t.id === themeVariant)?.preview?.background ??
    themes[0]?.preview?.background;
  const custom = isHex(choice) ? choice : null;
  const current = backgroundHex(mode, choice) ?? own;
  const label =
    choice === "default"
      ? "Theme default"
      : (presets.find((p) => p.id === choice)?.label ?? choice.toUpperCase());

  const choose = (next: string) => setBackground(mode, next);
  const typed = draft.startsWith("#") ? draft : `#${draft}`;

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="active:bg-accent flex min-h-[50px] w-full items-center gap-3 px-3.5 py-1.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm">Background</span>
          <span className="text-muted-foreground block truncate text-xs">
            {label}
          </span>
        </span>
        <Swatch color={current} />
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "text-muted-foreground h-4 w-4 transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <div role="radiogroup" aria-label="Background" className="py-1">
          <Choice
            label="Theme default"
            description="The theme's own background"
            color={own}
            active={choice === "default"}
            onSelect={() => choose("default")}
          />
          {presets.map((p) => (
            <Choice
              key={p.id}
              label={p.label}
              description={`${p.description} · ${p.hex}`}
              color={p.hex}
              active={choice === p.id}
              onSelect={() => choose(p.id)}
            />
          ))}
          <Choice
            label="Custom"
            description={custom ? custom.toUpperCase() : "Pick a colour"}
            color={custom ?? undefined}
            active={!!custom}
            onSelect={() => choose(custom ?? swatches[0])}
          />
          <div className="flex flex-wrap items-center gap-2 px-3.5 pt-1 pb-2.5 pl-10">
            {swatches.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={`Background ${hex}`}
                aria-pressed={custom?.toLowerCase() === hex.toLowerCase()}
                onClick={() => choose(hex)}
                className={cn(
                  "ring-border h-7 w-7 rounded-full ring-1",
                  custom?.toLowerCase() === hex.toLowerCase() &&
                    "ring-primary ring-2 ring-offset-2 ring-offset-[hsl(var(--card))]"
                )}
                style={{ backgroundColor: hex }}
              />
            ))}
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (isHex(typed)) choose(typed);
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value.trim())}
                placeholder="#0E1013"
                aria-label="Background hex colour"
                maxLength={7}
                spellCheck={false}
                autoCapitalize="off"
                className="bg-background border-border h-8 w-[5.5rem] rounded-md border px-2 font-mono text-xs"
              />
              <button
                type="submit"
                disabled={!isHex(typed)}
                className="text-primary h-8 px-1.5 text-xs font-medium disabled:opacity-40"
              >
                Use
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function useBackground(mode: BackgroundMode): string {
  const [choice, setChoice] = useState("default");
  useEffect(() => {
    const update = () => setChoice(getBackground(mode));
    update();
    window.addEventListener(BACKGROUND_EVENT, update);
    return () => window.removeEventListener(BACKGROUND_EVENT, update);
  }, [mode]);
  return choice;
}

function Swatch({ color }: { color?: string }) {
  return (
    <span
      aria-hidden="true"
      className="border-border h-5 w-5 shrink-0 rounded-full border"
      style={{
        background:
          color ??
          "conic-gradient(#0F0A1A, #0E1013, #14110F, #0A0F1A, #0F0A1A)",
      }}
    />
  );
}

function Choice({
  label,
  description,
  color,
  active,
  onSelect,
}: {
  label: string;
  description: string;
  color?: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex min-h-[48px] w-full items-center gap-3 px-3.5 py-1.5 text-left",
        active ? "bg-secondary" : "active:bg-accent"
      )}
    >
      <Swatch color={color} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        <span className="text-muted-foreground block truncate text-xs">
          {description}
        </span>
      </span>
      <Check
        aria-hidden="true"
        className={cn("text-primary h-4 w-4 shrink-0", !active && "invisible")}
      />
    </button>
  );
}
