# AIS basics

## What AIS is
The Automatic Identification System (AIS) is a radio system (VHF channels 161.975 and 162.025 MHz) on which ships broadcast who they are and where they are. Ships of 300 gross tonnage and more on international voyages, cargo ships of 500 GT and more, and all passenger ships must carry it under SOLAS. Many smaller boats carry it voluntarily. AIS was designed for collision avoidance, not for surveillance: the data is broadcast by the ship itself and nothing checks it.

## Class A and Class B transponders
Class A transponders are fitted on ships that must carry AIS. They report position every 2 to 10 seconds while under way (faster when the ship is fast or turning) and every 3 minutes at anchor or moored. Class B transponders are cheaper units used by leisure craft and small fishing boats; they report less often (about every 30 seconds when moving faster than 2 knots, every 3 minutes otherwise) and carry less static data.

## Position reports and static data
AIS sends two kinds of information. Dynamic data (position, speed over ground, course over ground, heading, rate of turn, navigational status) comes from the ship's GPS and sensors automatically. Static and voyage data (name, callsign, IMO number, ship type, dimensions, draught, destination, ETA) is typed in by the crew and sent about every 6 minutes. Static data is often wrong or out of date: destinations are free text, draught is rarely updated, and the ship type can be set to anything.

## Text field limits
The AIS name and destination fields hold at most 20 characters each, and the callsign 7, using a restricted character set (capital letters, digits and some punctuation). Because the crew types these fields, they can contain anything that fits, including misleading text.

## Reception range and coverage gaps
Terrestrial AIS stations receive ships out to roughly 20 to 40 nautical miles, depending on antenna height. Satellite AIS covers the open ocean but receives each ship less often and loses messages in busy areas where many ships transmit at once. A ship that seems to stop transmitting may simply have left coverage. Gaps far offshore or in very busy waters are usually technical; gaps close to shore stations, inside watched areas or just before arriving somewhere sensitive are more interesting.

## Speed and course
Speed over ground (SOG) is in knots (1 knot = 1 nautical mile per hour = 1.852 km/h). Course over ground (COG) is the direction the ship is actually moving; heading is where the bow points. They differ with current, wind and when the ship is turning or stopped. A heading of 511 means not available.
