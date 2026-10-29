/** The counts the Now subline is made of */
export interface NowCounts {
  needs: number;
  working: number;
  limited: number;
  settledToday: number;
}

/**
 * "2 need you · 2 working[ · N limited][ · N settled today]": zero counts
 * left out, "All quiet" when everything is zero
 */
export function nowSubline(counts: NowCounts): string {
  // Contract stub: U1.3
  void counts;
  return "";
}
