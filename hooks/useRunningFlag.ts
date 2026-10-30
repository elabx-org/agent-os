"use client";

import { useEffect } from "react";
import { useFlag } from "@/hooks/useFlags";
import { runningStore } from "@/stores/running";

/** Mirrors Labs' Running flag into runningStore, for More and nav */
export function useRunningFlag() {
  const on = useFlag("running");
  useEffect(() => {
    runningStore.enabled = on;
  }, [on]);
}
