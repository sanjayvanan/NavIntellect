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
| `vessel_positions` | raw, **hourly** partitions | One row per message (~150 B). It is the hot tail only: hours are packed into `vessel_tracks` 10 minutes after they close, and their partitions are dropped after `RAW_RETENTION_HOURS`. Partitions are never dropped before they are packed. |
| `vessel_tracks` | packed, **daily** partitions | One row per vessel per 6-hour block. Points are packed into `bytea` at 16 B each: time, lat/lon at 1e-6°, sog, cog, heading. That is about 20 B per point with overhead, roughly 7× smaller than raw rows. Block bounding boxes have a GIST index for area queries. Decode with `track_points(pts, block_start)`. Kept `TRACKS_RETENTION_DAYS`. |
| `zones` | table | Geofences as `geography(MultiPolygon)` with a GIST index, plus `rules` jsonb. |
| `zone_presence` | table | Which vessel is inside which zone. Drives the enter, exit, loiter and gap logic. |
| `alerts` | table | Typed alerts with severity, position and details. Has a partial index on open alerts and a cooldown dedupe. |
| `users`, `refresh_tokens` | tables | argon2id password hashes. Refresh tokens are opaque, rotating and stored hashed; replaying an old one revokes all of that user's sessions. |
| `audit_log` | table | Who created or changed zones and users, and who acknowledged alerts. |
| `job_state` | table | Watermarks for background jobs. `tracks` marks where packed history ends and the raw tail begins. |

### Storage budget (Supabase free tier, 500 MB)
Measured worldwide on aisstream: about 55 positions/s, which is about 4.75 M per day from about 25 k ships an hour.

| Data | Cost | In 500 MB |
|---|---|---|
| Ships, which feed the map and search (`vessels` + `vessel_latest`) | ~630 B per ship | 100 k ships ≈ 65 MB |
| Raw tail (`vessel_positions`) | ~150 B per point | 3 h ≈ 60–90 MB |
| Packed history (`vessel_tracks`) | ~20 B per point | **~3 days worldwide** |

History is also thinned to at most one point per ship every `POSITIONS_SAMPLE_SECONDS` (default 120 s). The live map always gets every message.

A **storage guard** runs every 10 minutes. Above 85 % of `DB_SIZE_LIMIT_MB` it drops the oldest past day of tracks, because Supabase turns an over-limit database read-only. On a paid plan, raise `DB_SIZE_LIMIT_MB` and `TRACKS_RETENTION_DAYS`. `GET /api/stats` shows the current use.

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

## Keeping the free plan running

- **Storage (500 MB):** the ingestor's maintenance, at start and every 10 minutes, drops raw positions after packing them (`RAW_RETENTION_HOURS`), packed tracks after `TRACKS_RETENTION_DAYS`, ships off the map after `LATEST_RETENTION_DAYS`, and ship details not heard for `VESSELS_RETENTION_DAYS`. It also rebuilds the `vessel_latest` indexes when updates have bloated them. Above 85 % of `DB_SIZE_LIMIT_MB` it drops the oldest day of tracks.
- **Egress (about 5 GB a month):** the API keeps the live ship list in memory, fed by Redis. It reloads it from the database only at start, after a Redis reconnect, and once a day.
- **Pausing after a week without activity:** the API and the ingestor write a heartbeat (`job_state` `heartbeat:api` / `heartbeat:ingestor`) at start and then daily. Migration `012_keepalive_cron.sql` also schedules a pg_cron job inside the database (`keepalive_ais`, daily at 03:17 UTC, `heartbeat:pg_cron`), so the project stays active even when no server runs. To check: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;`, or open Integrations → Cron in the Supabase dashboard.

## API

The web app requires signing in, but the map's read endpoints stay open while `AUTH_REQUIRED_FOR_READS=false` (the default). Writes always need `Authorization: Bearer <access_token>`. Anyone can create an account from the sign-in page while `ALLOW_REGISTRATION=true` (the default). New accounts are always `viewer`; an admin raises roles through `/api/users`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/ships/trackList?hours=50[&bbox=minLon,minLat,maxLon,maxLat][&limit=]` | **Legacy contract**: flat array in the frontend's shape. The map sends its viewport bbox, `limit=5000`, `zoom` and `density`. Below zoom 10 it gets one representative ship per grid cell, with `density` as cells per 256 px tile (default 16). Requests with `zoom` are served from an in-memory copy of the live map in about 5–20 ms instead of going to the DB. A bbox with minLon > maxLon crosses the antimeridian |
| GET | `/api/vessels?q=&bbox=&limit=` | Searches every known vessel by name, MMSI, IMO or callsign. Exact matches rank first, then name prefix, then fuzzy name, then recency. Rows use the map shape |
| GET | `/api/vessels/:mmsi` | Static data, latest position, zones the vessel is currently in |
| GET | `/api/vessels/:mmsi/track?from=&to=&tolerance=` | GeoJSON LineString with timestamps, combining packed history and the raw tail. `tolerance` (degrees, e.g. `0.0004` ≈ 44 m) simplifies it with Douglas–Peucker, measured in metres on the ground (`src/shared/simplify.ts`): kept points keep their times, and `properties.breaks` lists where reception gaps (over 10 min) start. `properties.points` is always the number of positions before simplifying. |
| GET | `/api/tracks/area?bbox=&from=&to=&limit=` | Vessels that were inside an area during a time window |
| GET/POST/PATCH/DELETE | `/api/zones[/:id]` | Geofences. GeoJSON Polygon or MultiPolygon in, Feature or FeatureCollection out. Body `scope`: `personal` (default, any signed-in user) or `shared` (operators). `active` turns alerts on (default off). Properties include `scope`, `color`, `description`, `preset`, `area_nm2`, `perimeter_nm`. Max 200 personal zones per user |
| GET | `/api/zones/:id/vessels?limit=&hours=` | `{total, vessels}`: vessels inside the zone now, from their latest positions (works with alerts off) |
| GET/POST/PATCH/DELETE | `/api/annotations[/:id]?kind=&bbox=&scope=` | Map annotations, currently `kind: "pin"` (GeoJSON Point, `style: {color, icon}` with icon one of pin, anchor, flag, warning, camera, star). Same scopes as zones. PATCH can move a pin (`geometry`). Max 1,000 personal annotations per user. New kinds are added in `src/api/annotations/kinds.ts` |
| GET | `/api/alerts?status=open&type=&severity=&mmsi=&since=&before=&limit=` | Keyset pagination with `before` |
| GET | `/api/alerts/summary` | Open alerts counted by type and severity |
| POST | `/api/alerts/:id/ack` | Operator |
| POST | `/api/auth/register` | `{email, password (≥10 chars), name?}` → same response as login, role `viewer`. 409 if the email is taken |
| POST | `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` | Register, login and refresh are rate-limited to 10/min |
| GET | `/api/auth/me` | id, email, role, name |
| GET/PUT/DELETE | `/api/me/preferences` | The signed-in user's settings: `{settings: {mode, view: {lat, lng, zoom}, baseLayer, overlays, …}}`. PUT replaces the document; max 128 KB; unknown keys are kept |
| POST | `/api/auth/password` | |
| GET/POST/PATCH | `/api/users`, GET `/api/audit` | Admin |
| GET | `/api/health`, `/api/stats` | DB, Redis, ingest freshness, counts and storage size |

### Ownership scopes (zones, annotations)

User-made map objects are either **shared** (`owner_id` NULL: visible to everyone, changed by operators and admins; the preset waterways are shared) or **personal** (visible to and changed by their owner only). Another user's personal object answers 404, never 403. Alerts from personal zones are only returned to their owner and are not broadcast over the WebSocket. The rules live in `src/api/auth/scope.ts`.

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

## Extending with AI
The schema is built so an AI assistant can be added without restructuring:

- **Text-to-SQL or agent tools:** every table lives in the `ais` schema with typed columns and indexes. A future assistant can get a read-only role on that schema (`GRANT USAGE ON SCHEMA ais`, `GRANT SELECT ON ALL TABLES IN SCHEMA ais`). `track_points()` makes packed history queryable as plain rows.
- **Tool calling:** the REST endpoints are small, validated JSON functions: search, profile, track, area-in-time-window, alerts and zones. An OpenAPI spec can be generated with `@fastify/swagger` and handed to a model as tools.
- **Semantic search or memory:** the `vector` (pgvector) extension is available on Supabase. Enable it in `extensions` and add embedding columns or tables, for example vessel profiles or alert narratives, in a new migration.
- **Events to reason over:** `alerts`, `zone_presence` and `audit_log` record what happened, to whom and when.
