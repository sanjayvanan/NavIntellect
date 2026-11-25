import { apiFetch } from '../../services/api'

// REST client for map objects. Every call is authenticated (apiFetch refreshes tokens).
// Responses are GeoJSON Features / FeatureCollections.

export const zonesApi = {
  list: async () => (await apiFetch('/api/zones')).features,
  create: (body) => apiFetch('/api/zones', { method: 'POST', body }),
  update: (id, body) => apiFetch(`/api/zones/${id}`, { method: 'PATCH', body }),
  remove: (id) => apiFetch(`/api/zones/${id}`, { method: 'DELETE' }),
  /** Vessels inside a zone right now: { total, vessels } */
  vessels: (id, limit = 8) => apiFetch(`/api/zones/${id}/vessels?limit=${limit}`),
}

export const annotationsApi = {
  list: async (kind) => (await apiFetch(`/api/annotations${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`)).features,
  create: (body) => apiFetch('/api/annotations', { method: 'POST', body }),
  update: (id, body) => apiFetch(`/api/annotations/${id}`, { method: 'PATCH', body }),
  remove: (id) => apiFetch(`/api/annotations/${id}`, { method: 'DELETE' }),
}
