"use client";

import type { Session } from "@/lib/db";

export interface PermissionChipProps {
  session: Session;
  /**
   * header: N-PermMode's 44px shield pill beside the title (violet while a
   * mode is set, the pending mode with a dot while it waits for the turn);
   * composer: the composer card's mode pill, same tap
   */
  variant: "header" | "composer";
  className?: string;
}

/**
 * The shield chip: the session's permission mode (usePermissionMode), a tap
 * opens its Permissions sheet (openPermissionSheet). M7 U3 builds it.
 */
export function PermissionChip(_props: PermissionChipProps) {
  return null;
}
