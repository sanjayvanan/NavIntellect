import { useEffect, useRef, useState } from 'react'
import { startScope } from '../lib/scope'

const MODES = [
  ['radar', 'Radar'],
  ['ais', 'AIS'],
  ['fused', 'Fused'],
]

/** Radar × AIS fusion (on the roadmap): an interactive scope preview. */
export default function RadarScope() {
  const canvasRef = useRef(null)
  const els = useRef({})
  const scope = useRef(null)
  const [mode, setMode] = useState('fused')

  useEffect(() => {
    scope.current = startScope({ canvas: canvasRef.current, els: els.current })
    return () => scope.current.stop()
  }, [])

  useEffect(() => {
    scope.current?.setMode(mode)
  }, [mode])

  return (
    <section className="sec sec-mid" id="radar">
      <div className="wrap radar-grid">
        <div className="scope-wrap rv">
          <canvas id="scope" ref={canvasRef} aria-label="Preview of the planned radar display with AIS targets overlaid"></canvas>
          <div className="shud tl">Range<b>12 NM</b></div>
          <div className="shud tr">Heading<b>072.0° T</b></div>
          <div className="shud bl">Own ship<b>14.6 kn</b></div>
          <div className="shud br">Targets<b ref={(el) => (els.current['#rCount'] = el)}>—</b></div>
        </div>
        <div>
          <span className="eyebrow rv">Radar × AIS fusion · On the roadmap</span>
          <h2 className="rv" style={{ '--d': '.1s' }}>What the radar sees.<br /><b>Who it really is.</b></h2>
          <p className="lead rv" style={{ '--d': '.15s' }}>Radar shows you echoes. AIS tells you names, courses and intentions. Next on the roadmap: laying them on top of each other — so every blip has an identity, and every blip without one stands out. Today Nav-Intellect runs on AIS; this view is a preview.</p>
          <div className="modes rv" style={{ '--d': '.2s' }} role="tablist" aria-label="Radar display mode">
            {MODES.map(([key, label]) => (
              <button key={key} role="tab" className={mode === key ? 'on' : undefined} aria-selected={mode === key} onClick={() => setMode(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="rcard rv" style={{ '--d': '.25s' }} aria-live="polite">
            <div className="t" ref={(el) => (els.current['#rcT'] = el)}><i></i><span ref={(el) => (els.current['#rcTitle'] = el)}>Hover or tap a target on the scope</span></div>
            <div className="g">
              <div><small>BRG</small><span ref={(el) => (els.current['#rcBrg'] = el)}>—</span></div>
              <div><small>RNG</small><span ref={(el) => (els.current['#rcRng'] = el)}>—</span></div>
              <div><small>CPA</small><span ref={(el) => (els.current['#rcCpa'] = el)}>—</span></div>
              <div><small>TCPA</small><span ref={(el) => (els.current['#rcTcpa'] = el)}>—</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
