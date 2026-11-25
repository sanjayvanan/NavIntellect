import { MapContainer, TileLayer, LayerGroup } from 'react-leaflet'
import ShipLayer from './ShipLayer'
import ZoomControl from './ZoomControl'
import MapAutoResize from './MapAutoResize'
import { useState } from 'react'
import 'leaflet/dist/leaflet.css'
import BottomBar from './BottomBar'

function MapComponent({ children }) {
  const [theme, setTheme] = useState('dark')
  const center = [20, 0]
  const zoom = 3

  // Only define vertical bounds
  const MAX_BOUNDS = [
    [-90, -Infinity], // Southwest coordinates (unlimited west)
    [90, Infinity]    // Northeast coordinates (unlimited east)
  ]

  return (
    <MapContainer 
      center={center} 
      zoom={zoom} 
      style={{ height: '100%', width: '100%' }}
      minZoom={3}
      maxZoom={18}
      worldCopyJump={true}
      zoomControl={false}
      maxBounds={MAX_BOUNDS}
      maxBoundsViscosity={1.0}
      noWrap={false}    // Allow wrapping around the world
    >
      <MapAutoResize />
      {children}
      
      {/* Ship Layer */}
      <LayerGroup>
        <ShipLayer />
      </LayerGroup>
      
      <ZoomControl theme={theme} />
      <BottomBar />
    </MapContainer>
  )
}

export default MapComponent