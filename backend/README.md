# Coastal Surveillance Backend

Live AIS ingestion from [aisstream.io](https://aisstream.io) into PostgreSQL + PostGIS (hosted on **Supabase**). It serves the existing map frontend, pushes live updates over WebSocket, keeps track history, runs geofence alerts and handles JWT auth.

```
aisstream.io ──ws──▶ ingestor ──(1s batches, 1 tx)──▶ Supabase Postgres + PostGIS
                        │                                      ▲
                        └── Redis pub/sub (ais:updates, alerts:new)
                                       │                       │
                                       ▼                       │
                                  API (Fastify) ── REST + /ws ─┘ ──▶ React frontend
```

The ingestor and the API are separate processes. Ingestion keeps running when the API restarts, and the API can run as several instances because Redis pub/sub fans out the updates.

## Quick start

1. **Supabase**: create a project → *Database → Extensions* → enable **postgis**.
   Then *Connect* → copy the **Session pooler** URI (not the transaction pooler on :6543).
2. **Redis** (local): `brew services start redis`
3. Backend:
   ```bash
   cd backend
   cp .env.example .env      # DATABASE_URL = Supabase session pooler URI, AISSTREAM_API_KEY, JWT_SECRET
   npm install
   npm run dev               # checks DB + Redis, applies migrations, runs API (:3000) + ingestor
   npm run seed:admin -- admin@example.com 'a-strong-password'   # once, in another terminal
   ```
4. Frontend: `cd ../frontend && npm run dev`. If the API is not on `localhost:3000`, set `VITE_API_BASE_URL` in `frontend/.env`.

`npm run dev` output is prefixed `[api]` / `[ingest]`; Ctrl+C stops both. Without an aisstream key the ingestor
idles and the API keeps serving. Run pieces separately with `npm run dev:api` / `npm run dev:ingestor`.

All tables live in the `ais` schema (`DB_SCHEMA`), which Supabase's auto-generated REST API does **not** expose,
so password hashes and data are only reachable through this backend. Tests use a separate `ais_test` schema.

No Supabase? `docker compose --profile local-db up -d db` gives a local PostGIS on :5433.

## Database design

| Table | Kind | Purpose |
|---|---|---|
| `vessels` | table, PK `mmsi` | Static identity: name, IMO, callsign, type, dimensions, destination, ETA. Holds a stable `uuid` for the UI. Trigram index on name for search. |
| `vessel_latest` | table, PK `mmsi` | Hot, one row per vessel. This is what the live map reads. GIST index on `geom`. The upsert only moves forward in time (`WHERE excluded.ts > cur.ts`). |
| `vessel_positions` | **partitioned** by day (native Postgres) | Full position history. PK `(mmsi, ts)` dedupes repeats. The ingestor pre-creates partitions 7 days ahead and drops whole partitions past 90 days (`POSITIONS_RETENTION_DAYS`), so retention is instant with no bloat. |
| `vessel_tracks_1m` | rollup table | 1-minute downsampled tracks for long ranges, refreshed every minute by the ingestor (re-covers the last 5 min for late data). Track queries add the not-yet-rolled-up tail from raw data. Kept 365 days, longer than raw data. |
| `zones` | table | Geofences as `geography(MultiPolygon)` with a GIST index, plus `rules` jsonb. |
| `zone_presence` | table | Which vessel is inside which zone. Drives the enter, exit, loiter and gap logic. |
| `alerts` | table | Typed alerts with severity, position and details. Has a partial index on open alerts and a cooldown dedupe. |
| `users`, `refresh_tokens` | tables | argon2id password hashes. Refresh tokens are opaque, rotating and stored hashed; replaying an old one revokes all of that user's sessions. |
| `audit_log` | table | Who created or changed zones and users, and who acknowledged alerts. |
| `job_state` | table | Watermarks for background jobs (the 1-minute rollup). |

### Ingestion
- **Normalizing:** `normalize.ts` turns aisstream envelopes into position and static messages.
  - It drops invalid positions (lat 91, lon 181, 0/0) and nulls AIS "not available" sentinels (SOG 102.3, COG 360, heading 511).
  - It strips the `@` padding from names and maps aisstream's `MessageType` to the ITU message id that the UI colours markers by.
- **Batching:** `Batcher` flushes every 1 s or every 2000 messages, with one flush in flight at a time.
  - A failed batch is put back in the queue, so a short DB outage loses nothing.
  - The buffer is capped at `MAX_BUFFER`; past that, the oldest messages are dropped and counted.
- **Writing:** each flush is one transaction. It upserts `vessels`, inserts into `vessel_positions` with `unnest` arrays, and upserts `vessel_latest`. After commit it publishes the changed vessels to Redis and runs zone evaluation.

### Alerts
Zone rules (`rules` jsonb):

```json
{ "alert_on_enter": true, "alert_on_exit": true, "alert_on_gap": true, "max_speed": 8, "loiter_minutes": 30 }
```

| Alert | Trigger | Severity |
|---|---|---|
| `zone_enter` / `zone_exit` | Crossing the zone boundary | `critical` when entering a `restricted` zone |
| `speeding` | SOG above `max_speed` inside the zone | warning |
| `loitering` | SOG below 0.5 kn for `loiter_minutes` | critical in restricted zones |
| `ais_gap` | A vessel inside a zone hasn't reported for `AIS_GAP_MINUTES` | critical in restricted zones |

Repeats of the same alert are suppressed for `ALERT_COOLDOWN_MINUTES`.

## API

Reads are open while `AUTH_REQUIRED_FOR_READS=false`, which is the default because the frontend has no login yet. Writes always need `Authorization: Bearer <access_token>`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/ships/trackList?hours=50[&bbox=minLon,minLat,maxLon,maxLat]` | **Legacy contract**: flat array in the frontend's shape |
| GET | `/api/vessels?q=&bbox=&limit=` | Search by name, MMSI, IMO or callsign |
| GET | `/api/vessels/:mmsi` | Static data, latest position, zones the vessel is currently in |
| GET | `/api/vessels/:mmsi/track?from=&to=&tolerance=&resolution=auto\|raw\|1m` | GeoJSON LineString with timestamps |
| GET/POST/PATCH/DELETE | `/api/zones[/:id]` | GeoJSON Polygon or MultiPolygon in, Feature or FeatureCollection out. Writes need operator |
| GET | `/api/zones/:id/vessels` | Vessels currently inside the zone |
| GET | `/api/alerts?status=open&type=&severity=&mmsi=&since=&before=&limit=` | Keyset pagination with `before` |
| GET | `/api/alerts/summary` | Open alerts counted by type and severity |
| POST | `/api/alerts/:id/ack` | Operator |
| POST | `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` | Login and refresh are rate-limited to 10/min |
| GET | `/api/auth/me` | |
| POST | `/api/auth/password` | |
| GET/POST/PATCH | `/api/users`, GET `/api/audit` | Admin |
| GET | `/api/health`, `/api/stats` | DB, Redis, ingest freshness, counts and storage size |

### WebSocket `/ws[?token=...]`

```
→ {"subscribe": {"bbox": [minLon, minLat, maxLon, maxLat] | null, "alerts": true}}
← {"type": "hello"}  {"type": "vessels", "data": [ ...trackList rows ]}  {"type": "alert", "data": {...}}
```

Vessel updates are coalesced per MMSI and sent at most once per second, filtered by each client's bbox.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Unit and integration tests, run against `DATABASE_URL` in an isolated `ais_test` schema that is recreated each run. Needs Redis. |
| `npm run capture -- 30` | Records 30 s of raw aisstream traffic to `test/fixtures/aisstream-sample.jsonl` and prints how each message type normalized. Run this once with your key to confirm the live wire format. |
| `npm run replay -- file.jsonl --shift` | Feeds a recording through the full pipeline. Useful for offline demos. |
| `npm run build` / `start:api` / `start:ingestor` | Production build and start. |
