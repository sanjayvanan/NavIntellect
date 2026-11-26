// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import reducer, { askCopilot, clearConversation, linkShips } from './copilotSlice'

describe('copilot', () => {
  it('turns ship names and MMSIs in an answer into links', () => {
    const ships = [
      { mmsi: 419500001, name: 'BROWSE ALPHA', lat: 1, lon: 2 },
      { mmsi: 9, name: 'MMSI 9', lat: null, lon: null },
    ]
    const parts = linkShips('Browse Alpha (419500001) is near BROWSE ALPHABET.', ships)
    expect(parts).toEqual([
      { ship: ships[0], label: 'Browse Alpha' },
      ' (',
      { ship: ships[0], label: '419500001' },
      ') is near BROWSE ALPHABET.',
    ])
    expect(linkShips('nothing here', [])).toEqual(['nothing here'])
  })

  it('records questions, answers and errors', () => {
    const arg = { text: 'How many ships?', context: {} }
    let s = reducer(undefined, askCopilot.pending('r1', arg))
    expect(s.busy).toBe(true)
    s = reducer(s, askCopilot.fulfilled({ reply: '12 ships.', actions: [{ type: 'fly_to', lat: 1, lon: 2, zoom: 8 }], ships: [], usage: { user_used_today: 2 } }, 'r1', arg))
    expect(s.messages.map((m) => [m.role, m.text])).toEqual([['user', 'How many ships?'], ['assistant', '12 ships.']])
    expect(s.messages[1].actions).toHaveLength(1)
    expect(s.usage.user_used_today).toBe(2)
    s = reducer(reducer(s, askCopilot.pending('r2', arg)), askCopilot.rejected(new Error('You have used your 30 AI requests for today.'), 'r2', arg))
    expect(s.messages.at(-1)).toMatchObject({ role: 'assistant', error: true, text: 'You have used your 30 AI requests for today.' })
    expect(reducer(s, clearConversation()).messages).toEqual([])
  })
})
