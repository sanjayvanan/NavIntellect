// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import reducer, { askCopilot, clearConversation, conversationRestored, deleteChat, linkShips, loadChat, openChat, saveChat } from './copilotSlice'

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

  it('keeps a list of chats and switches between them', () => {
    const answer = (text, arg) => askCopilot.fulfilled({ reply: text, actions: [{ type: 'fly_to', lat: 1, lon: 2 }] }, 'r', arg)
    let s = reducer(undefined, askCopilot.pending('r1', { text: 'First chat question' }))
    s = reducer(s, answer('First answer', { text: 'First chat question' }))
    const firstId = s.activeChatId
    expect(s.chats).toHaveLength(1)
    expect(s.chats[0]).toMatchObject({ id: firstId, title: 'First chat question' })

    s = reducer(s, clearConversation()) // new chat: the old one stays in the list
    expect(s.messages).toEqual([])
    expect(s.chats).toHaveLength(1)
    s = reducer(s, askCopilot.pending('r2', { text: 'Second' }))
    expect(s.chats).toHaveLength(2)
    expect(s.activeChatId).not.toBe(firstId)
    expect(reducer(s, openChat(firstId)).activeChatId).not.toBe(firstId) // not while answering
    s = reducer(s, answer('Second answer', { text: 'Second' }))

    s = reducer(s, openChat(firstId)) // back to the first chat
    expect(s.activeChatId).toBe(firstId)
    expect(s.messages.map((m) => m.text)).toEqual(['First chat question', 'First answer'])
    expect(s.messages.every((m) => m.old)).toBe(true) // its map actions are not run again
    s = reducer(s, askCopilot.pending('r3', { text: 'Follow-up' }))
    expect(s.chats.find((c) => c.id === firstId).messages).toHaveLength(3)
    s = reducer(s, answer('Follow-up answer', { text: 'Follow-up' }))
    expect(s.chats.find((c) => c.id === firstId).messages).toHaveLength(4)

    s = reducer(s, deleteChat(firstId))
    expect(s.chats).toHaveLength(1)
    expect(s.messages).toEqual([])
  })

  it('saves each user\'s chats in the browser and restores them', () => {
    localStorage.clear()
    const chat = { id: 'c1', title: 'Hi', updatedAt: 1, messages: [
      { id: 1, role: 'user', text: 'Hi' },
      { id: 2, role: 'assistant', text: 'Hello', actions: [], ships: [] },
    ] }
    saveChat('u1', { chats: [chat], activeChatId: 'c1' })
    expect(loadChat('u1')).toEqual({ chats: [chat], activeChatId: 'c1' })
    expect(loadChat('u2')).toEqual({ chats: [], activeChatId: null }) // other users see nothing
    const state = reducer(undefined, conversationRestored(loadChat('u1')))
    expect(state.messages.map((m) => m.text)).toEqual(['Hi', 'Hello'])
    expect(state.messages.every((m) => m.old)).toBe(true)

    // The earlier one-chat format becomes one saved chat.
    localStorage.setItem('css.copilot.chat.u4', JSON.stringify(chat.messages))
    const old = loadChat('u4')
    expect(old.chats).toHaveLength(1)
    expect(old.chats[0]).toMatchObject({ title: 'Hi', messages: chat.messages })
    expect(old.activeChatId).toBe(old.chats[0].id)

    saveChat('u1', { chats: [], activeChatId: null })
    expect(localStorage.getItem('css.copilot.chat.u1')).toBeNull()
    localStorage.setItem('css.copilot.chat.u3', '{broken')
    expect(loadChat('u3')).toEqual({ chats: [], activeChatId: null })
  })
})
