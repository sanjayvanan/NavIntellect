import { useEffect, useRef } from 'react'
import { startOperatingPicture } from '../lib/operatingPicture'

/** Common operating picture: the 3D coastline view with its contact list. */
export default function OperatingPicture() {
  const canvasRef = useRef(null)
  const labelsRef = useRef(null)
  const listRef = useRef(null)
  const countRef = useRef(null)

  useEffect(
    () => startOperatingPicture({ canvas: canvasRef.current, labels: labelsRef.current, list: listRef.current, count: countRef.current }),
    [],
  )

  return (
    <section className="sec sec-mid" id="cop">
      <div className="grid-bg"></div>
      <div className="wrap">
        <div className="head">
          <div className="rv"><span className="eyebrow">Common operating picture</span><h2>Your coastline.<br /><b>One live picture.</b></h2></div>
          <p className="lead rv" style={{ '--d': '.1s' }}>Every AIS report feeds one shared, live picture. See your zones, contacts and their tracks at a glance — and spot the one vessel that has gone quiet.</p>
        </div>
        <div className="cop rv" style={{ '--d': '.15s' }}>
          <canvas ref={canvasRef} aria-label="Illustrative 3D view of a coastline with a shore station and vessel tracks"></canvas>
          <div className="tlabels" ref={labelsRef}></div>
          <span className="corner c1"></span><span className="corner c2"></span><span className="corner c3"></span><span className="corner c4"></span>
          <div className="bar"><span>Station <b>CSS-07 · Kovalam</b></span><span className="hide-m">Range <b>24 nm</b></span><span className="hide-m">Mode <b>Live AIS</b></span><span className="live">● Live</span></div>
          <div className="panel"><h4><span>Contacts</span><span ref={countRef}>—</span></h4><div ref={listRef}></div></div>
          <div className="legend"><span><i style={{ 'background': 'var(--sonar)' }}></i>Reporting on AIS</span><span><i style={{ 'background': 'var(--brass2)' }}></i>Under review</span><span><i style={{ 'background': 'var(--red)' }}></i>AIS gap</span></div>
          <div className="hint">Drag to orbit</div>
        </div>
      </div>
    </section>
  )
}
