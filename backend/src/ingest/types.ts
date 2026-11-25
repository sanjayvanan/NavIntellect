export interface PositionMsg {
  kind: 'position';
  mmsi: number;
  ts: Date;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  rot: number | null;
  navStatus: number | null;
  msgType: number;
  /** Name from MetaData.ShipName; fills vessels.name until real static data arrives. */
  nameHint: string | null;
}

export interface StaticMsg {
  kind: 'static';
  mmsi: number;
  ts: Date;
  msgType: number;
  name?: string | null;
  callsign?: string | null;
  imo?: number | null;
  shipType?: number | null;
  shipTypeLabel?: string | null;
  dimA?: number | null;
  dimB?: number | null;
  dimC?: number | null;
  dimD?: number | null;
  draught?: number | null;
  destination?: string | null;
  eta?: Date | null;
}

export type AisMsg = PositionMsg | StaticMsg;

/** Shape served by the legacy `/api/ships/trackList` endpoint and pushed over the WebSocket. */
export interface LegacyShip {
  uuid: string;
  mmsi: number;
  track_name: string;
  type: string;
  latitude: number;
  longitude: number;
  speed_over_ground: number;
  course_over_ground: number;
  true_heading: number;
  sensor_timestamp: number;
  message_type__id: number;
}
