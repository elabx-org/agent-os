"use client";

import { useCallback, useEffect } from "react";
import { useSnapshot } from "valtio";
import { usePreference, useUpdatePreference } from "@/data/preferences";
import {
  TERMINAL_FONT_KEY,
  readTerminalFont,
  setTerminalFont,
  terminalFontStore,
  type TerminalFont,
} from "@/lib/terminal-font";

/** Loads the saved terminal font into terminalFontStore. Mounted once (app/page.tsx) */
export function useTerminalFontSource(): void {
  const { data } = usePreference<TerminalFont | null>(TERMINAL_FONT_KEY, null);
  useEffect(() => {
    if (data) setTerminalFont(readTerminalFont(data));
  }, [data]);
}

/** The terminal font and a setter that saves it for every device */
export function useTerminalFont(): {
  font: TerminalFont;
  save: (font: TerminalFont) => void;
} {
  const { font } = useSnapshot(terminalFontStore);
  const update = useUpdatePreference();
  const save = useCallback(
    (next: TerminalFont) => {
      setTerminalFont(next);
      update.mutate({ key: TERMINAL_FONT_KEY, value: next });
    },
    [update]
  );
  return { font, save };
}
