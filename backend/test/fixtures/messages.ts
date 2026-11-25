/** aisstream.io-shaped envelopes for tests (field names per aisstream's published message models). */
export function positionReport(o: {
  mmsi: number; lat: number; lon: number; sog?: number; cog?: number; heading?: number;
  time?: Date; msgId?: number; name?: string;
}) {
  const t = o.time ?? new Date();
  return {
    MessageType: 'PositionReport',
    MetaData: {
      MMSI: o.mmsi,
      ShipName: (o.name ?? '').padEnd(20, ' '),
      latitude: o.lat,
      longitude: o.lon,
      time_utc: goTime(t),
    },
    Message: {
      PositionReport: {
        MessageID: o.msgId ?? 1, RepeatIndicator: 0, UserID: o.mmsi, Valid: true,
        NavigationalStatus: 0, RateOfTurn: 0, Sog: o.sog ?? 10, PositionAccuracy: true,
        Latitude: o.lat, Longitude: o.lon, Cog: o.cog ?? 90, TrueHeading: o.heading ?? 91,
        Timestamp: t.getUTCSeconds(), SpecialManoeuvreIndicator: 0, Raim: false,
      },
    },
  };
}

export function classBReport(o: { mmsi: number; lat: number; lon: number; sog?: number; time?: Date }) {
  const t = o.time ?? new Date();
  return {
    MessageType: 'StandardClassBPositionReport',
    MetaData: { MMSI: o.mmsi, ShipName: '', latitude: o.lat, longitude: o.lon, time_utc: goTime(t) },
    Message: {
      StandardClassBPositionReport: {
        MessageID: 18, UserID: o.mmsi, Valid: true, Sog: o.sog ?? 5, Latitude: o.lat, Longitude: o.lon,
        Cog: 360, TrueHeading: 511, Timestamp: 0,
      },
    },
  };
}

export function shipStaticData(o: { mmsi: number; name: string; type?: number; time?: Date }) {
  const t = o.time ?? new Date();
  return {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: o.mmsi, ShipName: o.name, time_utc: goTime(t) },
    Message: {
      ShipStaticData: {
        MessageID: 5, UserID: o.mmsi, Valid: true, AisVersion: 0, ImoNumber: 9321483,
        CallSign: 'VTAB@@@', Name: `${o.name}@@@@`, Type: o.type ?? 70,
        Dimension: { A: 150, B: 30, C: 15, D: 15 }, FixType: 1,
        Eta: { Month: 12, Day: 1, Hour: 14, Minute: 30 }, MaximumStaticDraught: 9.5,
        Destination: 'MUMBAI@@@@', Dte: false,
      },
    },
  };
}

/** Go's time.Time.String() format, which aisstream uses for MetaData.time_utc. */
export function goTime(d: Date): string {
  const iso = d.toISOString(); // 2024-01-15T10:22:33.123Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}000000 +0000 UTC`;
}
