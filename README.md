# Coastal Surveillance System

```
frontend/   React + Vite + Leaflet map            → cd frontend && npm install && npm run dev   (http://localhost:5173)
backend/    Fastify API + AIS ingestor + Postgres → cd backend  && npm install && npm run dev   (http://localhost:3000)
```

The database is Supabase (Postgres + PostGIS); Redis runs locally (`brew services start redis`).
The backend's `npm run dev` checks both, applies migrations, then runs the API and the live AIS ingestor together.
See [backend/README.md](backend/README.md) for setup (`.env`, aisstream API key) and the API reference.
