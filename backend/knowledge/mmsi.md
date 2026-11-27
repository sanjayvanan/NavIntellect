# MMSI numbers

## MMSI structure
The MMSI (Maritime Mobile Service Identity) is the nine-digit number every AIS station sends. For ships, the first three digits are the MID (Maritime Identification Digits), which give the country the ship is registered in (its flag). The MMSI belongs to the radio installation and changes when the ship changes flag, so it is a weaker identifier than the IMO number.

## MID ranges by region
The first digit of a ship's MID gives the region: 2 = Europe, 3 = North and Central America and the Caribbean, 4 = Asia (west and central), 5 = Oceania and South-East Asia, 6 = Africa, 7 = South America.

## Common flag MIDs
Some frequent MIDs: 226, 227 and 228 = France. 232, 233, 234 and 235 = United Kingdom. 211 and 218 = Germany. 244, 245 and 246 = Netherlands. 338 and 366 to 369 = United States. 351 to 357 and 370 to 373 = Panama. 412, 413 and 414 = China. 419 = India. 431 and 432 = Japan. 477 = Hong Kong. 538 = Marshall Islands. 563, 564, 565 and 566 = Singapore. 636 and 637 = Liberia. 657 = Nigeria. Panama, Liberia and the Marshall Islands are open registries ("flags of convenience"), so a ship's flag often says little about where it trades or who owns it.

## Special MMSI patterns
An MMSI starting with 00 is a coast station; 0 followed by a MID is a group of ships. 111 starts search-and-rescue aircraft. 970 is an AIS-SART (search and rescue transmitter), 972 a man-overboard device and 974 an EPIRB with AIS. 98 starts craft associated with a parent ship (such as a lifeboat) and 99 an aid to navigation (a buoy or a virtual mark).

## Suspicious MMSIs
Signs that an MMSI may be invalid or spoofed: fewer than nine digits, a MID that is not assigned to any country, defaults such as 123456789 or 000000000, the same MMSI reported from two places too far apart to travel between in the time, or an MMSI whose flag does not match the callsign's country.
