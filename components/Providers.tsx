"use client";

import { useState, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmHost } from "@/components/ui/confirm";
import { BrowserUndo } from "@/components/BrowserUndo";
import { VideoReview } from "@/components/Composer/VideoReview";
import { createQueryClient } from "@/lib/query-client";
import { THEMES } from "@/lib/theme-config";
import {
  applyAccent,
  isLookMode,
  legacyThemeToLook,
  readAccent,
} from "@/lib/look";
import { applyBackground } from "@/lib/background";
import { useUpdatePrompt } from "@/hooks/useUpdatePrompt";
import { useSyncedLook } from "@/hooks/useSyncedLook";

function ThemeClassHandler({ children }: { children: React.ReactNode }) {
  const { theme, systemTheme, setTheme } = useTheme();
  // A synced look from the server wins over this device's on load
  useSyncedLook();

  useEffect(() => {
    // A pre-redesign value (another tab, an old caller): its mode and accent
    if (theme && !isLookMode(theme)) {
      const look = legacyThemeToLook(theme);
      applyAccent(look.accent);
      setTheme(look.mode);
      return;
    }
    const root = document.documentElement;
    const mode = theme === "system" ? systemTheme || "dark" : theme || "dark";
    root.classList.remove("dark", "light");
    root.classList.add(mode === "light" ? "light" : "dark");
    root.setAttribute("data-accent", readAccent());
    // Light and dark keep separate backgrounds
    applyBackground();
  }, [theme, systemTheme, setTheme]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  useUpdatePrompt();

  return (
    <QueryClientProvider client={queryClient}>
      <NextThemesProvider
        attribute="data-theme"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
        themes={[...THEMES]}
      >
        <ThemeClassHandler>
          <TooltipProvider delayDuration={200}>
            {children}
            <ConfirmHost />
            <BrowserUndo />
            <VideoReview />
          </TooltipProvider>
        </ThemeClassHandler>
      </NextThemesProvider>
    </QueryClientProvider>
  );
}
