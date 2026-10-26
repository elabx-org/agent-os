"use client";

import { NewSurface } from "@/components/New/NewSurface";
import type { NewSessionDialogProps } from "./NewSessionDialog.types";

/**
 * The old New Session dialog: now New (components/New/NewSurface.tsx) set to
 * a session. The app opens New through openNew in stores/newSurface.ts
 */
export function NewSessionDialog({
  selectedProjectId,
  ...props
}: NewSessionDialogProps) {
  return (
    <NewSurface {...props} projectId={selectedProjectId} runAs="session" />
  );
}
