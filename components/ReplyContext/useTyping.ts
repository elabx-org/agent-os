"use client";

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { isNative } from "@/lib/native-bridge";
import { mobileNavStore } from "@/stores/mobileNav";

/** A touch screen (or the iOS app): where the keyboard takes half the screen */
function useTouch(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const read = () => setTouch(coarse.matches || isNative());
    read();
    coarse.addEventListener("change", read);
    return () => coarse.removeEventListener("change", read);
  }, []);
  return touch;
}

/**
 * The on-screen keyboard is up: the iOS app reports its own; the web reads
 * what useKeyboardInset marks on <html> (as the slim header does)
 */
export function useKeyboardUp(): boolean {
  const { nativeKeyboard } = useSnapshot(mobileNavStore);
  const [web, setWeb] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () =>
      setWeb(
        root.dataset.keyboard === "docked" ||
          root.dataset.keyboard === "floating"
      );
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-keyboard"],
    });
    return () => observer.disconnect();
  }, []);
  return nativeKeyboard || web;
}

/**
 * Typing a reply on a touch screen: the box is focused and the keyboard is
 * up. Waiting for the keyboard (not just focus) means the terminal already
 * keeps its rows when the card appears, so nothing refits. With a mouse and
 * a real keyboard there's room to scroll, so this stays false.
 */
export function useTypingReply(focused: boolean): boolean {
  const touch = useTouch();
  const keyboardUp = useKeyboardUp();
  return touch && focused && keyboardUp;
}
