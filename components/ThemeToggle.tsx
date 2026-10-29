"use client";

import { useState } from "react";
import { Moon, Sun, Monitor, Check, Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ACCENTS,
  ACCENT_LABELS,
  applyAccent,
  readAccent,
  type LookMode,
} from "@/lib/look";

const MODES: { id: LookMode; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

/** Mode and accent in one menu */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [accent, setAccent] = useState(readAccent);

  return (
    <DropdownMenu onOpenChange={(open) => open && setAccent(readAccent())}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Palette className="h-4 w-4" />
          <span className="sr-only">Change theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {MODES.map(({ id, label, icon: Icon }) => (
          <DropdownMenuItem key={id} onClick={() => setTheme(id)}>
            <Icon className="mr-2 h-4 w-4" />
            <span>{label}</span>
            {(theme ?? "dark") === id && (
              <Check className="text-primary ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          Accent
        </DropdownMenuLabel>
        {ACCENTS.map((id) => (
          <DropdownMenuItem
            key={id}
            onClick={() => {
              applyAccent(id);
              setAccent(id);
            }}
          >
            <span
              className="mr-2 h-4 w-4 rounded-full"
              style={{ backgroundColor: ACCENT_LABELS[id].hex }}
            />
            <span>{ACCENT_LABELS[id].label}</span>
            {accent === id && (
              <Check className="text-primary ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
