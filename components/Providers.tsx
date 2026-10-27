"use client";

import { useState, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmHost } from "@/components/ui/confirm";
import { BrowserUndo } from "@/components/BrowserUndo";
import { VideoReview } from "@/components/Composer/VideoReview";
import { createQueryClient } from "@/lib/query-client";
import { parseTheme, getAllThemes } from "@/lib/theme-config";
import { applyBackground } from "@/lib/background";
import { useUpdatePrompt } from "@/hooks/useUpdatePrompt";

function ThemeClassHandler({ children }: { children: React.ReactNode }) {
  const { theme, systemTheme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    let actualTheme = theme;
    if (theme === "system") {
      actualTheme = systemTheme || "dark";
    }
    const { mode, variant } = parseTheme(actualTheme || "dark");
    root.classList.remove("dark", "light");
    root.removeAttribute("data-theme-variant");
    root.classList.add(mode === "system" ? "dark" : mode);
    if (variant && variant !== "default" && variant !== "deep") {
      root.setAttribute("data-theme-variant", variant);
    }
    // Light and dark keep separate backgrounds
    applyBackground();
  }, [theme, systemTheme]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  useUpdatePrompt();

  return (
    <QueryClientProvider client={queryClient}>
      <NextThemesProvider
        attribute="data-theme"
        defaultTheme="dark-graphite"
        enableSystem
        disableTransitionOnChange
        themes={getAllThemes()}
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
