"use client";

import type { RefObject } from "react";
import type { SendChoice, SendMenuItem } from "@/lib/bg-send";

export interface SendMenuProps {
  open: boolean;
  /** lib/bg-send.ts sendMenuItems */
  items: SendMenuItem[];
  /** The row shown highlighted (N-BgSend: "Send and start a new session") */
  highlighted?: SendChoice;
  onChoose: (choice: SendChoice) => void;
  onClose: () => void;
  /** The composer's card: the menu sits above it, the same width */
  anchorRef: RefObject<HTMLElement | null>;
}

/** N-BgSend's glass menu over the composer: Send / Send and start a new
    session / Send to queue */
export function SendMenu(_props: SendMenuProps) {
  return null;
}
