import { postToNative, type HapticStyle } from "@/lib/native-bridge";

/** Feedback for a touch action; does nothing outside the iOS app */
export function haptic(style: HapticStyle = "light") {
  postToNative({ type: "haptic", style });
}
