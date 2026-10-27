"use client";

import { useEffect, useState } from "react";

/** Taller than wide: the closed Duo, the open Duo turned upright, phones */
const PORTRAIT = "(orientation: portrait)";

export function usePortrait() {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(PORTRAIT);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return matches;
}
