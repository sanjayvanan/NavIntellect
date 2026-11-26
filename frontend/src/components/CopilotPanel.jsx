/* eslint-disable react/prop-types -- internal components; the project does not use PropTypes */
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { askCopilot, clearConversation, deleteChat, linkShips, loadCopilotStatus, openChat, requestShipList } from '../store/copilotSlice'
import { timeAgo } from '../utils/alertText'
import { usePhoneLayout } from '../hooks/usePhoneLayout'
import { startGuide } from '../store/guideSlice'
import { isHowToQuestion } from '../guide/targets'
import { showTrack } from '../store/shipSlice'
import { zoomToPoint } from '../map/navigation'
import { boundsToBbox } from '../utils/mapBbox'
import { AiSparkIcon, ChatsIcon, CloseIcon, PlusIcon, SendIcon } from './Icons'
import './CopilotPanel.css'

// Touch screens: focusing the text box pops up the on-screen keyboard over the panel, so it is
// only focused when the user taps it (on a laptop it is focused straight away, ready to type).
const focusUnlessTouch = (el) => {
  if (!window.matchMedia?.('(pointer: coarse)').matches) el?.focus()
}

// Tapping Send must not take the focus from the text box: on a phone that closes the keyboard,
// the panel jumps back down, and the tap can miss the button.
const keepFocus = (e) => e.preventDefault()

// "How do I…?" is answered by the shadow cursor on the real screen (see ShadowGuide).
const HOW_TO = [
  'How do I get alerts when ships enter an area?',
  'How do I see where a ship has been?',
  'How do I switch to the satellite map?',
]

const SUGGESTIONS = [
  'How many ships are in my view right now?',
  'Which ships here are faster than 20 knots?',
  'Show the alerts from the last 24 hours',
  'Take me to the Strait of Gibraltar',
]

const ACTION_LABELS = {
  show_ship: (a) => `Opened ${a.name}`,
  show_track: (a) => `Track ${a.hours}h · ${a.name}`,
  show_zone: (a) => `Zoomed to ${a.name}`,
  fly_to: (a) => `Moved to ${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}`,
  filter_ships: (a) => `Ship list${a.query ? ` “${a.query}”` : ''}`,
}

/** Carries out a copilot map action (also used when the user clicks the action chip again). */
function useMapActions() {
  const map = useMap()
  const dispatch = useDispatch()
  const zones = useSelector((state) => state.zones.items)
  return (a) => {
    switch (a.type) {
      case 'show_ship':
        window.handleShipFocus?.(a.mmsi, a.lat, a.lon)
        break
      case 'show_track':
        window.handleShipFocus?.(a.mmsi, a.lat, a.lon)
        dispatch(showTrack({ mmsi: a.mmsi, hours: a.hours }))
        break
      case 'show_zone': {
        const zone = zones.find((z) => z.id === a.zone_id)
        const bounds = zone ? L.geoJSON(zone).getBounds() : null
        if (bounds?.isValid()) map.fitBounds(bounds, { padding: [40, 40] })
        break
      }
      case 'fly_to':
        zoomToPoint(map, [a.lat, a.lon], a.zoom)
        break
      case 'filter_ships':
        dispatch(requestShipList({ query: a.query, zone_id: a.zone_id, sort: a.sort }))
        break
      default:
    }
  }
}

/** List of saved chats: open one to carry on with it, or delete it. */
function ChatList({ chats, activeChatId, busy, onOpen, onDelete }) {
  if (!chats.length) return <p className="cp-history-empty">No saved chats yet. Your chats appear here after the first question.</p>
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <ul className="cp-history">
      {sorted.map((c) => (
        <li key={c.id} className={c.id === activeChatId ? 'active' : ''}>
          <button type="button" className="cp-history-open" onClick={() => onOpen(c.id)} disabled={busy}>
            <span className="cp-history-title">{c.title}</span>
            <small>
              {Math.ceil(c.messages.length / 2)} question{c.messages.length > 2 ? 's' : ''} · {timeAgo(c.updatedAt)}
              {c.id === activeChatId ? ' · open' : ''}
            </small>
          </button>
          <button type="button" className="cp-history-delete" onClick={() => onDelete(c.id)} disabled={busy && c.id === activeChatId} aria-label={`Delete chat: ${c.title}`} title="Delete chat">
            <CloseIcon size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Phones, while the on-screen keyboard is open: the part of the screen above it
 * ({ top, height } in px, from window.visualViewport), else null. iOS does not shrink the page
 * for the keyboard; it slides the page up instead, which would carry this bottom sheet (and what
 * you are typing) off the top of the screen. The panel is placed in this area instead.
 */
function useKeyboardArea(active) {
  const [area, setArea] = useState(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!active || !vv) {
      setArea(null)
      return
    }
    const update = () => {
      const open = vv.height < window.innerHeight * 0.85
      setArea(open ? { top: Math.round(vv.offsetTop), height: Math.round(vv.height) } : null)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      // Undo the slide-up iOS may leave behind once the keyboard has gone.
      setTimeout(() => window.scrollTo(0, 0), 50)
    }
  }, [active])
  return area
}

const CursorIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 2.5l15 8.2-6.6 1.7-3.1 6.4z" fill="currentColor" />
  </svg>
)

function Answer({ message, onShip }) {
  const parts = linkShips(message.text, message.ships)
  return (
    <p className="cp-text">
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <span key={i}>{p}</span>
        ) : (
          <button key={i} type="button" className="cp-ship-link" onClick={() => onShip(p.ship)} title="Show on the map">
            {p.label}
          </button>
        ),
      )}
    </p>
  )
}

/**
 * AI copilot (sidebar ✦): ask about the live ships, zones and alerts in plain words. Gemini runs
 * on the server with tools over the app's API; its map actions (open a ship, draw a track, zoom
 * to a zone, open the ship list) are carried out here. Shows the free-tier usage.
 */
function CopilotPanel({ style, theme, onClose }) {
  const dispatch = useDispatch()
  const map = useMap()
  const runAction = useMapActions()
  const { enabled, usage, messages, busy, model, chats, activeChatId } = useSelector((state) => state.copilot)
  const [showChats, setShowChats] = useState(false)
  const phone = usePhoneLayout()
  const [typing, setTyping] = useState(false) // the text box has focus
  const keyboard = useKeyboardArea(phone && typing)
  const selected = useSelector((state) => state.ships.selectedShip)
  const [text, setText] = useState('')
  const ref = useRef(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const requestRef = useRef(null)
  const handledRef = useRef(new Set(messages.map((m) => m.id))) // answers whose actions already ran

  useEffect(() => {
    L.DomEvent.disableClickPropagation(ref.current)
    L.DomEvent.disableScrollPropagation(ref.current)
    dispatch(loadCopilotStatus())
    focusUnlessTouch(inputRef.current)
  }, [dispatch])

  // Keyboard opened or resized: keep the latest messages in view above the text box.
  useEffect(() => {
    if (keyboard) listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [keyboard?.height]) // eslint-disable-line react-hooks/exhaustive-deps -- only on size changes

  // Carry out the map actions of each new answer once.
  useEffect(() => {
    for (const m of messages) {
      if (handledRef.current.has(m.id)) continue
      handledRef.current.add(m.id)
      if (m.old) continue // from a saved chat: its actions ran back then
      m.actions?.forEach(runAction)
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runAction is rebuilt every render
  }, [messages])

  const send = (question) => {
    const q = question.trim()
    if (!q || busy) return
    setText('')
    const context = {
      bbox: boundsToBbox(map.getBounds()),
      zoom: Math.round(map.getZoom()),
      selected: selected ? { mmsi: selected.mmsi, name: selected.track_name?.trim() || undefined } : null,
    }
    if (isHowToQuestion(q)) {
      // Shown on screen: the panel steps aside once the guide has its steps.
      const request = dispatch(startGuide(q))
      requestRef.current = request
      request.then((r) => {
        if (r.payload?.steps?.length) onClose()
      })
      return
    }
    requestRef.current = dispatch(askCopilot({ text: q, context }))
  }

  const openShip = (s) => runAction({ type: 'show_ship', mmsi: s.mmsi, lat: s.lat, lon: s.lon })
  const suggestions = selected
    ? [`Where has ${selected.track_name?.trim() || `MMSI ${selected.mmsi}`} been in the last 24 hours?`, ...SUGGESTIONS.slice(0, 3)]
    : SUGGESTIONS
  const left = usage ? Math.max(0, usage.user_limit_today - usage.user_used_today) : null

  return (
    <div
      ref={ref}
      className={`layer-control-panel copilot-panel ${theme} ${keyboard ? 'cp-keyboard' : ''}`}
      data-guide-panel="ai"
      style={keyboard ? { ...style, '--kb-top': `${keyboard.top}px`, '--kb-height': `${keyboard.height}px` } : style}
    >
      <div className="panel-header">
        <span className="cp-title">
          <AiSparkIcon size={18} /> AI copilot
        </span>
        <span className="cp-header-actions">
          {enabled !== false && (
            <>
              <button
                type="button"
                className={`cp-icon-btn ${showChats ? 'on' : ''}`}
                onClick={() => setShowChats((v) => !v)}
                aria-pressed={showChats}
                aria-label="Saved chats"
                title="Saved chats"
              >
                <ChatsIcon size={16} />
              </button>
              <button
                type="button"
                className="cp-icon-btn"
                onClick={() => {
                  dispatch(clearConversation())
                  setShowChats(false)
                  focusUnlessTouch(inputRef.current)
                }}
                disabled={busy || (messages.length === 0 && !showChats)}
                aria-label="New chat"
                title="New chat (this one stays in Saved chats)"
              >
                <PlusIcon size={16} />
              </button>
            </>
          )}
          <button className="panel-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </span>
      </div>

      {enabled === false ? (
        <div className="cp-empty">
          <p>The AI copilot is not set up on the server.</p>
          <small>
            Add a free Gemini key as <code>GEMINI_API_KEY</code> in <code>backend/.env</code> and restart the backend.
          </small>
        </div>
      ) : showChats ? (
        <div className="cp-messages">
          <ChatList
            chats={chats}
            activeChatId={activeChatId}
            busy={busy}
            onOpen={(id) => {
              dispatch(openChat(id))
              setShowChats(false)
            }}
            onDelete={(id) => dispatch(deleteChat(id))}
          />
        </div>
      ) : (
        <>
          <div className="cp-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && (
              <div className="cp-welcome">
                <p>Ask about the ships, zones and alerts on the map. I can also open ships, draw tracks and move the map, or show you how to do something.</p>
                <div className="cp-suggestions">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} disabled={busy || enabled == null}>
                      {s}
                    </button>
                  ))}
                </div>
                <p className="cp-howto-title">
                  <CursorIcon /> Show me how (a guide on your screen)
                </p>
                <div className="cp-suggestions howto">
                  {HOW_TO.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} disabled={busy || enabled == null}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="cp-msg user">
                  <p className="cp-text">{m.text}</p>
                </div>
              ) : (
                <div key={m.id} className={`cp-msg assistant ${m.error ? 'error' : ''}`}>
                  <Answer message={m} onShip={openShip} />
                  {m.actions?.length > 0 && (
                    <div className="cp-actions">
                      {m.actions.map((a, i) => (
                        <button key={i} type="button" onClick={() => runAction(a)} title="Do this again">
                          {ACTION_LABELS[a.type]?.(a) ?? a.type}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.cached && <small className="cp-cached">Answered from cache (no AI request used)</small>}
                </div>
              ),
            )}
            {busy && (
              <div className="cp-msg assistant cp-thinking" role="status">
                <span />
                <span />
                <span />
                <small>Looking at the live data…</small>
              </div>
            )}
          </div>

          <form
            className="cp-input"
            onSubmit={(e) => {
              e.preventDefault()
              send(text)
            }}
          >
            <textarea
              ref={inputRef}
              rows={2}
              value={text}
              maxLength={2000}
              placeholder={busy ? 'Thinking…' : 'Ask about ships, zones or alerts…'}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(text)
                }
              }}
              aria-label="Ask the AI copilot"
            />
            {busy ? (
              <button type="button" className="cp-send" onPointerDown={keepFocus} onClick={() => requestRef.current?.abort()} aria-label="Stop">
                <CloseIcon size={16} />
              </button>
            ) : (
              <button type="submit" className="cp-send" onPointerDown={keepFocus} disabled={!text.trim() || enabled == null} aria-label="Send">
                <SendIcon size={16} />
              </button>
            )}
          </form>
          {usage && (
            <div className="cp-usage" title="Each question uses 1–4 AI requests. Repeated questions are answered from cache.">
              <span>
                AI today: {usage.user_used_today} / {usage.user_limit_today} for you · {usage.used_today} / {usage.limit_today} total
              </span>
              <meter min={0} max={usage.user_limit_today} value={usage.user_used_today} low={usage.user_limit_today * 0.7} high={usage.user_limit_today * 0.9} />
              {left === 0 && <small>Your AI requests for today are used up. They reset at midnight Pacific time.</small>}
              {model && <small className="cp-model">Gemini · {model}</small>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default CopilotPanel
