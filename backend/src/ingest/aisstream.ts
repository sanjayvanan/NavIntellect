import WebSocket from 'ws';
import { logger } from '../shared/logger.js';

export interface AisStreamOptions {
  apiKey: string;
  /** [[[lat, lon], [lat, lon]], ...] — aisstream wants latitude first. */
  boundingBoxes: [[number, number], [number, number]][];
  messageTypes?: string[];
  onMessage: (msg: unknown, receivedAt: Date) => void;
  url?: string;
  /** Reconnect if nothing arrives for this long. */
  idleTimeoutMs?: number;
}

/**
 * Resilient aisstream.io client: subscribes immediately on open (the server closes
 * sockets that don't subscribe within 3s), reconnects with jittered exponential backoff,
 * and restarts on an idle watchdog.
 */
export class AisStreamClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private watchdog: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  connected = false;
  messages = 0;

  constructor(private readonly opts: AisStreamOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000);
  }

  get lastMessage(): number {
    return this.lastMessageAt;
  }

  private connect(): void {
    const url = this.opts.url ?? 'wss://stream.aisstream.io/v0/stream';
    const ws = new WebSocket(url, { perMessageDeflate: true, handshakeTimeout: 10_000 });
    this.ws = ws;

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          APIKey: this.opts.apiKey,
          BoundingBoxes: this.opts.boundingBoxes,
          ...(this.opts.messageTypes?.length ? { FilterMessageTypes: this.opts.messageTypes } : {}),
        }),
      );
      this.connected = true;
      this.lastMessageAt = Date.now();
      logger.info({ boxes: this.opts.boundingBoxes.length }, 'aisstream connected and subscribed');
      this.armWatchdog();
    });

    ws.on('message', (data) => {
      const receivedAt = new Date();
      this.lastMessageAt = receivedAt.getTime();
      this.attempt = 0;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      const p = parsed as { error?: string; MessageType?: string };
      if (p?.error) {
        logger.error({ error: p.error }, 'aisstream rejected subscription');
        return;
      }
      if (p?.MessageType === 'SubscriptionConfirmation') return;
      this.messages++;
      this.opts.onMessage(parsed, receivedAt);
    });

    ws.on('close', (code, reason) => {
      this.connected = false;
      logger.warn({ code, reason: reason.toString() }, 'aisstream disconnected');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => logger.warn({ err: err.message }, 'aisstream socket error'));
  }

  private armWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    const idle = this.opts.idleTimeoutMs ?? 60_000;
    this.watchdog = setInterval(() => {
      if (this.ws && this.connected && Date.now() - this.lastMessageAt > idle) {
        logger.warn({ idleMs: Date.now() - this.lastMessageAt }, 'aisstream idle, forcing reconnect');
        this.ws.terminate();
      }
    }, 5_000);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = Math.min(30_000, 1_000 * 2 ** this.attempt++);
    const delay = Math.round(base / 2 + Math.random() * (base / 2));
    logger.info({ delay }, 'aisstream reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
