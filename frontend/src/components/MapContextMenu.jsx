import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { useMap } from 'react-leaflet'
import { MapContextMenu as Menu } from '../map/contextMenu'
import { mapObjectMenuItems } from '../features/mapObjects/contextMenuItems'
import '../map/contextMenu.css'

/**
 * Mounts the map's right-click menu. Each feature contributes its entries here; add a feature's
 * item list to `providers` to extend the menu.
 */
function MapContextMenu() {
  const map = useMap()
  const dispatch = useDispatch()

  useEffect(() => {
    const providers = [mapObjectMenuItems]
    const menu = new Menu(map, () => providers.flatMap((items) => items(dispatch)))
    return () => menu.destroy()
  }, [map, dispatch])

  return null
}

export default MapContextMenu
