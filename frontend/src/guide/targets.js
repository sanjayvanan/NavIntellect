/**
 * Controls the shadow-cursor guide can point at. Each is marked in the UI with
 * data-guide="<id>"; the list for the current layout (with what each control does) is sent to
 * Gemini, which may only answer with these ids. `on`: layouts it exists in (default both).
 */
const T = (id, label, hint, on) => ({ id, label, hint, on })

const ALL = [
  // Navigation
  T('nav.ai', 'AI copilot', 'Opens the AI chat: ask about ships, zones and alerts'),
  T('nav.ships', { desktop: 'Track info', phone: 'Ships' }, 'Opens the list of all ships, with search, an area (zone) filter and sort'),
  T('nav.alerts', { desktop: 'Notifications', phone: 'Alerts' }, 'Opens the list of alerts (ships entering, leaving, loitering or speeding in zones)'),
  T('nav.zones', { desktop: 'Graphical objects', phone: 'Zones' }, 'Opens pins, zones (with optional alerts) and the measuring tool'),
  T('nav.layers', 'Map layers', 'Opens the base map choice (OpenStreetMap, Satellite, Dark) and overlays', ['desktop']),
  T('nav.settings', 'Settings', 'Opens settings: ship density, grouping, icon size, names, live updates, dark mode', ['desktop']),
  T('nav.cluster', 'Group ships button', 'Turns grouping of nearby ships into count bubbles on or off', ['desktop']),
  T('nav.account', 'Account (your initials)', 'Opens your account, with Sign out', ['desktop']),
  T('nav.more', 'More', 'Opens: Map layers, Settings, Group ships, Account', ['phone']),
  T('more.layers', 'Map layers (in More)', 'Opens the base map choice and overlays', ['phone']),
  T('more.settings', 'Settings (in More)', 'Opens settings: density, grouping, icon size, names, live updates, dark mode', ['phone']),
  T('more.cluster', 'Group ships switch (in More)', 'Groups nearby ships into count bubbles', ['phone']),
  T('more.account', 'Account (in More)', 'Opens your account, with Sign out', ['phone']),
  // Map
  T('search', 'Search box', 'Type a ship name, MMSI, IMO or callsign, then pick a result to open the ship'),
  T('map', 'The map', 'Tap a ship arrow to open its details; drag to move, pinch or scroll to zoom'),
  T('locate', 'Show my location button', 'Moves the map to where you are'),
  // Ship details (after opening a ship)
  T('ship.track', 'Show track button (in ship details)', "Draws where the ship has been"),
  T('ship.trackPeriods', 'Track period: 6h / 24h / 3d (in ship details)', 'Changes how far back the track goes'),
  T('ship.briefing', 'AI briefing button (in ship details)', 'A short AI summary of the ship and anything unusual'),
  // Ships list
  T('ships.search', 'Search in the ships list', 'Filters the list by name or number'),
  T('ships.area', 'Area filter (ships list)', 'Shows only ships inside one of your zones'),
  T('ships.sort', 'Sort (ships list)', 'Latest, name or speed'),
  T('ships.list', 'The ships list', 'Tap a ship to open it on the map'),
  // Alerts
  T('alerts.list', 'The alerts list', 'Tap an alert to show its ship on the map'),
  T('alerts.explain', 'Why it matters (under an alert)', 'An AI explanation of the alert'),
  // Zones panel and drawing
  T('objects.pin', 'Drop pin (zones panel)', 'Then tap the map to place a pin'),
  T('objects.zone', 'Draw zone (zones panel)', 'Starts drawing a zone; choose polygon, rectangle or circle'),
  T('objects.measure', 'Measure (zones panel)', 'Measures distance and bearing on the map'),
  T('objects.tab.pins', 'Pins tab (zones panel)', 'Your pins'),
  T('objects.tab.mine', 'My zones tab (zones panel)', 'Zones you drew'),
  T('objects.tab.shared', 'Shared tab (zones panel)', 'Zones shared with everyone'),
  T('draw.polygon', 'Polygon shape (while drawing)', 'Tap corners on the map, then Finish'),
  T('draw.rectangle', 'Rectangle shape (while drawing)', 'Tap two opposite corners on the map'),
  T('draw.circle', 'Circle shape (while drawing)', 'Tap the centre, then the edge, on the map'),
  T('draw.finish', 'Finish (while drawing a polygon)', 'Closes the polygon'),
  T('zoneForm.name', 'Zone name field (after drawing)', 'Type a name for the zone'),
  T('zoneForm.alerts', 'Alerts for this zone switch (after drawing)', 'Turn on to get alerts when ships enter, leave, speed or loiter'),
  T('zoneForm.save', 'Save zone button (after drawing)', 'Saves the zone'),
  // Settings and layers
  T('settings.density', 'Ship density slider (settings)', 'How many ships are shown when zoomed out'),
  T('settings.cluster', 'Cluster ships switch (settings)', 'Group nearby ships into bubbles'),
  T('settings.size', 'Ship icon size (settings)', 'Small, medium or large arrows'),
  T('settings.names', 'Ship names switch (settings)', 'Labels next to ships when zoomed in'),
  T('settings.live', 'Live updates switch (settings)', 'Positions update in real time'),
  T('settings.dark', 'Dark mode switch (settings)', 'Dark colours'),
  T('layers.base', 'Base map choice (map layers)', 'OpenStreetMap, Satellite or Dark Map'),
  T('layers.overlays', 'Overlays (map layers)', 'Marine navigation marks on top of the map'),
  T('account.signout', 'Sign out button (account)', 'Signs you out'),
]

/** The controls that exist in a layout ('desktop' | 'phone'), as { id, label, hint }. */
export function guideTargets(layout) {
  return ALL.filter((t) => !t.on || t.on.includes(layout)).map((t) => ({
    id: t.id,
    label: typeof t.label === 'string' ? t.label : t.label[layout],
    hint: t.hint,
  }))
}

/** Questions answered by showing on screen rather than in words. */
export const isHowToQuestion = (text) =>
  /^\s*(how\s+(do|can|would|should)\s+(i|we|you)\b|how\s+to\b|show\s+me\b|where\s+(do|can|is)\b|guide\s+me\b|teach\s+me\b|walk\s+me\s+through\b|help\s+me\s+(to\s+)?(find|get|set|turn|draw|change|see|make|add|create|switch)\b)/i.test(
    text,
  )
