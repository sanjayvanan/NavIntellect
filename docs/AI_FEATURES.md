# AI features: ideas and plan (Gemini)

The goal is for this project to showcase AI development with Gemini. The strongest showcase is
Gemini **working on live ship data through the app's own APIs** (function calling), not a chat
window bolted onto the side. Every idea below uses something the app already has:

- live AIS positions
- ship tracks
- zones (polygon, rectangle, circle)
- the alert engine
- notifications
- the ship list

---

## Status

| Feature | Status |
| --- | --- |
| Map copilot (sidebar ✦ "AI copilot") | **Built** |
| Ship briefing (✦ "AI briefing" in ship details) and alert explanation (✦ "Why it matters" under each alert) | **Built**: `backend/src/ai/explain.ts`, `frontend/src/components/AiExplain.jsx` |
| Shadow-cursor guide (ask the copilot "How do I…?") | **Built**: Gemini structured output limited to the controls on screen; `frontend/src/guide/targets.js` (control list, `data-guide` names), `ShadowGuide.jsx` |
| Observability: every AI request traced (`/api/ai/metrics`, `/api/ai/traces`) | **Built**: `backend/src/ai/trace.ts`, table `ai_requests` |
| Draw zones by talking, voice, anomaly detection ("AI watch"), stuck detection for the guide | Planned |

### Switching the copilot on

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Put it in `backend/.env` as `GEMINI_API_KEY=...`.
3. Check your free limits at [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit). If they are lower than the defaults, lower `AI_DAILY_LIMIT`, `AI_USER_DAILY_LIMIT` and `AI_RPM` to match.
4. Restart `npm run dev`.

Without a key the panel says the AI is not set up, and everything else works as before.

### How the copilot is built

| Part | File |
| --- | --- |
| Agent loop: tool rounds, last round must answer, cache, budget reservation | `backend/src/ai/copilot.ts` |
| Tools: declarations + executors that call the app's own API **as the signed-in user** | `backend/src/ai/tools.ts` |
| Free-tier budget in Redis: per day (Pacific), per user per day, per minute | `backend/src/ai/budget.ts` |
| Gemini client (`@google/genai`), error mapping (429, bad key, retired model, timeout) | `backend/src/ai/gemini.ts` |
| Routes `GET /api/ai/status`, `POST /api/ai/copilot` | `backend/src/api/routes/ai.ts` |
| Chat panel, map actions, ship links, usage meter | `frontend/src/components/CopilotPanel.jsx` |
| Conversation state | `frontend/src/store/copilotSlice.js` |

**Tools:**
- **Data:** `search_ships`, `list_zones`, `get_ship`, `get_track_summary`, `get_alerts`.
- **Map actions** (done by the browser): `show_ship`, `show_track`, `show_zone`, `fly_to`, `filter_ship_list`.

**Tests:** these use a scripted fake model, so they never call Gemini.
- `backend/test/integration.test.ts` ("AI copilot"): tool loop, visibility, cache, forced last round, budget.
- `backend/test/ai.test.ts`: track summary maths.
- `frontend/src/store/copilotSlice.test.js`: conversation state and ship links.

---

## AI engineering: how the copilot is measured

### Observability (`backend/src/ai/trace.ts`, table `ai_requests`)
A decorator wraps the model client, so neither the Gemini client nor the test fake changed. Every
request records:
- the feature, model and **prompt version** (a hash of the system prompt and the tool list);
- the tool round and the outcome (answer, tool calls, cache hit or error);
- latency and **time to first token** for streamed answers;
- prompt and output tokens, and the **cost at list price** (set `AI_PRICE_*`; the free tier is
  billed $0);
- each tool call with its arguments, whether it worked and how long it took.

The rows of one question share a `run_id` and are written in **one INSERT** when the run ends.
A trace write that fails is logged and never breaks an answer. Old rows are pruned after
`AI_TRACE_RETENTION_DAYS` (500 MB database).

Admins read the traces through two endpoints:
- `GET /api/ai/metrics?hours=24` gives, per feature, model and prompt version: runs, requests,
  cache hits, errors, p50/p95 latency, tokens and cost. It also gives the failure rate per tool.
- `GET /api/ai/traces` lists recent runs, each with every request and tool call.

---

## 1. Talk to the map (Gemini function calling)

### Map copilot
The user types or says what they want:

> "Show tankers going faster than 15 kn near Singapore."
> "Which ships entered Near britain today?"

Gemini answers by calling the existing endpoints as tools, then acts on the map: zoom, filter the
list, open a ship, show its track.

| Tool | Existing endpoint |
| --- | --- |
| Search / list ships | `GET /api/vessels/browse` (q, zone_id, sort, paging) |
| Ship details | `GET /api/vessels/:mmsi` |
| Ship track | `GET /api/vessels/:mmsi/track` |
| Ships inside a zone | `GET /api/zones/:id/vessels` |
| Alerts | `GET /api/alerts` |
| Zones | `GET /api/zones`, `POST /api/zones` |

Map actions that already exist on the frontend: `window.handleShipSelect`, `window.handleShipFocus`,
`showTrack`, and the zone filter in the Track info panel.

### Draw zones by talking
> "Watch a 5 nm circle around Mumbai port and alert me if anything goes faster than 8 kn."

Gemini turns this into a zone with its shape, size and alert rules (structured output). It is
**shown for approval before saving**.

### Voice control (Gemini Live API)
Talk to it hands-free, like an operator at a control desk.

---

## 2. Explain what's happening

- **Alert explanations:** a "Why this matters?" button on each notification (generated on click,
  then cached; see the free tier budget). Gemini looks at the
  alert, the ship's details, its recent track and the zone type. For example:
  *"A tanker slowed to 0.3 kn in a restricted zone at night, 2 km off its usual route."*
- **Ship briefing:** a button in the ship popup gives a short profile:
  - where the ship has been (from its track)
  - where it's heading
  - odd behaviour
  - how it compares with similar ships
- **Track story:** turns 3 days of positions into a short story with times. *"Left Singapore
  06:10, waited at anchor 4 h, crossed the strait at 14 kn…"*
- **Shift report:** a summary of the last 8 or 24 hours (busiest zones, unusual events, alert
  counts). Created on request or on a schedule.

---

## 3. Spot unusual behaviour

- **AIS signal gaps:** ships that go silent and reappear somewhere they couldn't have reached in
  that time, a possible sign of "dark" activity. The alert engine already detects lost signals
  (`ais_gap`).
- **Ship-to-ship meetings:** two ships slowing down side by side at sea, a pattern associated with
  smuggling and sanctions evasion.
- **Loitering and odd routes:** compare a ship's track with typical routes; Gemini scores and
  explains the risk.
- **Suspicious identity data:** names, flags or ship types that don't match how the ship moves.

**Design:** detection runs as plain SQL rules, which are fast and cheap. Gemini only **judges and
explains** the cases that get flagged. This keeps costs low and shows sound engineering judgement.

---

## 4. Guided help: the "shadow cursor"

A ghost cursor that shows the user how to do something, step by step, on the real screen.

**How it works**

1. Each button and field gets a stable id, e.g. `data-guide="objects.drawZone"`.
2. The user asks: *"How do I get alerts when ships enter an area?"*
3. Gemini receives the list of controls and the current screen state (which panel is open, what is
   selected, any errors).
4. Gemini returns the steps as structured output:
   ```json
   [
     { "target": "rail.objects", "say": "Open Graphical objects", "waitFor": "panel.objects.open" },
     { "target": "objects.drawZone", "say": "Choose Draw zone", "waitFor": "draw.started" },
     { "target": "zoneForm.alerts", "say": "Turn alerts on", "waitFor": "zone.saved" }
   ]
   ```
5. A ghost cursor glides to each control, highlights it, shows a short tip, and **waits until the
   user actually does that step** before moving on.

**Noticing when someone is stuck**

Watch for:
- repeated failed actions or errors
- a panel opened and closed several times
- a long idle period halfway through drawing a zone

When that happens, a small "Need help?" bubble offers to guide them.

**Screenshot help**

When the user asks *"what am I looking at?"*, send a screenshot of the current screen to Gemini (it
can read images).

---

## 5. Other ideas

- **Smart search:** search by meaning, e.g. *"fishing boats acting strangely"*. Uses Gemini
  embeddings; pgvector is available on the Supabase project but not enabled yet.
- **Questions about the news:** *"Is there a reason traffic in the Red Sea is low?"* Gemini answers
  with live Google Search results and links its sources.
- **Arrival prediction:** estimated arrival time from speed and track, with Gemini explaining the
  confidence.

---

## What to build first

All three fit the free tier for 1–5 users (see below).

1. **Map copilot.** Shows function calling, structured output and real actions on live data. Its
   tools are reused by everything else.
2. **AI alert explanations + shift report.** Little UI work, and very visible.
3. **Shadow-cursor guide.** Unusual and memorable in a demo; shows UI and agent design skill.

---

## Free tier budget (1–5 users)

The plan assumes the **free Gemini API tier** with **1–5 people** using the app. Free-tier limits
are counted per model as requests per minute and requests per day, and Google changes them. Check
the current numbers on the rate-limits page in Google AI Studio before tuning the values below.

For 5 people the daily limit is enough, **as long as AI runs only when someone asks for it, never
in the background for every ship or alert**. A busy zone can raise dozens of alerts a minute
(the Singapore Strait test produced 30 in 45 seconds), so one Gemini call per alert would use up
the free quota within minutes.

### Rules

| Rule | How |
| --- | --- |
| **AI on demand only** | Alert explanations, ship briefings, track stories and shift reports run when the user clicks a button, not when an alert arrives. |
| **Cache every answer** | Store answers in Redis (already in the stack) with a time limit, keyed by what was asked, e.g. `ai:alert:<id>`, `ai:brief:<mmsi>:<hour>`, `ai:guide:<question>`. A second click costs nothing. |
| **One gateway, one limiter** | All Gemini calls go through one backend module that enforces a per-minute rate, a daily budget and a per-user daily cap, e.g. 50 calls/user/day (configurable). |
| **Queue, don't fail** | When the per-minute limit is hit, queue the request and show "thinking…". When the daily budget is used up, say so clearly and keep the non-AI features working. |
| **Handle 429s** | Gemini returns 429 when over the limit. Wait the time it says (`Retry-After`) and retry once, then report "AI is busy, try again in a minute". |
| **Smallest model that works** | Use Flash-Lite or Flash for almost everything. Pro has much lower free limits, so keep it out of the default path. |
| **Small prompts** | Send summaries, not raw data. Simplify tracks first with the existing `tolerance` option on `/api/vessels/:mmsi/track` (a few dozen points instead of thousands). Send counts and top-N lists, not full ship lists. |
| **Few tool round trips** | Copilot: allow at most ~3 tool calls per question, and return tool results in compact form. |
| **Usage meter** | Show the AI calls used today in the UI (e.g. "AI: 37 / 250 today"). It keeps users informed and looks good in a demo. |

### How each idea fits the free tier

| Idea | Fit | Notes |
| --- | --- | --- |
| Map copilot | ✅ Good | One question = 1–3 calls. Cap the tool rounds. |
| Draw zones by talking | ✅ Good | 1 call, structured output. |
| Alert explanations | ✅ If on click | Never automatic. Cache by alert id. |
| Ship briefing / track story | ✅ If on click | Simplified track; cache by ship + hour. |
| Shift report | ✅ Good | One call on request; cache until the next shift. |
| Anomaly detection | ✅ SQL first | SQL rules flag cases; Gemini explains only what the user opens, or a small batch of the top few once an hour. |
| Shadow-cursor guide | ✅ Mostly free | Write the guides for common tasks by hand (stored as JSON, no AI call). Ask Gemini only for questions those guides don't cover, and cache its answer. |
| Screenshot help | ⚠️ Occasional | Images cost more tokens. On request only. |
| Voice (Live API) | ⚠️ Check | Free-tier availability and limits differ; treat it as an optional extra. |
| Smart search (embeddings) | ⚠️ Batch once | Embed ship names/types in batches once, then embed only new ships. Search queries are 1 call each. |
| Google Search grounding | ⚠️ Limited | Has its own quota; on request only. |

### Privacy note

On the free tier, Google may use prompts and answers to improve its products. Don't send passwords,
user emails or anything private to Gemini. Ship data from public AIS is fine. A paid key can be
switched in later without code changes.

---

## How to set it up safely

- **Call Gemini from the backend, not the browser**, so the API key stays secret and usage can be
  rate-limited.
- **Tools = the existing validated (zod) endpoints.** Never let the model write raw SQL.
- **Models:** Flash-Lite / Flash for everything by default (free tier); a stronger model only if a
  paid key is added later.
- **Cache AI results in Redis with a time limit**, not in Postgres. The Supabase free tier is 500 MB,
  so don't store every model reply.
- **Approval before changes:** the user confirms anything the AI creates or edits (zones, alerts).
