import { describe, expect, it } from 'vitest';
import { pacificDay } from '../src/ai/budget.js';
import { distanceNm, summarizeTrack } from '../src/ai/tools.js';
import { AiTracer, memoryTraceSink, promptVersion } from '../src/ai/trace.js';
import { chunkMarkdown, keywordQuery, loadCorpus, numberQuery } from '../src/ai/knowledge.js';

describe('AI helpers', () => {
  it('measures distance in nautical miles', () => {
    expect(distanceNm([0, 0], [0, 1])).toBeCloseTo(60.04, 1); // one degree of latitude ≈ 60 nm
    expect(distanceNm([10, 20], [10, 20])).toBe(0);
  });

  it('summarises a track without sending every point', () => {
    const coords = Array.from({ length: 101 }, (_, i) => [i * 0.01, 0]);
    const t0 = Date.UTC(2026, 10, 26, 0, 0);
    const times = coords.map((_, i) => t0 + i * 60_000); // one point a minute, 100 minutes
    const s = summarizeTrack({ geometry: { type: 'LineString', coordinates: coords }, properties: { points: 101, max_sog: 12.3, times } }, 6);
    expect(s).toMatchObject({ points: 101, max_speed_kn: 12.3, start: { time: '2026-11-26T00:00Z', lon: 0 }, end: { lon: 1 } });
    expect(s.distance_nm).toBeCloseTo(60, 0);
    expect(s.avg_speed_kn).toBeCloseTo(36, 0); // 60 nm in 100 min
    expect(s.waypoints!.length).toBeLessThanOrEqual(9);
    expect(summarizeTrack({ geometry: null, properties: { points: 0, max_sog: null, times: null } }, 24)).toEqual({
      hours: 24, points: 0, note: 'No positions in this period.',
    });
  });

  it('counts free-tier days in Pacific time', () => {
    expect(pacificDay(new Date('2026-11-26T07:59:00Z'))).toBe('2026-11-25'); // 23:59 PST
    expect(pacificDay(new Date('2026-11-26T08:00:00Z'))).toBe('2026-11-26');
  });

  it('traces requests: tokens, cost at list price, tool outcomes and failures', async () => {
    const sink = memoryTraceSink();
    const tracer = new AiTracer(sink, { model: 'm', prices: { inputPerM: 1, outputPerM: 4 } });
    const run = tracer.run({ feature: 'copilot', userId: 'not-a-uuid', promptVersion: 'v1' });
    let n = 0;
    const model = run.wrap({
      async generate() {
        if (n++ === 1) throw new Error('boom');
        return { functionCalls: [{ name: 'get_ship', args: { mmsi: 1 } }], usage: { prompt: 1000, output: 500 } };
      },
    });
    await model.generate({ contents: [], systemInstruction: '', allowTools: true });
    run.tool(0, { error: 'Ship not found.' }, 12.4);
    await expect(model.generate({ contents: [], systemInstruction: '', allowTools: true })).rejects.toThrow('boom');
    await run.finish();
    await run.finish(); // written once
    expect(sink.rows).toHaveLength(2);
    expect(sink.rows[0]).toMatchObject({
      user_id: null, round: 0, outcome: 'tool_calls', prompt_tokens: 1000, output_tokens: 500, cost_usd: 0.003,
      tool_calls: [{ name: 'get_ship', args: { mmsi: 1 }, ok: false, ms: 12, error: 'Ship not found.' }],
    });
    expect(sink.rows[1]).toMatchObject({ round: 1, outcome: 'error', error: 'Error: boom' });
    expect(promptVersion('a', [1])).not.toBe(promptVersion('a', [2]));
  });

  it('splits notes into titled sections and builds search queries', async () => {
    const chunks = chunkMarkdown('x.md', '# Doc\n\nintro ignored\n\n## First\nOne.\n\n## Second\nTwo\nlines.\n## Empty\n');
    expect(chunks.map((c) => [c.title, c.body])).toEqual([['Doc: First', 'One.'], ['Doc: Second', 'Two\nlines.']]);
    expect(chunks[0]!.hash).not.toBe(chunks[1]!.hash);
    expect(keywordQuery("What's MID 563? mid")).toBe('what | s | mid | 563');
    expect(numberQuery('status 5, MID 563 and rule 15')).toBe('563 | 15'); // single digits are too common
    const corpus = await loadCorpus();
    expect(new Set(corpus.map((c) => c.source))).toEqual(new Set(['ais-basics.md', 'ais-codes.md', 'app.md', 'behaviour.md', 'collision-rules.md', 'mmsi.md']));
    expect(corpus.every((c) => c.body.length > 100 && c.body.length < 1600)).toBe(true);
  });
});
