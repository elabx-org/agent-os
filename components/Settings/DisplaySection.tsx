"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Check, ChevronRight, Monitor } from "lucide-react";
import { TextSizeControl } from "@/components/TextSizeControl";
import {
  DARK_THEMES,
  LIGHT_THEMES,
  buildTheme,
  parseTheme,
  type ThemeMode,
  type ThemeOption,
} from "@/lib/theme-config";
import { cn } from "@/lib/utils";
import { SettingGroup } from "./SettingGroup";

/** "Dark · Graphite", for the theme row and the section list */
export function themeLabel(theme: string | undefined): string {
  const { mode, variant } = parseTheme(theme || "system");
  if (mode === "system") return "System";
  const list = mode === "dark" ? DARK_THEMES : LIGHT_THEMES;
  const option = list.find((t) => t.id === variant);
  return `${mode === "dark" ? "Dark" : "Light"} · ${option?.label ?? variant}`;
}

/**
 * Text size for this display, and the theme as a list that opens in place:
 * no nested menus, so it works by touch.
 */
export function DisplaySection() {
  const { theme, setTheme } = useTheme();
  const [themesOpen, setThemesOpen] = useState(false);
  const { mode, variant } = parseTheme(theme || "system");

  return (
    <SettingGroup>
      {/* Its own label, at the size of the other rows */}
      <div className="[&>div>span:first-child]:text-foreground flex min-h-[50px] items-center px-3.5 py-1.5 [&>div]:flex-1 [&>div>span:first-child]:text-sm">
        <TextSizeControl />
      </div>
      <button
        type="button"
        aria-expanded={themesOpen}
        onClick={() => setThemesOpen((o) => !o)}
        className="active:bg-accent flex min-h-[50px] w-full items-center gap-3 px-3.5 py-1.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm">Theme</span>
          <span className="text-muted-foreground block truncate text-xs">
            {themeLabel(theme)}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "text-muted-foreground h-4 w-4 transition-transform",
            themesOpen && "rotate-90"
          )}
        />
      </button>
      {themesOpen && (
        <div role="radiogroup" aria-label="Theme" className="py-1">
          <ThemeChoice
            label="System"
            description="Follows this device's light or dark setting"
            icon={Monitor}
            active={mode === "system"}
            onSelect={() => setTheme("system")}
          />
          <ThemeList
            title="Dark"
            mode="dark"
            options={DARK_THEMES}
            current={mode === "dark" ? variant : null}
            onSelect={setTheme}
          />
          <ThemeList
            title="Light"
            mode="light"
            options={LIGHT_THEMES}
            current={mode === "light" ? variant : null}
            onSelect={setTheme}
          />
        </div>
      )}
    </SettingGroup>
  );
}

function ThemeList({
  title,
  mode,
  options,
  current,
  onSelect,
}: {
  title: string;
  mode: Exclude<ThemeMode, "system">;
  options: ThemeOption[];
  current: string | null;
  onSelect: (theme: string) => void;
}) {
  return (
    <>
      <div className="text-muted-foreground px-3.5 pt-3 pb-1 text-[11.5px] font-semibold tracking-[.07em] uppercase">
        {title}
      </div>
      {options.map((option) => (
        <ThemeChoice
          key={option.id}
          label={option.label}
          description={option.description}
          icon={option.icon}
          preview={option.preview}
          active={current === option.id}
          onSelect={() => onSelect(buildTheme(mode, option.id))}
        />
      ))}
    </>
  );
}

function ThemeChoice({
  label,
  description,
  icon: Icon,
  preview,
  active,
  onSelect,
}: {
  label: string;
  description: string;
  icon: ThemeOption["icon"];
  preview?: ThemeOption["preview"];
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
      <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        <span className="text-muted-foreground block truncate text-xs">
          {description}
        </span>
      </span>
      {preview && (
        <span aria-hidden="true" className="flex shrink-0 gap-1">
          <span
            className="border-border/50 h-4 w-6 rounded-sm border"
            style={{ backgroundColor: preview.background }}
          />
          <span
            className="border-border/50 h-4 w-6 rounded-sm border"
            style={{ backgroundColor: preview.accent }}
          />
        </span>
      )}
      <Check
        aria-hidden="true"
        className={cn("text-primary h-4 w-4 shrink-0", !active && "invisible")}
      />
    </button>
  );
}
