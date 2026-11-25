/** ITU-R M.1371 ship & cargo type code -> human label. */
export function shipTypeLabel(code: number | null | undefined): string | null {
  if (code == null || code <= 0 || code > 99) return null;
  if (code >= 20 && code <= 29) return 'Wing in Ground';
  switch (code) {
    case 30: return 'Fishing';
    case 31: case 32: return 'Towing';
    case 33: return 'Dredging';
    case 34: return 'Diving Ops';
    case 35: return 'Military Ops';
    case 36: return 'Sailing';
    case 37: return 'Pleasure Craft';
    case 50: return 'Pilot Vessel';
    case 51: return 'Search and Rescue';
    case 52: return 'Tug';
    case 53: return 'Port Tender';
    case 54: return 'Anti-pollution';
    case 55: return 'Law Enforcement';
    case 58: return 'Medical Transport';
    case 59: return 'Noncombatant';
  }
  if (code >= 40 && code <= 49) return 'High Speed Craft';
  if (code >= 60 && code <= 69) return 'Passenger';
  if (code >= 70 && code <= 79) return 'Cargo';
  if (code >= 80 && code <= 89) return 'Tanker';
  if (code >= 90 && code <= 99) return 'Other';
  return null;
}
