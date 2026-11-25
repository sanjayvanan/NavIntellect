import type { AisMsg } from './types.js';

export interface BatcherOptions {
  flushIntervalMs: number;
  maxRows: number;
  /** Hard cap on buffered messages; beyond it the oldest messages are dropped (backpressure). */
  maxBuffer: number;
  onFlush: (batch: AisMsg[]) => Promise<void>;
  onError?: (err: unknown, batch: AisMsg[]) => void;
}

export interface BatcherStats {
  received: number;
  flushed: number;
  dropped: number;
  flushes: number;
  failedFlushes: number;
  lastFlushMs: number;
  buffered: number;
}

/**
 * Buffers messages and flushes them every `flushIntervalMs` or when `maxRows` is reached.
 * Only one flush is in flight at a time; messages keep buffering while a flush runs.
 * A failed batch is put back at the front of the buffer (subject to maxBuffer) so a
 * transient DB outage loses nothing until the buffer overflows.
 */
export class Batcher {
  private buffer: AisMsg[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  readonly stats: BatcherStats = {
    received: 0, flushed: 0, dropped: 0, flushes: 0, failedFlushes: 0, lastFlushMs: 0, buffered: 0,
  };

  constructor(private readonly opts: BatcherOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
    this.timer.unref?.();
  }

  push(...msgs: AisMsg[]): void {
    this.stats.received += msgs.length;
    this.buffer.push(...msgs);
    this.enforceCap();
    if (this.buffer.length >= this.opts.maxRows) void this.flush();
  }

  /** Flushes once; if a flush is already running, waits for it instead of starting another. */
  async flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.opts.maxRows);
    const started = Date.now();
    this.inFlight = (async () => {
      try {
        await this.opts.onFlush(batch);
        this.stats.flushed += batch.length;
        this.stats.flushes++;
      } catch (err) {
        this.stats.failedFlushes++;
        this.buffer.unshift(...batch);
        this.enforceCap();
        this.opts.onError?.(err, batch);
      } finally {
        this.stats.lastFlushMs = Date.now() - started;
        this.inFlight = null;
      }
    })();
    await this.inFlight;
    // Drain quickly if we're behind.
    if (this.buffer.length >= this.opts.maxRows) void this.flush();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight) await this.inFlight;
    while (this.buffer.length) {
      const before = this.buffer.length;
      await this.flush();
      if (this.buffer.length >= before) break; // flush failing; give up on shutdown
    }
  }

  get size(): number {
    return this.buffer.length;
  }

  private enforceCap(): void {
    const over = this.buffer.length - this.opts.maxBuffer;
    if (over > 0) {
      this.buffer.splice(0, over);
      this.stats.dropped += over;
    }
    this.stats.buffered = this.buffer.length;
  }
}
