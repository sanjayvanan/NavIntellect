import { MapContainer, LayerGroup } from 'react-leaflet'
import { useSelector } from 'react-redux'
import ShipLayer from './ShipLayer'
import { MapObjectsLayers } from '../features/mapObjects'
import MapContextMenu from './MapContextMenu'
import ZoomControl from './ZoomControl'
import MapAutoResize from './MapAutoResize'
import MapViewPersistence from './MapViewPersistence'
import CompactAttribution from './CompactAttribution'
import 'leaflet/dist/leaflet.css'
import BottomBar from './BottomBar'

function MapComponent({ children }) {
  // Opens where the user left off (read once: MapContainer ignores later center/zoom changes).
  const savedView = useSelector((state) => state.theme.view)
  const center = savedView ? [savedView.lat, savedView.lng] : [20, 0]
  const zoom = savedView ? savedView.zoom : 3

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
      <MapViewPersistence />
      <CompactAttribution />
      {children}
      
      {/* Ship Layer */}
      <MapObjectsLayers />
      <MapContextMenu />
      <LayerGroup>
        <ShipLayer />
      </LayerGroup>
      
      <ZoomControl />
      <BottomBar />
    </MapContainer>
  )
}

export default MapComponent