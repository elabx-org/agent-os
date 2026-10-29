"use client";

export interface BackgroundSend {
  /**
   * "Send and start a new session": runs `deliver` (the composer's normal
   * send to this session, through the server queue); only when it went
   * (true) creates the fresh session (lib/bg-send.ts freshSessionInput),
   * marks it fresh with the sent-to toast (stores/bgSend.ts) and opens it
   * (requestOpenSession). Resolves false when nothing was created
   */
  sendAndStartNew: (deliver: () => Promise<boolean>) => Promise<boolean>;
  /** Creating the fresh session */
  starting: boolean;
  /** The session is known (in the sessions list) and can start another */
  available: boolean;
}

/** M10 background send for the composer of `sessionId` */
export function useBackgroundSend(_sessionId: string): BackgroundSend {
  return {
    sendAndStartNew: async () => false,
    starting: false,
    available: false,
  };
}
