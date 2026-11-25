import { useMap } from 'react-leaflet'
import { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'

function ZoomControl() {
  const theme = useSelector((state) => state.theme.mode)
  const map = useMap()
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
    <div className={`zoom-control-minimal ${theme}`}>
      <button 
        onClick={handleZoomIn}
        className="zoom-btn"
        title="Zoom in"
        disabled={zoomLevel >= map.getMaxZoom()}
      >
        +
      </button>
      <div className="zoom-level-minimal">
        {zoomLevel.toFixed(0)}
      </div>
      <button 
        onClick={handleZoomOut}
        className="zoom-btn"
        title="Zoom out"
        disabled={zoomLevel <= map.getMinZoom()}
      >
        -
      </button>
    </div>
  )
}

export default ZoomControl 