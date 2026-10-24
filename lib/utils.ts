import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Runs a menu action once the menu has closed. In the iOS app a confirm()
 * asked for while the menu is closing under the finger can fail to show.
 */
export function afterMenuCloses(action: () => void) {
  setTimeout(action, 120);
}
