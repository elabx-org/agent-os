/**
 * Credit flow for request bodies a machine sends up the link
 * (lib/link/protocol.ts): the machine sends at most a window of bytes the
 * hub hasn't taken in yet, so a large copy never piles up in the hub's
 * memory. No socket here, so both ends can be tested on their own.
 */

import type { Readable } from "stream";
import { UP_CHUNK, UP_SOCKET_HIGH, UP_WINDOW } from "./protocol";

/** While the socket is too full to say when it drains, look again this often */
const POLL_MS = 20;

export class CreditSender {
  private inFlight = 0;
  private aborted = false;
  private wake: (() => void) | null = null;
  private readonly window: number;
  private readonly chunk: number;
  private readonly high: number;

  constructor(
    private opts: {
      send(chunk: Buffer): void;
      /** Bytes the socket holds unsent */
      buffered(): number;
      window?: number;
      chunk?: number;
      high?: number;
    }
  ) {
    this.window = opts.window ?? UP_WINDOW;
    this.chunk = opts.chunk ?? UP_CHUNK;
    this.high = opts.high ?? UP_SOCKET_HIGH;
  }

  /** Bytes sent that the other end hasn't granted back yet */
  get unacknowledged(): number {
    return this.inFlight;
  }

  /** Sends the whole stream in chunks; rejects when aborted */
  async pipe(source: Readable): Promise<void> {
    for await (const piece of source) {
      let rest: Buffer = Buffer.isBuffer(piece)
        ? piece
        : Buffer.from(piece as string);
      while (rest.length > 0) {
        const part = rest.subarray(0, this.chunk);
        await this.room(part.length);
        this.inFlight += part.length;
        this.opts.send(part);
        rest = rest.subarray(part.length);
      }
    }
    if (this.aborted) throw new Error("aborted");
  }

  /** The other end took in this many bytes */
  credit(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    this.inFlight = Math.max(0, this.inFlight - bytes);
    this.poke();
  }

  abort(): void {
    this.aborted = true;
    this.poke();
  }

  private poke(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private async room(size: number): Promise<void> {
    for (;;) {
      if (this.aborted) throw new Error("aborted");
      const credit = this.inFlight === 0 || this.inFlight + size <= this.window;
      if (credit && this.opts.buffered() <= this.high) return;
      await new Promise<void>((resolve) => {
        const timer = credit ? setTimeout(resolve, POLL_MS) : null;
        this.wake = () => {
          if (timer) clearTimeout(timer);
          resolve();
        };
      });
    }
  }
}

export class CreditReceiver {
  /** Received and not yet granted back */
  private outstanding = 0;
  /** Taken in since the last grant */
  private taken = 0;
  private readonly window: number;

  constructor(
    private opts: {
      window?: number;
      grant(bytes: number): void;
      /** The sender ignored the window: the link should close */
      overrun(): void;
    }
  ) {
    this.window = opts.window ?? UP_WINDOW;
  }

  received(bytes: number): void {
    this.outstanding += bytes;
    if (this.outstanding > this.window * 2) this.opts.overrun();
  }

  /** The body's reader took these bytes; grants once a quarter window is in */
  consumed(bytes: number): void {
    this.taken += bytes;
    if (this.taken < this.window / 4) return;
    const grant = this.taken;
    this.taken = 0;
    this.outstanding = Math.max(0, this.outstanding - grant);
    this.opts.grant(grant);
  }
}
