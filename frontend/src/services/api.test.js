// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiStream } from './api'

/** A fetch Response whose body arrives in the given pieces. */
function streamed(pieces, status = 200) {
  const enc = new TextEncoder()
  const body = new ReadableStream({
    start(c) {
      pieces.forEach((p) => c.enqueue(enc.encode(p)))
      c.close()
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('apiStream (Server-Sent Events)', () => {
  it('parses events split across chunks and resolves with the done event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamed([
      'event: tools\ndata: {"type":"tools","names":["search_ships"]}\n\nevent: del',
      'ta\ndata: {"type":"delta","text":"Hel"}\n\n',
      'event: delta\ndata: {"type":"delta","text":"lo"}\n\nevent: done\ndata: {"reply":"Hello","actions":[]}\n\n',
    ])))
    const events = []
    const result = await apiStream('/api/ai/copilot/stream', { body: {}, onEvent: (e, d) => events.push([e, d.text ?? d.names]) })
    expect(events).toEqual([['tools', ['search_ships']], ['delta', 'Hel'], ['delta', 'lo']])
    expect(result).toEqual({ reply: 'Hello', actions: [] })
  })

  it('throws the error event, and a cut-off stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamed(['event: error\ndata: {"status":429,"error":"Daily limit."}\n\n'])))
    await expect(apiStream('/x', { body: {} })).rejects.toMatchObject({ status: 429, message: 'Daily limit.' })
    vi.stubGlobal('fetch', vi.fn(async () => streamed(['event: delta\ndata: {"text":"Hal"}\n\n'])))
    await expect(apiStream('/x', { body: {} })).rejects.toMatchObject({ status: 502 })
  })

  it('reports an HTTP error before the stream starts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Ask a question.' }), { status: 400 })))
    await expect(apiStream('/x', { body: {} })).rejects.toMatchObject({ status: 400, message: 'Ask a question.' })
  })
})
