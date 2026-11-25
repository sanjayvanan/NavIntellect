import { useMap } from 'react-leaflet'
import { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { useIsolateFromMap } from '../hooks/useIsolateFromMap'
import { MinusIcon, PlusIcon } from './Icons'

function ZoomControl() {
  const theme = useSelector((state) => state.theme.mode)
  const map = useMap()
  const ref = useIsolateFromMap()
  const [zoomLevel, setZoomLevel] = useState(map.getZoom())

  useEffect(() => {
    const updateZoom = () => {
      setZoomLevel(map.getZoom())
    }

    map.on('zoom', updateZoom)
    return () => {
      map.off('zoom', updateZoom)
    }
  }, [map])

  const handleZoomIn = () => {
    map.setZoom(map.getZoom() + 1)
  }

  const handleZoomOut = () => {
    map.setZoom(map.getZoom() - 1)
  }

  return (
    <div ref={ref} className={`zoom-control-minimal ${theme}`}>
      <button 
        onClick={handleZoomIn}
        className="zoom-btn"
        title="Zoom in"
        aria-label="Zoom in"
        disabled={zoomLevel >= map.getMaxZoom()}
      >
        <PlusIcon size={18} />
      </button>
      <div className="zoom-level-minimal">
        {zoomLevel.toFixed(0)}
      </div>
      <button 
        onClick={handleZoomOut}
        className="zoom-btn"
        title="Zoom out"
        aria-label="Zoom out"
        disabled={zoomLevel <= map.getMinZoom()}
      >
        <MinusIcon size={18} />
      </button>
    </div>
  )
}

export default ZoomControl 