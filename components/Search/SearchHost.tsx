"use client";

import { useLayoutMode } from "@/hooks/useLayoutMode";
import { SearchPage } from "./SearchPage";
import { SearchPalette } from "./SearchPalette";
import type { SearchSurfaceProps } from "./types";

/**
 * M11: Find everywhere. The desktop gets the ⌘K palette (SearchPalette,
 * D-Search); phones and the Duo get the full page (SearchPage, N-Search).
 */
export function SearchHost(props: SearchSurfaceProps) {
  const mode = useLayoutMode();
  return mode === "desktop" ? (
    <SearchPalette {...props} />
  ) : (
    <SearchPage {...props} />
  );
}
