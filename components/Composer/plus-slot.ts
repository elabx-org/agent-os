"use client";

import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

/**
 * Where ComposerCard holds its + (the caller's menu or its own): collapsed,
 * a 52px glass circle beside the capsule (Closed-Chat); open, a 44px tinted
 * circle at the start of the card's bottom row (E-Composer). Null outside a
 * card, where the + keeps its own look
 */
export const PlusSlot = createContext<{ collapsed: boolean } | null>(null);

export function usePlusSlot() {
  return useContext(PlusSlot);
}

/** The + trigger's size and fill in a card */
export function plusButtonClass(collapsed: boolean): string {
  return cn(
    "text-foreground flex flex-none touch-manipulation items-center justify-center rounded-full active:opacity-70",
    collapsed ? "glass h-[52px] w-[52px]" : "bg-foreground/8 h-11 w-11"
  );
}
