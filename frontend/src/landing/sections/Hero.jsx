import heroSunrise from '../assets/hero-sunrise.webp'
import { useEffect, useRef } from 'react'
import AuthLink from '../AuthLink'
import { finePointer, reduceMotion, useUtcClock, whileVisible } from '../lib/motion'

// Targets on the photo, as fractions of the image.
const TARGETS = [
  { x: 0.378, y: 0.548, w: 0.232, h: 0.155, main: true, tag: (
    <>
      <small>TGT-01 · AIS</small>Crude tanker · at anchor
      <br />
      AIS <em>✓ reporting</em> · SOG 0.1 kn
    </>
  ) },
  { x: 0.516, y: 0.508, w: 0.025, h: 0.018, tag: 'TGT-02' },
  { x: 0.619, y: 0.521, w: 0.042, h: 0.016, tag: 'TGT-03' },
  { x: 0.655, y: 0.505, w: 0.016, h: 0.012, tag: 'TGT-04' },
  { x: 0.795, y: 0.508, w: 0.016, h: 0.013, tag: 'TGT-05' },
]

// Bearing tape: a tick every 5°, labels every 30°, two turns so it can scroll either way.
const TICKS = Array.from({ length: 144 }, (_, i) => i * 5)
const BASE_BRG = 78.4

export default function Hero() {
  const heroRef = useRef(null)
  const imgRef = useRef(null)
  const tapeRef = useRef(null)
  const brgRef = useRef(null)
  const lockRefs = useRef([])
  const utc = useUtcClock()

  useEffect(() => {
    const hero = heroRef.current
    const img = imgRef.current
    const tape = tapeRef.current
    let brg = BASE_BRG
    let target = BASE_BRG

    const setTape = () => {
      const w = tape.parentElement.clientWidth
      tape.style.transform = `translateX(${w / 2 - (brg / 5) * 12 - (360 / 5) * 12}px)`
      brgRef.current.textContent = 'BRG ' + (((brg % 360) + 360) % 360).toFixed(1).padStart(5, '0') + '°'
    }

    // Keep each lock box on its ship however the photo is cropped (object-fit: cover).
    const placeLocks = () => {
      const box = img.getBoundingClientRect()
      const hb = hero.getBoundingClientRect()
      const iw = img.naturalWidth || 2200
      const ih = img.naturalHeight || 1236
      const s = Math.max(box.width / iw, box.height / ih)
      const dw = iw * s
      const dh = ih * s
      const ox = box.left - hb.left + (box.width - dw) * 0.5
      const oy = box.top - hb.top + (box.height - dh) * 0.5
      TARGETS.forEach((t, i) => {
        const el = lockRefs.current[i]
        if (!el) return
        el.style.cssText = `left:${ox + t.x * dw}px;top:${oy + t.y * dh}px;width:${Math.max(18, t.w * dw)}px;height:${Math.max(14, t.h * dh)}px`
      })
    }

    setTape()
    const timers = []
    const showLocks = () => {
      placeLocks()
      lockRefs.current.forEach((el, i) => timers.push(setTimeout(() => el?.classList.add('on'), 900 + i * 220)))
    }
    if (img.complete) showLocks()
    else img.addEventListener('load', showLocks, { once: true })

    const onMove = (e) => {
      const r = hero.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width - 0.5
      const y = (e.clientY - r.top) / r.height - 0.5
      hero.style.setProperty('--px', x.toFixed(3))
      hero.style.setProperty('--py', y.toFixed(3))
      target = BASE_BRG + x * 40
    }
    const onLeave = () => {
      hero.style.setProperty('--px', 0)
      hero.style.setProperty('--py', 0)
      target = BASE_BRG
    }
    const parallax = finePointer() && !reduceMotion()
    if (parallax) {
      hero.addEventListener('pointermove', onMove)
      hero.addEventListener('pointerleave', onLeave)
    }
    window.addEventListener('resize', placeLocks)
    const stop = whileVisible(hero, () => {
      brg += (target - brg) * 0.08
      setTape()
      placeLocks()
    })

    return () => {
      stop()
      timers.forEach(clearTimeout)
      img.removeEventListener('load', showLocks)
      window.removeEventListener('resize', placeLocks)
      hero.removeEventListener('pointermove', onMove)
      hero.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <section className="hero" id="hero" ref={heroRef}>
      <div className="hero-media">
        <img
          ref={imgRef}
          src={heroSunrise}
          width="2200"
          height="1236"
          alt="A tanker at anchor on a calm sea at sunrise, with three more ships on the golden horizon"
        />
      </div>
      <div className="hud" aria-hidden="true">
        <div className="frame">
          <i></i>
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div className="cam">
          <span className="rec">
            <i></i>Live
          </span>
          <span>Station CSS-07</span>
          <span>AIS feed</span>
          <span className="hide-m">Sector North</span>
        </div>
        <div className="tape">
          <div className="strip" ref={tapeRef}>
            {TICKS.map((d) => {
              const v = d % 360
              return (
                <span key={d} className={`t${v % 15 === 0 ? ' m' : ''}`}>
                  {v % 30 === 0 && <span>{String(v).padStart(3, '0')}</span>}
                </span>
              )
            })}
          </div>
          <span className="caret"></span>
        </div>
        <div className="brg" ref={brgRef}>
          BRG 078.4°
        </div>
        <div className="cross"></div>
        <div className="coords">
          LAT <b>12°58′42″ N</b>
          <br />
          LON <b>080°17′06″ E</b>
          <br />
          <span>{utc}</span>
        </div>
      </div>
      <div aria-hidden="true">
        {TARGETS.map((t, i) => (
          <div key={i} ref={(el) => (lockRefs.current[i] = el)} className={`lock ${t.main ? 'main' : 'sm'}`}>
            <div className="bx">
              <i></i>
              <i></i>
              <i></i>
              <i></i>
            </div>
            <div className="tag">{t.tag}</div>
          </div>
        ))}
      </div>
      <div className="wrap hero-in">
        <span className="eyebrow up" style={{ '--d': '.3s' }}>
          AI coastal surveillance · Live
        </span>
        <h1 className="up" style={{ '--d': '.45s' }}>
          <span>Every vessel.</span>
          <b>Under watch.</b>
        </h1>
        <p className="sub up" style={{ '--d': '.6s' }}>
          Live AIS traffic on one picture of your coastline — with zones that raise alerts the moment something happens, and an AI copilot
          you can ask about any ship.
        </p>
        <div className="cta-row up" style={{ '--d': '.75s' }}>
          <AuthLink kind="signup" className="btn btn-b">
            Sign up <span className="ar">→</span>
          </AuthLink>
          <AuthLink kind="login" className="btn btn-o">
            Log in to Nav-Intellect
          </AuthLink>
        </div>
      </div>
    </section>
  )
}
