// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import reducer, { nextStep, previousStep, startGuide, stopGuide } from './guideSlice'
import copilotReducer from './copilotSlice'
import { guideTargets, isHowToQuestion } from '../guide/targets'

const steps = [
  { target: 'nav.zones', say: 'Open Zones', action: 'click' },
  { target: 'objects.zone', say: 'Choose Draw zone', action: 'click' },
  { target: 'map', say: 'Draw it on the map', action: 'look' },
]

describe('shadow-cursor guide', () => {
  it('sends "how do I…" questions to the guide and the rest to the copilot', () => {
    for (const q of ['How do I get alerts for an area?', 'how to change the map', 'Show me how to draw a zone', 'Where can I sign out?', 'help me draw a circle'])
      expect(isHowToQuestion(q)).toBe(true)
    for (const q of ['How many ships are in view?', 'Which ships are faster than 20 knots?', 'Take me to Gibraltar'])
      expect(isHowToQuestion(q)).toBe(false)
  })

  it('offers the controls that exist in each layout', () => {
    const desktop = guideTargets('desktop').map((t) => t.id)
    const phone = guideTargets('phone').map((t) => t.id)
    expect(desktop).toContain('nav.layers')
    expect(desktop).not.toContain('nav.more')
    expect(phone).toContain('nav.more')
    expect(phone).toContain('more.layers')
    expect(phone).not.toContain('nav.layers')
    expect(guideTargets('phone').find((t) => t.id === 'nav.zones').label).toBe('Zones')
    expect(guideTargets('desktop').find((t) => t.id === 'nav.zones').label).toBe('Graphical objects')
    expect(new Set(desktop).size).toBe(desktop.length)
  })

  it('walks through the steps, back and forth, then finishes', () => {
    let s = reducer(undefined, startGuide.pending('r', 'How do I draw a zone?'))
    expect(s.status).toBe('loading')
    s = reducer(s, startGuide.fulfilled({ title: 'Draw a zone', steps, note: null }, 'r', 'How do I draw a zone?'))
    expect(s).toMatchObject({ status: 'running', index: 0, title: 'Draw a zone' })
    s = reducer(s, nextStep())
    s = reducer(s, nextStep())
    expect(s.index).toBe(2)
    s = reducer(s, previousStep())
    expect(s.index).toBe(1)
    s = reducer(s, nextStep())
    s = reducer(s, nextStep())
    expect(s.status).toBe('done')
    expect(reducer(s, stopGuide()).status).toBe('idle')
  })

  it('does not start without steps, and records the guide in the chat', () => {
    const none = reducer(undefined, startGuide.fulfilled({ title: 'x', steps: [], note: 'Not possible here.' }, 'r', 'How do I print?'))
    expect(none).toMatchObject({ status: 'idle', note: 'Not possible here.' })

    let chat = copilotReducer(undefined, startGuide.pending('r', 'How do I draw a zone?'))
    expect(chat.busy).toBe(true)
    chat = copilotReducer(chat, startGuide.fulfilled({ title: 'Draw a zone', steps, note: null, usage: { user_used_today: 3 } }, 'r', 'How do I draw a zone?'))
    expect(chat.messages.map((m) => m.text)).toEqual(['How do I draw a zone?', expect.stringContaining('Showing you on screen: Draw a zone (3 steps)')])
    expect(chat).toMatchObject({ busy: false, usage: { user_used_today: 3 } })
    expect(chat.chats).toHaveLength(1)
  })
})
