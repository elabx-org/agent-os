"use client";

import { useEffect, useState } from "react";

/** Narrower than this, the adaptive key row: the closed Duo (466), phones */
const NARROW = "(max-width: 599px)";

export function useNarrowScreen() {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return matches;
}
