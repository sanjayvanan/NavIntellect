import ZonesLayer from './geofences/ZonesLayer'
import PinsLayer from './pins/PinsLayer'

/** All map-object layers drawn on the map (mount inside <MapContainer>). */
function MapObjectsLayers() {
  return (
    <>
      <ZonesLayer />
      <PinsLayer />
    </>
  )
}

export default MapObjectsLayers
