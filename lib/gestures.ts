/**
 * Which touch gesture owns the finger right now, so row swipes, long
 * presses and drags don't all act on the same touch.
 */
export const gestures = { dragging: false, swiping: false };
