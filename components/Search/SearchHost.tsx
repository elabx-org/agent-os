"use client";

import { QuickSwitcher } from "@/components/QuickSwitcher";
import type { SearchSurfaceProps } from "./types";

/**
 * M11: Find everywhere. The desktop gets the ⌘K palette (SearchPalette,
 * D-Search); phones and the Duo get the full page (SearchPage, N-Search).
 * Until U11.3 lands this is the old QuickSwitcher. Owned by U11.3
 */
export function SearchHost(props: SearchSurfaceProps) {
  return <QuickSwitcher {...props} />;
}
