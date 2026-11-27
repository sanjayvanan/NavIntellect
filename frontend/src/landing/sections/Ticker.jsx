import { useEffect, useState } from 'react'

/** Status strip under the hero (demo values). Rendered twice in a row for a seamless loop. */
export default function Ticker() {
  const [tracks, setTracks] = useState(1284)

  useEffect(() => {
    const t = setInterval(() => setTracks((n) => n + Math.round((Math.random() - 0.5) * 4)), 1000)
    return () => clearInterval(t)
  }, [])

  const items = [
    ['', 'AIS feed', 'Online'],
    ['', 'Active tracks', tracks.toLocaleString('en-US')],
    ['r', 'AIS gaps', '3'],
    ['w', 'AI briefings today', '17'],
    ['', 'Update latency', '~1 s'],
    ['w', 'Geofence alerts', '7'],
    ['', 'Coverage', 'Worldwide'],
    ['', 'Track history', '3 days'],
    ['', 'Watched zones', '6'],
  ]
  const row = (copy) =>
    items.map(([kind, label, value]) => (
      <span key={`${copy}-${label}`} aria-hidden={copy === 1 || undefined}>
        <i className={kind || undefined}></i>
        {label} <b>{value}</b>
      </span>
    ))

  return (
    <div className="ticker" aria-label="System status (demo values)">
      <div className="in">
        {row(0)}
        {row(1)}
      </div>
    </div>
  )
}
