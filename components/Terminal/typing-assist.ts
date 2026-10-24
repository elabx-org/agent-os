"use client";

const STORAGE_KEY = "terminalTypingAssist";

/**
 * iOS autocorrect/predictions on the terminal input. The predictions row above
 * the keyboard costs ~45pt, which matters on short screens like the iPhone Duo
 * outer display, so it can be turned off from the keybar settings.
 */
export function getTypingAssist(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function applyTypingAssist(
  textarea: HTMLTextAreaElement,
  enabled: boolean
) {
  textarea.setAttribute("autocorrect", enabled ? "on" : "off");
  textarea.setAttribute("autocomplete", enabled ? "on" : "off");
  textarea.setAttribute("autocapitalize", "none");
  textarea.setAttribute("spellcheck", enabled ? "true" : "false");
}

export function setTypingAssist(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Storage unavailable: still apply to the open terminals
  }
  document
    .querySelectorAll<HTMLTextAreaElement>(".xterm textarea")
    .forEach((textarea) => applyTypingAssist(textarea, enabled));
}

const COMPOSER_KEY = "terminalComposer";
export const COMPOSER_EVENT = "agentos:composer";

/** Composer box on touch devices (on unless turned off in keybar settings) */
export function getComposerEnabled(): boolean {
  try {
    return localStorage.getItem(COMPOSER_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setComposerEnabled(enabled: boolean) {
  try {
    localStorage.setItem(COMPOSER_KEY, String(enabled));
  } catch {
    // Storage unavailable: still notify open terminals
  }
  window.dispatchEvent(new CustomEvent(COMPOSER_EVENT, { detail: enabled }));
}
