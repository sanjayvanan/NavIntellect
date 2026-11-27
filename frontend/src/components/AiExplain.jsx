/* eslint-disable react/prop-types -- internal component; the project does not use PropTypes */
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { usageUpdated } from '../store/copilotSlice'
import { AiSparkIcon } from './Icons'
import './AiExplain.css'

/**
 * "✦ Explain" button for one-shot AI answers (ship briefing, why an alert matters). Asks only
 * when pressed: answers are generated once on the server, cached and counted in the AI budget.
 * Hidden when the server has no AI. `load(signal)` -> { text, cached, usage }.
 */
function AiExplain({ load, label, guide, className = '', iconOnly = false }) {
  const dispatch = useDispatch()
  const enabled = useSelector((state) => state.copilot.enabled)
  const [state, setState] = useState({ status: 'idle' })
  const abortRef = useRef(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  if (enabled === false) return null

  const run = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setState({ status: 'loading' })
    try {
      const r = await load(ctrl.signal)
      if (r.usage) dispatch(usageUpdated(r.usage))
      setState({ status: 'done', text: r.text, cached: r.cached })
    } catch (err) {
      if (ctrl.signal.aborted) return
      setState({ status: 'error', error: err.message || 'The AI could not answer. Try again.' })
    }
  }

  return (
    <div className={`ai-explain ${className}`}>
      {state.status === 'idle' &&
        (iconOnly ? (
          <button type="button" className="ai-explain-icon" data-guide={guide} onClick={run} title={`${label} (AI)`} aria-label={`${label} (AI)`}>
            <AiSparkIcon size={14} />
          </button>
        ) : (
          <button type="button" className="ai-explain-btn" data-guide={guide} onClick={run}>
            <AiSparkIcon size={13} />
            {label}
          </button>
        ))}
      {state.status === 'loading' && (
        <div className="ai-explain-loading" role="status">
          <AiSparkIcon size={13} />
          <span>{iconOnly ? `${label}…` : 'Thinking…'}</span>
        </div>
      )}
      {state.status === 'done' && (
        <div className="ai-explain-answer">
          <p>{state.text}</p>
          <small>
            <AiSparkIcon size={11} /> AI-generated from the live data · may be wrong{state.cached ? ' · saved answer' : ''}
          </small>
        </div>
      )}
      {state.status === 'error' && (
        <div className="ai-explain-error" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={run}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

export default AiExplain
