"use client";

import { useEffect, useState } from "react";
import { SHORT_SCREEN } from "@/lib/column-spec";

/** A phone on its side: no room for a bar under a session */
export function useShortScreen() {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(SHORT_SCREEN);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return matches;
}
