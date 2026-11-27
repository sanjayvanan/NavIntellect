# How this app works

## Data and history kept
The map shows ships heard from AIS (aisstream.io) in the last 50 hours. Positions are kept as tracks for about 3 days (a storage limit of the free database), sampled to about one point every 2 minutes per ship plus a point whenever a moving ship turns sharply. Ship details (name, type, size, destination) are kept for 30 days after a ship was last heard. Older history is not available.

## Zones
A zone is an area drawn on the map: a polygon, a rectangle or a circle. Each zone has a kind: restricted, monitoring, port or anchorage. Personal zones are visible only to the user who drew them; preset zones are shared with everyone. A zone can have alerts switched on or off, and rules such as a speed limit (max speed in knots) and a loitering time (minutes).

## Alert types and severity
Alerts come from zones that have alerts on. zone_enter: a ship crossed into the zone. zone_exit: a ship left it. speeding: a ship inside the zone went faster than the zone's speed limit. loitering: a ship stayed slower than 0.5 knots inside the zone for longer than the zone's loitering time. ais_gap: a ship inside the zone stopped transmitting for longer than the gap limit (30 minutes by default). In restricted zones, entering, loitering and AIS gaps are critical; elsewhere loitering and AIS gaps are warnings and entering is information. Leaving a zone is always information and speeding is always a warning. The same alert for the same ship and zone is not repeated within a cooldown (15 minutes by default).

## AI features
The AI copilot answers questions about the live ships, zones and alerts by calling the app's own API as the signed-in user, so it sees exactly what the user can see. It can also move the map, open a ship, draw a track, zoom to a zone and open the ship list. The ship briefing and "Why it matters" buttons explain one ship or one alert. All AI features share a daily request budget on Gemini's free tier.
