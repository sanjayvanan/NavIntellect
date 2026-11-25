import { useEffect, useRef } from 'react'
import { DrawTool } from './DrawTool'
import { PinDropTool } from './PinDropTool'

/**
 * Creates the interactive map tools once per map and routes their events to `handlers`
 * ({ onReadout, onDrawFinish, onPinPlaced, onCancel }). Handlers are read through a ref, so
 * callers can pass fresh closures every render without re-creating the tools.
 * Returns a ref: { draw: DrawTool, pin: PinDropTool }.
 */
export function useMapTools(map, handlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const tools = useRef(null)

  useEffect(() => {
    const h = () => handlersRef.current
    const draw = new DrawTool(map, {
      onChange: (r) => h().onReadout?.(r),
      onFinish: (result) => h().onDrawFinish?.(result),
      onCancel: () => h().onCancel?.(),
    })
    const pin = new PinDropTool(map, {
      onPlace: (latlng) => h().onPinPlaced?.(latlng),
      onCancel: () => h().onCancel?.(),
    })
    tools.current = { draw, pin }
    return () => {
      draw.destroy()
      pin.destroy()
      tools.current = null
    }
  }, [map])

  return tools
}
