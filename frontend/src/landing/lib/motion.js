import { useEffect, useState } from 'react'

export const DEG = Math.PI / 180
export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
export const finePointer = () => window.matchMedia('(pointer: fine)').matches

/**
 * Runs step(dt, now) on every animation frame, but only while `el` is on screen and the tab is
 * visible. Returns a function that stops it.
 */
export function whileVisible(el, step) {
  let on = false
  let raf = 0
  let last = 0
  let stopped = false
  const tick = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000 || 0)
    last = t
    step(dt, t)
    raf = on && !document.hidden && !stopped ? requestAnimationFrame(tick) : 0
  }
  const go = () => {
    if (!raf && on && !document.hidden && !stopped) {
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
  }
  const io = new IntersectionObserver(
    (es) => {
      on = es[0].isIntersecting
      go()
    },
    { rootMargin: '120px' },
  )
  io.observe(el)
  document.addEventListener('visibilitychange', go)
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    io.disconnect()
    document.removeEventListener('visibilitychange', go)
  }
}

/** "UTC 14:02:31", ticking every second. */
export function useUtcClock() {
  const now = () => 'UTC ' + new Date().toISOString().slice(11, 19)
  const [time, setTime] = useState(now)
  useEffect(() => {
    const t = setInterval(() => setTime(now()), 1000)
    return () => clearInterval(t)
  }, [])
  return time
}

/** Calls onEnter(true/false) as the element scrolls in and out of view. */
export function useInView(ref, onChange, options) {
  useEffect(() => {
    const io = new IntersectionObserver((es) => onChange(es[0].isIntersecting), options)
    io.observe(ref.current)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once
  }, [])
}
