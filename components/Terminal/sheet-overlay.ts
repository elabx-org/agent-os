/**
 * The terminal's own bottom sheets (Snippets, the keyboard, Paste, Keys):
 * dimmed to the edges, but stopping at the iOS app's column so their
 * buttons aren't under it, and on the right page when the Duo is open
 */
export const SHEET_OVERLAY =
  "fixed inset-0 z-50 flex justify-center bg-black/50 [html[data-fold=vertical]_&]:left-[var(--fold-end)] [html[data-hinge]_&]:left-[calc(var(--hinge-x)+var(--fold-clear))] [html[data-native]_&]:right-[env(safe-area-inset-right)]";
