"use client";

import { useEffect, type RefObject } from "react";

/**
 * A picture asked to be shown full screen: a tapped path in the terminal, a
 * thumbnail in the chat. The event bubbles from where it was tapped to the
 * view that shows the viewer and knows its composer, so a pane shows only
 * its own.
 */
export const IMAGE_EVENT = "agentos-image";

export function showImage(from: Element | null | undefined, path: string) {
  from?.dispatchEvent(
    new CustomEvent<string>(IMAGE_EVENT, { detail: path, bubbles: true })
  );
}

/** Calls onImage with each picture asked for inside the element */
export function useImageEvents(
  ref: RefObject<HTMLElement | null>,
  onImage: (path: string) => void
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (e: Event) => {
      e.stopPropagation();
      onImage((e as CustomEvent<string>).detail);
    };
    el.addEventListener(IMAGE_EVENT, on);
    return () => el.removeEventListener(IMAGE_EVENT, on);
  }, [ref, onImage]);
}
