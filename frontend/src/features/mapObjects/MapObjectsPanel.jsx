/* eslint-disable react/prop-types -- feature container; the project does not use PropTypes */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { CloseIcon } from '../../components/Icons'
import { zoomToBounds, zoomToPoint } from '../../map/navigation'
import { setHidden } from '../../store/themeSlice'
import { densify, toGeoJsonPolygon } from '../../utils/geo'
import { canEdit, isOperator } from './scope'
import { describeObject, shapeFromDrawing } from './objectTypes'
import { commandHandled, selectObject } from './uiSlice'
import { initialPanelState, panelReducer } from './panelState'
import { ACTIONS, actionById, actionOfTool, toolById } from './tools/registry'
import { useMapTools } from './tools/useMapTools'
import { RulerResultCard } from './tools/DrawingCards'
import { ToolGuideBar } from './tools/ToolGuideBar'
import { ConfirmBox, ErrorNote } from './ui/controls'
import { ObjectTabs } from './ui/ObjectTabs'
import { createZone, deleteZone, updateZone } from './geofences/zonesSlice'
import { ZoneForm } from './geofences/ZoneForm'
import { newZoneForm, zoneFormFrom } from './geofences/zoneFormModel'
import { ZoneDetails } from './geofences/ZoneDetails'
import { zoneColor } from './geofences/zoneStyle'
import { createPin, deletePin, updatePin, clearPinsError } from './pins/pinsSlice'
import { PinForm } from './pins/PinForm'
import { newPinForm, pinFormFrom } from './pins/pinFormModel'
import { PinDetails } from './pins/PinDetails'
import { PinGlyph } from './pins/PinParts'
import { PIN_ICON_LABELS, pinLatLng } from './pins/pinStyle'
import { useDraftPinMarker } from './pins/useDraftPinMarker'
import './MapObjectsPanel.css'

const PIN_FOCUS_ZOOM = 12

/**
 * "Graphical objects" panel: three actions (drop pin, draw zone, measure), the active card
 * (save form / details) and tabbed lists of pins and zones. While a tool is active, a step-by-step
 * guide with live measurements is shown on the map itself (ToolGuideBar).
 */
function MapObjectsPanel({ style, theme, onClose }) {
  const map = useMap()
  const dispatch = useDispatch()
  const user = useSelector((s) => s.auth.user)
  const zones = useSelector((s) => s.zones.items)
  const zonesStatus = useSelector((s) => s.zones.status)
  const pins = useSelector((s) => s.pins.items)
  const pinsError = useSelector((s) => s.pins.error)
  const hidden = useSelector((s) => s.theme.hidden)
  const selection = useSelector((s) => s.mapObjectsUi.selection)
  const command = useSelector((s) => s.mapObjectsUi.command)
  const [state, send] = useReducer(panelReducer, initialPanelState)
  const [filter, setFilter] = useState('')
  const [listTab, setListTab] = useState(null) // null = pick a sensible tab (see below)
  const [typeFilter, setTypeFilter] = useState(null) // object type shown in the list (null = all)
  const lastShape = useRef('polygon') // "Draw zone" reopens the shape used last
  const panelRef = useRef(null)
  const canShare = isOperator(user)
  const { tool, readout, view, confirm, saving, error } = state
  const activeTool = toolById(tool)

  // The panel sits over the map: keep its clicks, drags and wheel away from it.
  useEffect(() => {
    L.DomEvent.disableClickPropagation(panelRef.current)
    L.DomEvent.disableScrollPropagation(panelRef.current)
  }, [])

  // ---------- tools ----------
  const viewRef = useRef(view)
  viewRef.current = view
  const tools = useMapTools(map, {
    onReadout: (r) => send({ type: 'readout', readout: r }),
    onCancel: () => send({ type: 'toolEnded' }),
    onPinPlaced: (latlng) => send({ type: 'show', view: { kind: 'pinDraft', latlng } }),
    onDrawFinish: ({ mode, points, readout: r, origin }) => {
      if (mode === 'ruler') return send({ type: 'show', view: { kind: 'ruler', readout: r } })
      let geometry
      try {
        // Polygons/rectangles: add vertices along the drawn lines (see densify); circles are already dense.
        geometry = toGeoJsonPolygon(mode === 'circle' ? points : densify(points, true))
      } catch (err) {
        tools.current.draw.clearResult()
        send({ type: 'toolEnded' })
        return send({ type: 'error', error: err.message })
      }
      const shape = {
        geometry,
        ...shapeFromDrawing(mode, points, r, origin), // shape + shape_meta saved with the zone
        measures: { areaNm2: r.areaNm2, perimeterNm: r.perimeterNm, radiusNm: r.radiusNm, widthNm: r.widthNm, heightNm: r.heightNm },
      }
      if (viewRef.current.kind === 'zoneEdit') send({ type: 'redrawn', redraw: shape })
      else send({ type: 'show', view: { kind: 'zoneDraft', ...shape } })
    },
  })

  const stopTools = () => {
    tools.current?.draw.cancel()
    tools.current?.pin.cancel()
  }

  const startTool = (id, { from, keepView = false } = {}) => {
    const t = toolById(id)
    stopTools()
    tools.current.draw.clearResult()
    send({ type: 'toolStarted', tool: id, keepView })
    if (t.type === 'pin') tools.current.pin.start()
    else tools.current.draw.start(t.mode, { from })
  }

  /** Panel action button: starts its tool, or stops it when it is already running. */
  const toggleAction = (actionId) => {
    if (actionOfTool(tool)?.id === actionId) return stopTools()
    const action = actionById(actionId)
    startTool(actionId === 'zone' ? lastShape.current : action.tools[0])
  }

  /** Shape picker in the guide bar (keeps an edit-in-progress open when redrawing). */
  const switchTool = (id) => {
    if (toolById(id).action === 'zone') lastShape.current = id
    startTool(id, { keepView: viewRef.current.kind === 'zoneEdit' })
  }

  // Commands from outside the panel (map context menu).
  useEffect(() => {
    if (!command || !tools.current) return
    if (command.kind === 'dropPin') {
      stopTools()
      send({ type: 'show', view: { kind: 'pinDraft', latlng: command.latlng } })
    } else if (command.kind === 'measureFrom') {
      startTool('ruler', { from: command.latlng })
    }
    dispatch(commandHandled(command.seq))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per command
  }, [command])

  useDraftPinMarker(map, view.kind === 'pinDraft' ? view.latlng : null, (latlng) => send({ type: 'movePinDraft', latlng }))

  // ---------- actions ----------
  const run = async (thunk, onDone) => {
    send({ type: 'saving' })
    const res = await dispatch(thunk)
    if (res.error) return send({ type: 'failed', error: res.payload || 'Something went wrong' })
    send({ type: 'saved' })
    onDone?.(res.payload)
  }

  const zoomToZone = (zone) => {
    zoomToBounds(map, L.geoJSON(zone.geometry).getBounds(), { padding: [60, 60], maxZoom: 12 })
    if (hidden.zone.includes(zone.id)) dispatch(setHidden({ type: 'zone', ids: [zone.id], hidden: false }))
  }
  const zoomToPin = (pin) => {
    zoomToPoint(map, pinLatLng(pin), Math.max(map.getZoom(), PIN_FOCUS_ZOOM))
    if (hidden.pin.includes(pin.id)) dispatch(setHidden({ type: 'pin', ids: [pin.id], hidden: false }))
  }

  const saveZoneDraft = (body) =>
    run(createZone({ ...body, geometry: view.geometry, shape: view.shape, shape_meta: view.shape_meta }), (zone) => {
      tools.current.draw.clearResult()
      dispatch(selectObject({ type: 'zone', id: zone.id }))
    })

  const saveZoneEdit = (body) => {
    // eslint-disable-next-line no-unused-vars -- a zone's scope can't change after creation
    const { scope, ...rest } = body
    const redraw = view.redraw ? { geometry: view.redraw.geometry, shape: view.redraw.shape, shape_meta: view.redraw.shape_meta } : {}
    run(updateZone({ id: view.zoneId, ...rest, ...redraw }), () =>
      tools.current.draw.clearResult(),
    )
  }

  const savePinDraft = (body) =>
    run(createPin({ ...body, latlng: view.latlng }), (pin) => dispatch(selectObject({ type: 'pin', id: pin.id })))

  const savePinEdit = (body) => {
    // eslint-disable-next-line no-unused-vars -- scope can't change after creation
    const { scope, ...rest } = body
    run(updatePin({ id: view.pinId, ...rest }))
  }

  const confirmDelete = async () => {
    const { type, feature } = confirm
    send({ type: 'confirm', confirm: null })
    const res = await dispatch(type === 'zone' ? deleteZone(feature.id) : deletePin(feature.id))
    if (res.error) send({ type: 'error', error: res.payload })
    else if (view.zoneId === feature.id || view.pinId === feature.id) send({ type: 'close' })
  }

  const toggleZoneAlerts = async (zone) => {
    const res = await dispatch(updateZone({ id: zone.id, active: !zone.properties.active }))
    if (res.error) send({ type: 'error', error: res.payload })
  }

  // ---------- lists ----------
  const q = filter.trim().toLowerCase()
  const matches = (f) => !q || f.properties.name.toLowerCase().includes(q)
  const hiddenSets = useMemo(() => ({ zone: new Set(hidden.zone), pin: new Set(hidden.pin) }), [hidden])
  const select = (type, f, zoom) => {
    dispatch(selectObject({ type, id: f.id }))
    zoom(f)
  }

  const rowFor = (type, f, extra) => ({
    key: f.id,
    hidden: hiddenSets[type].has(f.id),
    selected: selection?.type === type && selection.id === f.id,
    editable: canEdit(f, user),
    onToggleHidden: () => dispatch(setHidden({ type, ids: [f.id], hidden: !hiddenSets[type].has(f.id) })),
    onDelete: () => send({ type: 'confirm', confirm: { type, feature: f } }),
    ...extra,
  })
  const zoneRow = (z) => {
    const { type, facts } = describeObject(z)
    return rowFor('zone', z, {
      color: zoneColor(z),
      type,
      facts, // type + figures; the zone category (Monitoring, Port…) is in its details
      title: z.properties.name,
      badge: z.properties.preset ? 'preset' : null,
      live: z.properties.active,
      onSelect: () => select('zone', z, zoomToZone),
      onZoom: () => zoomToZone(z),
      onEdit: () => send({ type: 'show', view: { kind: 'zoneEdit', zoneId: z.id, redraw: null } }),
    })
  }
  const pinRow = (p) => {
    const { type, facts } = describeObject(p)
    return rowFor('pin', p, {
      color: p.properties.style?.color,
      type,
      facts: [...facts, PIN_ICON_LABELS[p.properties.style?.icon] || 'Pin'],
      tile: (
        <span className="gf-type-tile pin" aria-hidden="true">
          <PinGlyph style={p.properties.style} size={15} />
        </span>
      ),
      title: p.properties.name,
      badge: p.properties.scope === 'shared' ? 'shared' : null,
      onSelect: () => select('pin', p, zoomToPin),
      onZoom: () => zoomToPin(p),
      onEdit: () => send({ type: 'show', view: { kind: 'pinEdit', pinId: p.id } }),
    })
  }
  const lists = {
    pins: pins.filter(matches).map(pinRow),
    mine: zones.filter((z) => z.properties.scope === 'personal' && matches(z)).map(zoneRow),
    shared: zones.filter((z) => z.properties.scope === 'shared' && matches(z)).map(zoneRow),
  }
  const totals = {
    pins: pins.length,
    mine: zones.filter((z) => z.properties.scope === 'personal').length,
    shared: zones.filter((z) => z.properties.scope === 'shared').length,
  }
  // Hide/show the rows currently listed (the tab, narrowed by the type filter).
  const setAll = (type) => (hide, rows) => dispatch(setHidden({ type, ids: rows.map((r) => r.key), hidden: hide }))
  const tabs = [
    {
      id: 'pins',
      label: 'Pins',
      total: totals.pins,
      rows: lists.pins,
      onSetAllHidden: setAll('pin'),
      empty: { text: 'No pins yet. Drop one to mark a buoy, a wreck, a meeting point…', actionLabel: 'Drop a pin', onAction: () => toggleAction('pin') },
    },
    {
      id: 'mine',
      label: 'My zones',
      total: totals.mine,
      rows: lists.mine,
      onSetAllHidden: setAll('zone'),
      empty: { text: 'Draw an area to watch: get its size, the ships inside and alerts.', actionLabel: 'Draw a zone', onAction: () => toggleAction('zone') },
    },
    { id: 'shared', label: 'Shared', total: totals.shared, rows: lists.shared, onSetAllHidden: setAll('zone'), empty: { text: 'No shared zones.' } },
  ]
  // Until the user picks a tab: their pins if they have any, else their zones, else the shared ones.
  const activeTab = listTab ?? (totals.pins ? 'pins' : totals.mine ? 'mine' : 'shared')

  // ---------- active card ----------
  const editingZone = view.kind === 'zoneEdit' ? zones.find((z) => z.id === view.zoneId) : null
  const editingPin = view.kind === 'pinEdit' ? pins.find((p) => p.id === view.pinId) : null
  const selectedZone = selection?.type === 'zone' ? zones.find((z) => z.id === selection.id) : null
  const selectedPin = selection?.type === 'pin' ? pins.find((p) => p.id === selection.id) : null
  const discard = () => {
    tools.current.draw.clearResult()
    send({ type: 'close' })
  }

  let card = null
  if (activeTool) {
    card = (
      <div className="gf-follow" role="status">
        <span className="gf-pulse" />
        <span>Follow the steps at the top of the map.</span>
        <button type="button" className="gf-link" onClick={stopTools}>
          Cancel
        </button>
      </div>
    )
  } else if (view.kind === 'ruler') {
    card = <RulerResultCard readout={view.readout} onClear={discard} onAgain={() => startTool('ruler')} />
  } else if (view.kind === 'zoneDraft') {
    card = (
      <ZoneForm key="zone-new" isNew initial={newZoneForm()} canShare={canShare} measures={view.measures} saving={saving} error={error} onSave={saveZoneDraft} onCancel={discard} />
    )
  } else if (view.kind === 'zoneEdit' && editingZone) {
    card = (
      <ZoneForm
        key={editingZone.id}
        initial={zoneFormFrom(editingZone)}
        canShare={canShare}
        measures={view.redraw?.measures}
        saving={saving}
        error={error}
        onSave={saveZoneEdit}
        onRedraw={() => startTool('polygon', { keepView: true })}
        onCancel={discard}
      />
    )
  } else if (view.kind === 'pinDraft') {
    card = <PinForm key="pin-new" isNew initial={newPinForm()} latlng={view.latlng} canShare={canShare} saving={saving} error={error} onSave={savePinDraft} onCancel={discard} />
  } else if (view.kind === 'pinEdit' && editingPin) {
    card = (
      <PinForm
        key={editingPin.id}
        initial={pinFormFrom(editingPin)}
        latlng={pinLatLng(editingPin)}
        canShare={canShare}
        saving={saving}
        error={error}
        onSave={savePinEdit}
        onCancel={discard}
      />
    )
  } else if (selectedZone) {
    card = (
      <ZoneDetails
        zone={selectedZone}
        editable={canEdit(selectedZone, user)}
        onEdit={() => send({ type: 'show', view: { kind: 'zoneEdit', zoneId: selectedZone.id, redraw: null } })}
        onDelete={() => send({ type: 'confirm', confirm: { type: 'zone', feature: selectedZone } })}
        onZoom={() => zoomToZone(selectedZone)}
        onToggleAlerts={() => toggleZoneAlerts(selectedZone)}
        onClose={() => dispatch(selectObject(null))}
      />
    )
  } else if (selectedPin) {
    card = (
      <PinDetails
        pin={selectedPin}
        editable={canEdit(selectedPin, user)}
        onEdit={() => send({ type: 'show', view: { kind: 'pinEdit', pinId: selectedPin.id } })}
        onDelete={() => send({ type: 'confirm', confirm: { type: 'pin', feature: selectedPin } })}
        onZoom={() => zoomToPin(selectedPin)}
        onClose={() => dispatch(selectObject(null))}
      />
    )
  }
  const formOpen = ['zoneDraft', 'zoneEdit', 'pinDraft', 'pinEdit'].includes(view.kind)

  return (
    <div ref={panelRef} className={`layer-control-panel gf-panel ${theme}`} style={style} data-guide-panel="zones">
      <div className="panel-header">
        <span>Graphical objects</span>
        <button
          type="button"
          className="panel-close"
          onClick={() => {
            stopTools()
            onClose()
          }}
          aria-label="Close"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="gf-actions-grid" role="toolbar" aria-label="Create">
        {ACTIONS.map(({ id, label, caption, Icon }) => {
          const on = actionOfTool(tool)?.id === id
          return (
            <button key={id} type="button" className={`gf-action ${on ? 'on' : ''}`} data-guide={`objects.${id}`} onClick={() => toggleAction(id)} aria-pressed={on}>
              <span className="gf-action-icon">
                <Icon size={20} />
              </span>
              <strong>{label}</strong>
              <small>{caption}</small>
            </button>
          )
        })}
      </div>

      {card}
      {!formOpen && <ErrorNote>{error}</ErrorNote>}
      {pinsError && (
        <p className="gf-error" role="alert">
          {pinsError}{' '}
          <button type="button" className="gf-link" onClick={() => dispatch(clearPinsError())}>
            Dismiss
          </button>
        </p>
      )}

      {confirm && (
        <ConfirmBox
          message={
            <>
              Delete <b>{confirm.feature.properties.name}</b>?
              {confirm.feature.properties.scope === 'shared' && ' It is shared: everyone loses it.'}
            </>
          }
          onConfirm={confirmDelete}
          onCancel={() => send({ type: 'confirm', confirm: null })}
        />
      )}

      {zonesStatus === 'loading' && !zones.length ? (
        <p className="gf-empty">Loading…</p>
      ) : (
        <ObjectTabs
          tabs={tabs}
          active={activeTab}
          onChange={(id) => {
            setListTab(id)
            setTypeFilter(null)
          }}
          filter={filter}
          onFilter={setFilter}
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
        />
      )}
      <p className="gf-tip">
        <kbd>Right-click</kbd> the map for quick actions: drop a pin, measure from a point, copy coordinates.
      </p>

      <ToolGuideBar
        container={map.getContainer()}
        toolId={tool}
        readout={readout}
        onSwitchTool={switchTool}
        onUndo={() => tools.current.draw.undo()}
        onFinish={() => tools.current.draw.finish()}
        onCancel={stopTools}
      />
    </div>
  )
}

export default MapObjectsPanel
