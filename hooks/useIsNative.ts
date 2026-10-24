"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native-bridge";

/** Inside the iOS app; false on the server and the first render, so hydration matches */
export function useIsNative(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNative()), []);
  return native;
}
