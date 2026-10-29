"use client";

import type { Session } from "@/lib/db";
import type { ClaudeTool } from "@/lib/claude-state";
import type { PermissionPrompt } from "@/lib/permission-prompt";

/**
 * A permission request waiting for the user: from Claude's hook state
 * (chat) and/or the prompt on screen (inbox); at least one is set.
 */
export interface PendingPermission {
  tool: ClaudeTool | null;
  prompt: PermissionPrompt | null;
}

export interface PermissionCardProps {
  session: Session;
  permission: PendingPermission;
  onAnswered?: () => void;
  /** As the Inbox card's variants; "full" by default */
  variant?: "full" | "card" | "page";
}

/** Allow / Deny / Switch to full access, the lock note and blocked attempts */
export function PermissionCard(_props: PermissionCardProps) {
  return null;
}
