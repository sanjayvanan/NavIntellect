import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDispatch, useSelector } from 'react-redux'
import { nextStep, previousStep, stopGuide } from '../store/guideSlice'
import { guideTargets } from '../guide/targets'
import { isPhoneLayout } from '../hooks/usePhoneLayout'
import { AiSparkIcon, CloseIcon } from './Icons'
import './ShadowGuide.css'

const POLL_MS = 120 // how often the target is looked up (panels open, animate and move)
const MISSING_MS = 1800 // then say the control is not on screen yet
const ADVANCE_DELAY_MS = 450 // after the user's tap, let the UI react before the next step
const DONE_MS = 2600

/** First visible element marked data-guide="<id>". */
function findTarget(id) {
  for (const el of document.querySelectorAll(`[data-guide="${CSS.escape(id)}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth) return el
  }
  return null
}

const sameRect = (a, b) => a && b && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1

/**
 * The shadow cursor: a ghost pointer glides to each control of the guide's steps, rings it and
 * shows what to do. A step moves on by itself when the user does it (taps the control, or changes
 * a field); "look" steps and missing controls have Next. Esc or ✕ ends the guide.
 */
function ShadowGuide() {
  const dispatch = useDispatch()
  const { status, steps, index, title } = useSelector((state) => state.guide)
  const step = status === 'running' ? steps[index] : null
  const [rect, setRect] = useState(null) // target's box on screen
  const [missing, setMissing] = useState(false)
  const [cursor, setCursor] = useState(null) // { x, y } of the ghost pointer (kept between steps)
  const targetRef = useRef(null)
  const cardRef = useRef(null)
  const [cardPos, setCardPos] = useState(null)

  // Follow the current step's control on screen.
  useEffect(() => {
    if (!step) return
    setMissing(false)
    setRect(null)
    const since = Date.now()
    let last = null
    const look = () => {
      const el = findTarget(step.target)
      targetRef.current = el
      if (!el) {
        if (Date.now() - since > MISSING_MS) setMissing(true)
        return
      }
      setMissing(false)
      const r = el.getBoundingClientRect()
      const box = { left: r.left, top: r.top, width: r.width, height: r.height }
      if (sameRect(box, last)) return
      last = box
      setRect(box)
      // The map is huge: point near its middle; elsewhere at the control's centre (a bit left on wide ones).
      const x = step.target === 'map' ? r.left + r.width / 2 : r.left + Math.min(r.width / 2, 48)
      const y = r.top + r.height / 2
      setCursor({ x, y })
    }
    look()
    const t = setInterval(look, POLL_MS)
    return () => clearInterval(t)
  }, [step])

  // The step is done when the user does it on the real control.
  useEffect(() => {
    if (!step || step.action === 'look') return
    let timer = null
    const advance = () => {
      clearTimeout(timer)
      timer = setTimeout(() => dispatch(nextStep()), ADVANCE_DELAY_MS)
    }
    const inTarget = (e) => targetRef.current && (targetRef.current === e.target || targetRef.current.contains(e.target))
    const onClick = (e) => {
      if (step.action === 'click' && inTarget(e)) advance()
    }
    const onChange = (e) => {
      if (inTarget(e)) advance()
    }
    const onKey = (e) => {
      if (step.action === 'type' && e.key === 'Enter' && inTarget(e)) advance()
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('change', onChange, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('change', onChange, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [step, dispatch])

  // Esc ends the guide; "done" fades out by itself.
  useEffect(() => {
    if (status !== 'running' && status !== 'done') return
    const onKey = (e) => e.key === 'Escape' && dispatch(stopGuide())
    window.addEventListener('keydown', onKey)
    const t = status === 'done' ? setTimeout(() => dispatch(stopGuide()), DONE_MS) : null
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [status, dispatch])

  // Card next to the control: below it, else above; inside the screen.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const w = card.offsetWidth
    const h = card.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const m = 12
    if (!rect || missing) {
      setCardPos({ left: (vw - w) / 2, top: isPhoneLayout() ? m + 70 : vh - h - 90 })
      return
    }
    const big = rect.height > vh * 0.5 // e.g. the map: card at the top
    let top = big ? m + 70 : rect.top + rect.height + 14
    if (!big && top + h > vh - m) top = rect.top - h - 14
    if (top < m) top = Math.min(vh - h - m, rect.top + rect.height + 14)
    const left = Math.max(m, Math.min(vw - w - m, rect.left + rect.width / 2 - w / 2))
    setCardPos({ left, top: Math.max(m, top) })
  }, [rect, missing, status, index])

  if (status !== 'running' && status !== 'done') return null
  const label = step ? guideTargets(isPhoneLayout() ? 'phone' : 'desktop').find((t) => t.id === step.target)?.label : null

  return createPortal(
    <div className="shadow-guide" aria-live="polite">
      {step && rect && !missing && (
        <div
          className={`sg-ring ${step.target === 'map' ? 'big' : ''}`}
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      {cursor && status === 'running' && (
        <div className={`sg-cursor ${missing ? 'waiting' : ''}`} style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }} aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24">
            <defs>
              <linearGradient id="sg-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8b5cf6" />
                <stop offset="1" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <path d="M4 2.5l15 8.2-6.6 1.7-3.1 6.4z" fill="url(#sg-grad)" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          {!missing && <span className="sg-ripple" key={`${index}-${step?.target}`} />}
        </div>
      )}

      <div ref={cardRef} className="sg-card" style={cardPos ?? { visibility: 'hidden' }} role="dialog" aria-label="Guide">
        {status === 'done' ? (
          <p className="sg-done">
            <AiSparkIcon size={16} /> All done!
          </p>
        ) : (
          <>
            <div className="sg-head">
              <span className="sg-title">
                <AiSparkIcon size={14} /> {title}
              </span>
              <button type="button" className="sg-close" onClick={() => dispatch(stopGuide())} aria-label="End the guide">
                <CloseIcon size={14} />
              </button>
            </div>
            <p className="sg-say">{step?.say}</p>
            {missing && (
              <p className="sg-missing">
                I can&apos;t see {label ? `“${label}”` : 'this'} on screen yet. Finish the previous step, or tap Next.
              </p>
            )}
            <div className="sg-foot">
              <span className="sg-count">
                Step {index + 1} of {steps.length}
              </span>
              <span className="sg-buttons">
                {index > 0 && (
                  <button type="button" onClick={() => dispatch(previousStep())}>
                    Back
                  </button>
                )}
                <button type="button" className={step?.action === 'look' || missing ? 'primary' : ''} onClick={() => dispatch(nextStep())}>
                  {index === steps.length - 1 ? 'Finish' : step?.action === 'look' || missing ? 'Next' : 'Skip'}
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

export default ShadowGuide
