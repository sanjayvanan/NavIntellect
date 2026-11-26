import type { Redis } from 'ioredis';
import { evaluateZones, sweepAisGaps, type AlertRow } from '../alerts/engine.js';
import { logger } from '../shared/logger.js';
import { CHANNELS } from '../shared/redis.js';
import { Batcher } from './batcher.js';
import { HistorySampler } from './sampler.js';
import type { AisMsg } from './types.js';
import { writeBatch } from './writer.js';

export interface PipelineOptions {
  redis: Redis;
  flushIntervalMs: number;
  maxRows: number;
  maxBuffer: number;
  alertCooldownMinutes: number;
  /** Store at most one history point per vessel per this many seconds (0 = keep all). */
  historySampleSeconds?: number;
  /** Also store a point when a moving vessel turns this many degrees (0 = off). */
  historyTurnDegrees?: number;
}

/** Batcher -> DB write -> Redis publish -> zone evaluation -> alert publish. */
export function createPipeline(opts: PipelineOptions) {
  const publishAlerts = async (alerts: AlertRow[]) => {
    if (alerts.length === 0) return;
    await opts.redis.publish(CHANNELS.alerts, JSON.stringify(alerts));
    logger.info({ count: alerts.length, types: alerts.map((a) => a.type) }, 'alerts raised');
  };

  const sampler = new HistorySampler((opts.historySampleSeconds ?? 0) * 1000, opts.historyTurnDegrees ?? 0);

  const batcher = new Batcher({
    flushIntervalMs: opts.flushIntervalMs,
    maxRows: opts.maxRows,
    maxBuffer: opts.maxBuffer,
    onFlush: async (batch: AisMsg[]) => {
      const res = await writeBatch(batch, sampler);
      if (res.updated.length) await opts.redis.publish(CHANNELS.vessels, JSON.stringify(res.updated));
      try {
        await publishAlerts(await evaluateZones(res.latest, opts.alertCooldownMinutes));
      } catch (err) {
        // Positions are committed; don't re-queue the batch because of an alert failure.
        logger.error({ err }, 'zone evaluation failed');
      }
    },
    onError: (err, batch) => logger.error({ err, size: batch.length }, 'batch write failed; re-queued'),
  });

  return {
    batcher,
    publishAlerts,
    sweepGaps: async (gapMinutes: number) => publishAlerts(await sweepAisGaps(gapMinutes, opts.alertCooldownMinutes)),
  };
}
