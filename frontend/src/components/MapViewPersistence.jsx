import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { useMap } from 'react-leaflet'
import { setMapView } from '../store/themeSlice'

/** Records where the user is looking (centre + zoom) after every pan/zoom, so it is restored next sign-in. */
function MapViewPersistence() {
  const map = useMap()
  const dispatch = useDispatch()
  useEffect(() => {
    const save = () => {
      // worldCopyJump lets the longitude run past ±180; store the wrapped position.
      const c = map.wrapLatLng(map.getCenter())
      dispatch(setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }))
    }
    map.on('moveend', save)
    return () => {
      map.off('moveend', save)
    }
  }, [map, dispatch])
  return null
}

export default MapViewPersistence
