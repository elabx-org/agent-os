"use client";

import type { CSSProperties, ReactNode } from "react";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useSyncedLook } from "@/hooks/useSyncedLook";
import { ACCENTS, ACCENT_LABELS, type Accent, type LookMode } from "@/lib/look";
import { MODE_LABEL } from "@/lib/look-sync";
import { MAX_OFFSET, MIN_OFFSET, offsetLabel } from "@/lib/display-density";
import { cn } from "@/lib/utils";
import { SettingGroup, SettingRow, Toggle } from "./SettingGroup";
import { BackgroundChoice } from "./BackgroundChoice";

const GUTTERS =
  "ml-[var(--settings-gutter-l,20px)] mr-[var(--settings-gutter-r,20px)]";

/**
 * Appearance (light, dark, automatic), the accent, the text size for this
 * display and whether every device shares them (E-Display).
 */
export function DisplaySection() {
  const { look, setLook } = useSyncedLook();
  const layout = useLayoutMode();
  const accentHex = ACCENT_LABELS[look.accent].hex;

  return (
    <div className="flex flex-col gap-3.5">
      <div
        role="radiogroup"
        aria-label="Appearance"
        className={cn("grid grid-cols-3 gap-2.5", GUTTERS)}
      >
        {(["light", "dark", "system"] as const).map((mode) => (
          <ModeTile
            key={mode}
            mode={mode}
            accent={accentHex}
            active={look.mode === mode}
            onSelect={() => setLook({ mode })}
          />
        ))}
      </div>

      <Card className="gap-3">
        <span className="text-[16px] font-medium">Accent</span>
        <div
          role="radiogroup"
          aria-label="Accent"
          className="flex flex-wrap items-center gap-3.5"
        >
          {ACCENTS.map((accent) => (
            <Swatch
              key={accent}
              accent={accent}
              active={look.accent === accent}
              onSelect={() => setLook({ accent })}
            />
          ))}
        </div>
      </Card>

      <Card className="gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[16px] font-medium">Text size</span>
          <span className="text-muted-foreground text-[14px]">
            {offsetLabel(look.textSize)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="text-[13px]">
            A
          </span>
          <TextSizeSlider
            value={look.textSize}
            onChange={(textSize) => setLook({ textSize })}
          />
          <span aria-hidden="true" className="text-[20px]">
            A
          </span>
        </div>
      </Card>

      <SettingGroup className="my-0">
        <SettingRow
          label="Same look on all devices"
          hint={`Off: this ${layout === "desktop" ? "device" : "phone"} keeps its own`}
        >
          <Toggle
            checked={look.synced}
            onCheckedChange={(synced) => setLook({ synced })}
            aria-label="Same look on all devices"
          />
        </SettingRow>
        <BackgroundChoice />
      </SettingGroup>
    </div>
  );
}

function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card flex flex-col rounded-[20px] p-3.5",
        GUTTERS,
        className
      )}
    >
      {children}
    </div>
  );
}

/** A small picture of each appearance; Automatic is half of each */
const PREVIEW: Record<
  LookMode,
  { background: string; line: string; border?: string }
> = {
  light: {
    background: "#F2F2F7",
    line: "#D1D1D6",
    border: "rgba(0,0,0,.08)",
  },
  dark: { background: "#000", line: "#2C2C30" },
  system: {
    background: "linear-gradient(90deg,#F2F2F7 50%,#000 50%)",
    line: "#8E8E93",
  },
};

function ModeTile({
  mode,
  accent,
  active,
  onSelect,
}: {
  mode: LookMode;
  accent: string;
  active: boolean;
  onSelect: () => void;
}) {
  const preview = PREVIEW[mode];
  const line = (width: string, background: string): CSSProperties => ({
    width,
    background,
  });
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "bg-card flex flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] px-1 py-3 text-[13px]",
        active
          ? "border-primary dark:border-meter bg-[var(--row-sel)]"
          : "border-transparent"
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-[54px] w-full flex-col gap-[5px] rounded-[10px] p-2"
        style={{
          background: preview.background,
          border: preview.border ? `1px solid ${preview.border}` : undefined,
        }}
      >
        <span className="h-1.5 rounded-[3px]" style={line("60%", accent)} />
        <span
          className="h-1.5 rounded-[3px]"
          style={line("100%", preview.line)}
        />
        <span
          className="h-1.5 rounded-[3px]"
          style={line("70%", preview.line)}
        />
      </span>
      {MODE_LABEL[mode]}
    </button>
  );
}

function Swatch({
  accent,
  active,
  onSelect,
}: {
  accent: Accent;
  active: boolean;
  onSelect: () => void;
}) {
  const { label, hex } = ACCENT_LABELS[accent];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      onClick={onSelect}
      className="h-[34px] w-[34px] shrink-0 rounded-full"
      style={{
        background: hex,
        boxShadow: active
          ? `0 0 0 2px hsl(var(--card)), 0 0 0 4px ${hex}`
          : undefined,
      }}
    />
  );
}

/** A− … A+ as one slider: the violet track up to the step, a white thumb */
function TextSizeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const pct = ((value - MIN_OFFSET) / (MAX_OFFSET - MIN_OFFSET)) * 100;
  return (
    <input
      type="range"
      min={MIN_OFFSET}
      max={MAX_OFFSET}
      step={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Text size for this display"
      aria-valuetext={offsetLabel(value)}
      className="h-6 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent [--fill:hsl(var(--primary))] dark:[--fill:hsl(var(--meter))] [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_2px_6px_rgba(0,0,0,.25)] [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-sm [&::-moz-range-track]:bg-[image:var(--track)] [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-sm [&::-webkit-slider-runnable-track]:bg-[image:var(--track)] [&::-webkit-slider-thumb]:-mt-2.5 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(0,0,0,.25)]"
      style={
        {
          "--track": `linear-gradient(to right, var(--fill) ${pct}%, hsl(var(--foreground) / 0.1) ${pct}%)`,
        } as CSSProperties
      }
    />
  );
}
