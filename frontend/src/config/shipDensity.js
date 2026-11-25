/**
 * "Ship density" levels for the map's level of detail. `density` = grid cells per 256 px map tile
 * side: when zoomed out the server keeps one representative ship per cell (bigger number = more
 * ships, smaller cells). `null` = no thinning: every ship in view (newest MAP_SHIP_LIMIT).
 * From FULL_DETAIL_ZOOM on, every level shows all ships.
 */
export const DENSITY_LEVELS = [
  { label: 'Minimal', density: 8, hint: 'One ship per ~32 px' },
  { label: 'Light', density: 16, hint: 'One ship per ~16 px' },
  { label: 'Balanced', density: 32, hint: 'One ship per ~8 px' },
  { label: 'Dense', density: 64, hint: 'One ship per ~4 px' },
  { label: 'All ships', density: null, hint: 'Every ship in view, no thinning' },
]

export const DEFAULT_DENSITY_LEVEL = 2 // Balanced
