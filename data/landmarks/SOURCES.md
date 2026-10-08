# Landmark sources

Coordinates are Wikidata "coordinate location" (P625) values, which Wikidata publishes under
CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>). Retrieved 2026-10-06. Values
are rounded to 5 decimal places (about 1 m). Approach points marked "approximate" were picked
by hand on public land and checked against the S04 borough and zone layers by
`src/lib/world/places-content.test.ts`.

Every landmark has `legalReviewed: false` until a human checks its name and depiction.

## nameMode rule

A landmark uses a `generic` label when its real name contains a corporate or sponsor brand,
or when its owner actively licenses or claims the name or image as commercial IP. Civic,
park and place names owned by the public stay `real`. Generic ids are brand-free.

## Landmarks

| id                       | Wikidata                                            | location                                    | approach                                             | nameMode                              | reasoning                                                                                                                                                   |
| ------------------------ | --------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brooklyn-bridge`        | Q125006                                             | 40.70567, -73.99633 (midspan, water)        | Brooklyn Bridge Park Q929440, 40.69778, -73.99833    | real                                  | City-owned bridge; public place name.                                                                                                                       |
| `manhattan-bridge`       | Q125050                                             | 40.70722, -73.99083 (midspan, water)        | Canal St / Bowery, 40.71640, -73.99510 (approximate) | real                                  | City-owned bridge.                                                                                                                                          |
| `queensboro-bridge`      | Q125157                                             | 40.75694, -73.95472 (over Roosevelt Island) | Queensbridge Park Q49547265, 40.75639, -73.94889     | real ("Queensboro Bridge")            | City-owned bridge; the common name, not the official dedication.                                                                                            |
| `wedge-building`         | Q220728                                             | 40.74111, -73.98972                         |                                                      | generic ("Fifth Ave wedge")           | The owner asserts image rights in the building; a USPTO 3D-configuration application (98342455) covers its shape.                                           |
| `deco-spire`             | Q11274                                              | 40.75143, -73.97572                         |                                                      | generic ("Lexington Deco spire")      | The building's name is a car-maker brand.                                                                                                                   |
| `statue-of-liberty`      | Q9202                                               | 40.68921, -74.04443 (Liberty Island)        | The Battery Q13689, 40.70361, -74.01611              | real                                  | National monument; viewed from Battery Park.                                                                                                                |
| `washington-square-arch` | Q2550491                                            | 40.73124, -73.99710                         |                                                      | real                                  | City park monument.                                                                                                                                         |
| `central-park`           | Q160409                                             | 40.78250, -73.96611                         |                                                      | real                                  | City park.                                                                                                                                                  |
| `high-line`              | Q843869                                             | 40.74830, -74.00500                         |                                                      | real (review flag)                    | City park name. Kept real by the S07 plan decision and flagged for legal review, as the park's non-profit operator also uses the name for its own programs. |
| `prospect-park`          | Q1049632                                            | 40.66143, -73.97035                         |                                                      | real                                  | City park.                                                                                                                                                  |
| `flushing-meadows`       | Q745296 (park), Q717956 (Unisphere, the point used) | 40.74639, -73.84500                         |                                                      | real ("Flushing Meadows Corona Park") | City park. The info copy names the Unisphere: flagged for legal review.                                                                                     |
| `astoria-park`           | Q4811114                                            | 40.77944, -73.92194                         |                                                      | real                                  | City park.                                                                                                                                                  |
| `queens-ballpark`        | Q1072882                                            | 40.75699, -73.84578                         |                                                      | generic ("Queens ballpark")           | Sponsored stadium name; team names are trademarks.                                                                                                          |
| `brooklyn-arena`         | Q807966                                             | 40.68265, -73.97469                         |                                                      | generic ("Brooklyn arena")            | Sponsored arena name.                                                                                                                                       |
| `city-hall`              | Q1065206                                            | 40.71278, -74.00611                         |                                                      | real ("City Hall")                    | Government building.                                                                                                                                        |
| `brooklyn-borough-hall`  | Q929403                                             | 40.69278, -73.99028                         |                                                      | real                                  | Government building.                                                                                                                                        |
| `queens-borough-hall`    | Q2122585                                            | 40.71361, -73.82806                         |                                                      | real                                  | Government building.                                                                                                                                        |
| `midtown-terminal`       | Q11290                                              | 40.75278, -73.97722                         |                                                      | generic ("42nd St terminal")          | The operator's licensing program claims the terminal's name and image.                                                                                      |
| `penn-station`           | Q54451                                              | 40.75064, -73.99390                         |                                                      | real (review flag)                    | Common place name of a public rail station. Kept real by the S07 plan decision and flagged for legal review.                                                |
| `jamaica-station`        | Q11310077                                           | 40.69972, -73.80778                         |                                                      | real                                  | Place name.                                                                                                                                                 |
| `times-square`           | Q11259                                              | 40.75750, -73.98583                         |                                                      | real                                  | Public place name.                                                                                                                                          |
| `dumbo`                  | Q1264951                                            | 40.70306, -73.98944                         |                                                      | real ("DUMBO")                        | Neighborhood name.                                                                                                                                          |
| `coney-island-boardwalk` | Q4380603                                            | 40.57330, -73.97880                         |                                                      | real                                  | City boardwalk. Copy never names rides or amusement brands.                                                                                                 |
| `flushing-main-street`   | Q6736067                                            | 40.76060, -73.83060                         |                                                      | real                                  | Street and neighborhood name.                                                                                                                               |
| `september-11-memorial`  | Q1136137                                            | 40.71139, -74.01361                         |                                                      | real ("9/11 Memorial")                | Memorial: look-only, plain factual copy in base only, never overridden by a slang pack.                                                                     |
| `bronx-ballpark`         | Q753529                                             | 40.82957, -73.92639                         |                                                      | generic ("Bronx ballpark")            | Team and stadium names are trademarks. Teaser on expanding-soon land.                                                                                       |
| `staten-island-ferry`    | Q5927015 (St. George terminal point)                | 40.64330, -74.07420                         |                                                      | real                                  | City service. Teaser on expanding-soon land.                                                                                                                |

## Model heights

Code-built low-poly models (S07a, `data/landmarks/models.json`). Model tops come from Wikidata
"height" (P2048, CC0 1.0), retrieved 2026-10-07, where Wikidata has one; every other height is
stylised and approximate. A bridge's height is its tower top above the water. Placement and
heading come from NYC DCP LION street centerlines (see `data/geo/SOURCES.md`, "LION street
centerlines") and are written to `landmarks/frames.derived.json` by `npm run geo:build`.

LEGAL-1: `wedge-building` and `midtown-terminal` are plain massing (no ornament, no sculpture
group, no clock); `deco-spire` ends in a generic tapered spire, not a copy of the real crown;
`penn-station` is generic entrance pavilions and a canopy only. No model carries text, signage,
logos or clock faces.

| id                      | archetype        | depiction | top     | height source                              | orientation                               |
| ----------------------- | ---------------- | --------- | ------- | ------------------------------------------ | ----------------------------------------- |
| `brooklyn-bridge`       | suspensionBridge | stylised  | 84 m    | Wikidata Q125006 P2048 = 84 m (CC0)        | LION `BROOKLYN BRIDGE` → 136°             |
| `manhattan-bridge`      | suspensionBridge | stylised  | 102 m   | Wikidata Q125050 P2048 = 102 m (CC0)       | LION `MANHATTAN BRIDGE` → 157°            |
| `queensboro-bridge`     | cantileverBridge | stylised  | 105 m   | Wikidata Q125157 P2048 = 105 m (CC0)       | LION `ED KOCH QUEENSBORO BRIDGE` → 119.7° |
| `wedge-building`        | wedgeTower       | massing   | 94 m    | Wikidata Q220728 P2048 = 94 m (CC0)        | LION `5 AVENUE` → 29.4°                   |
| `deco-spire`            | setbackSpire     | stylised  | 318.9 m | Wikidata Q11274 P2048 = 318.9 m (CC0)      | LION `LEXINGTON AVENUE` → 298.9°          |
| `midtown-terminal`      | terminalHall     | massing   | 36 m    | approximate (stylised; no Wikidata height) | LION `VANDERBILT AVENUE` → 207.7°         |
| `penn-station`          | stationConcourse | stylised  | 13 m    | approximate (stylised; no Wikidata height) | LION `8 AVENUE` → 299°                    |
| `jamaica-station`       | stationConcourse | stylised  | 22 m    | approximate (stylised; no Wikidata height) | LION `SUTPHIN BOULEVARD` → 69.9°          |
| `staten-island-ferry`   | stationConcourse | stylised  | 20 m    | approximate (stylised; no Wikidata height) | LION `FERRY TERMINAL VIADUCT` → 58.8°     |
| `city-hall`             | civicHall        | stylised  | 34 m    | approximate (stylised; no Wikidata height) | LION `CITY HALL PARK GREENWAY` → 205.6°   |
| `brooklyn-borough-hall` | civicHall        | stylised  | 33 m    | approximate (stylised; no Wikidata height) | LION `JORALEMON STREET` → 12.7°           |
| `queens-borough-hall`   | civicHall        | stylised  | 20 m    | approximate (stylised; no Wikidata height) | LION `QUEENS BOULEVARD` → 208.8°          |

<!-- measurements:start (generated by npm run landmarks:blender; do not edit by hand) -->

## Measurements (S07c)

Blender-built models (`scripts/blender/`, DEC-25) take their dimensions from
`data/landmarks/measurements/<id>.json`: CC0 or public-domain numbers only (Wikidata,
HAER/HABS, NPS, public-domain texts), never traced from photos. A value marked `estimate` or
`derived` says in its note how it was set. Thin members (cables, suspenders, lamps) are drawn
wider than they are, by the readability scale, so they read at game distance. The models
are ours: no third-party licence applies to them.

### brooklyn-bridge

Retrieved 2026-10-07. Sources:

- `wikidata`: Wikidata Q125006 (Brooklyn Bridge), CC0-1.0, <https://www.wikidata.org/wiki/Q125006>
- `chamber-1906`: Chamber of Commerce of the State of New York, Rapid Transit in New York City and in the Other Great Cities (1906), ch. 4 "Bridges to Brooklyn", public-domain, <https://nycsubway.org/wiki/Chapter_04:_Bridges_to_Brooklyn>

Dimensions:

- `towerHeightM`: 84 m (wikidata): height (P2048): tower top above the water. The 1906 text gives 272 ft (82.9 m).
- `mainSpanM`: 486.3 m (wikidata): main span (P2787)
- `totalLengthM`: 1825.4 m (wikidata): length (P2043) 5,989 ft. The game fits the bridge to its LION frame (spanM), so the approaches are shorter.
- `deckWidthM`: 25.9 m (wikidata): width (P2049), 85 ft
- `midspanClearanceM`: 41 m (wikidata): vertical clearance (P2793): the deck top at mid-span
- `roadwayAtTowersM`: 36.35 m (chamber-1906): "at the towers the height of the roadway is 119.25 feet"
- `towerAtWater`: 42.98 × 17.98 m (chamber-1906): 141 by 59 ft at high water
- `towerAtRoadway`: 39.93 × 14.63 m (chamber-1906): 131 by 48 ft at the roadway
- `towerAtCornice`: 38.4 × 13.11 m (chamber-1906): 126 by 43 ft at the base of the cornice
- `archSpanM`: 10.29 m (chamber-1906): the three columns above the roadway are united by arches of 33.75 ft span
- `archRadiusM`: 14.68 m (chamber-1906): each arch is two arcs of 48 1/6 ft radius (a pointed arch)
- `archApexAboveRoadwayM`: 35.66 m (estimate): 117 ft, a commonly quoted figure not found in the public-domain text read; sets where the arches spring
- `corniceBaseM`: 76 m (estimate): height of the cornice base above the water, proportioned from the tower top and arch apex
- `mainCables`: 4 × 0.4 m diameter (chamber-1906): four cables, finished diameter 15.75 in
- `suspenders`: 1520 × 0.044 m diameter (chamber-1906): 1,520 suspender ropes, 1 5/8 to 1 3/4 in
- `promenadeAboveDeckM`: 3.66 m (chamber-1906): the promenade is 12 ft above the floor beams
- `outerRoadwayWidthM`: 5.72 m (chamber-1906): outside roadways 18.75 ft wide in the clear
- `approachBrooklynM`: 295.96 m (chamber-1906): Brooklyn approach 971 ft
- `approachManhattanM`: 476.25 m (chamber-1906): New York approach 1,562.5 ft
- `sideSpanM`: 283.4 m (derived): (total length - both approaches - main span) / 2, from the values above
- `anchorage`: 36 × 39 m (estimate): stylised anchorage blocks sized to take the cables; mostly hidden under the game's land top

Readability scale (drawn width ÷ true width): mainCable ×4, suspender ×5, stay ×5, lamp ×3.

Game scale: heights ×1.8, widths ×2. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8 and widths x2 against the real numbers above, so the towers, deck and cables read at the 3,000-4,500 m game camera. Lengths along the axis stay real (the towers 486 m apart, fitted to the LION frame).

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6680 triangles, 108904 bytes (`public/landmarks/brooklyn-bridge/lod0.glb`)
- L1: 3320 triangles, 59808 bytes (`public/landmarks/brooklyn-bridge/lod1.glb`)
- L2: 1200 triangles, 22852 bytes (`public/landmarks/brooklyn-bridge/lod2.glb`)
- L3: 584 triangles, 13288 bytes (`public/landmarks/brooklyn-bridge/lod3.glb`)

### deco-spire

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q11274 (the Lexington Avenue Art Deco tower), CC0-1.0, <https://www.wikidata.org/wiki/Q11274>

Dimensions:

- `heightM`: 318.9 m (wikidata): height (P2048), architectural: the spire's tip above the street
- `roofM`: 282 m (wikidata): height (P2048) to the roof: where the tiers end and the generic spire begins
- `footprint`: 62 × 56 m (estimate): the lower block's plan (the S07a kit's stylised footprint)
- `tier1M`: 75 m (estimate): the base block's height; tiers proportioned by eye from the S07a kit
- `tier2M`: 80 m (estimate): second tier, inset 7 m
- `tier3M`: 60 m (estimate): third tier, inset 6 m
- `tier4M`: 67 m (derived): the top tier, inset 5 m, up to the Wikidata roof height (282 m less the tiers below)
- `spireBaseM`: 12 m (estimate): the generic spire's base width (LEGAL-1: never a copy of the real crown)

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.12, widths ×1.2. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.12 and widths x1.2 against the numbers above (1.2 keeps the footprint inside the frame's exclusion), so the tower stands out from the real-scale district around it without dwarfing it.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 3018 triangles, 43752 bytes (`public/landmarks/deco-spire/lod0.glb`)
- L1: 1346 triangles, 20972 bytes (`public/landmarks/deco-spire/lod1.glb`)
- L2: 594 triangles, 11748 bytes (`public/landmarks/deco-spire/lod2.glb`)
- L3: 290 triangles, 7184 bytes (`public/landmarks/deco-spire/lod3.glb`)

### manhattan-bridge

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q125050 (Manhattan Bridge), CC0-1.0, <https://www.wikidata.org/wiki/Q125050>
- `chamber-1906`: Chamber of Commerce of the State of New York, Rapid Transit in New York City and in the Other Great Cities (1906), ch. 4 "Bridges to Brooklyn", public-domain, <https://nycsubway.org/wiki/Chapter_04:_Bridges_to_Brooklyn>

Dimensions:

- `towerHeightM`: 102 m (wikidata): height (P2048): tower top above the water. (The 1906 text gives the 400 ft of the design then; the towers were built lower.)
- `mainSpanM`: 451 m (wikidata): main span (P2787); the 1906 text gives 1,470 ft between tower centres
- `totalLengthM`: 2090 m (wikidata): length (P2043). The game fits the bridge to its LION frame (spanM).
- `deckWidthM`: 37 m (wikidata): width (P2049); the 1906 text gives the floor as 120 ft wide over all
- `midspanClearanceM`: 41 m (wikidata): vertical clearance (P2793): the deck top at mid-span
- `sideSpanM`: 220.98 m (chamber-1906): "each land span will be 725 feet in length"
- `mainCables`: 4 × 0.54 m diameter (estimate): four cables (the 1906 text specifies cables and suspenders); diameter estimated
- `trussDepthM`: 7.3 m (estimate): the deep stiffening trusses that carry the double deck, proportioned by eye
- `towerLeg`: 6 × 10 m (estimate): each steel tower leg's section, proportioned from the tower height
- `towerPier`: 50 × 18 m (estimate): the masonry pier each tower stands on, wider than the deck
- `pierTopM`: 12 m (estimate): the masonry pier's top above the water
- `crownM`: 6 m (estimate): the depth of the crown girder and finials at the top of each tower
- `anchorage`: 50 × 60 m (estimate): stylised anchorage blocks sized to take the cables; mostly hidden under the game's land top

Readability scale (drawn width ÷ true width): mainCable ×4, suspender ×5, lamp ×3.

Game scale: heights ×1.8, widths ×1.6. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8 and widths x1.6 against the real numbers above (1.6, not 2, keeps the 59 m deck inside the frame's 64 m exclusion), so the bridge reads at the 3,000-4,500 m game camera. Lengths along the axis stay real.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6640 triangles, 104540 bytes (`public/landmarks/manhattan-bridge/lod0.glb`)
- L1: 3232 triangles, 53584 bytes (`public/landmarks/manhattan-bridge/lod1.glb`)
- L2: 1192 triangles, 24160 bytes (`public/landmarks/manhattan-bridge/lod2.glb`)
- L3: 584 triangles, 13456 bytes (`public/landmarks/manhattan-bridge/lod3.glb`)

### midtown-terminal

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q11290 (the 42nd Street terminal), CC0-1.0, <https://www.wikidata.org/wiki/Q11290>

Dimensions:

- `heightM`: 36 m (estimate): the main hall's roof ridge above the street
- `hall`: 90 × 60 m (estimate): the main hall's front width (widthM) and depth (depthM)
- `hallM`: 30 m (estimate): the main hall's walls, to the cornice
- `wings`: 25 × 50 m (estimate): each side wing's width and depth
- `wingsM`: 20 m (estimate): the side wings' height
- `arches`: 10 × 20 m (estimate): three tall arched front windows: width (widthM) and height to the crown (depthM)

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.4, widths ×1.1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.4 and widths x1.1, within the frame's exclusion, so the station reads at the game camera. Wikidata gives no dimensions, so every number is an estimate (the S07a kit's stylised proportions).

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 2410 triangles, 25840 bytes (`public/landmarks/midtown-terminal/lod0.glb`)
- L1: 1034 triangles, 13004 bytes (`public/landmarks/midtown-terminal/lod1.glb`)
- L2: 478 triangles, 8052 bytes (`public/landmarks/midtown-terminal/lod2.glb`)
- L3: 156 triangles, 4692 bytes (`public/landmarks/midtown-terminal/lod3.glb`)

### queensboro-bridge

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q125157 (Queensboro Bridge), CC0-1.0, <https://www.wikidata.org/wiki/Q125157>
- `chamber-1906`: Chamber of Commerce of the State of New York, Rapid Transit in New York City and in the Other Great Cities (1906), ch. 4 "Bridges to Brooklyn" (the Blackwell's Island bridge), public-domain, <https://nycsubway.org/wiki/Chapter_04:_Bridges_to_Brooklyn>

Dimensions:

- `towerHeightM`: 105 m (wikidata): height (P2048): the tower finials above the water
- `totalLengthM`: 1135 m (wikidata): length (P2043) of the cantilever structure; the five spans below add up to it
- `shoreSpanWestM`: 143.1 m (chamber-1906): "a shore span on the Manhattan side, 469.5 feet in length"
- `riverSpanWestM`: 360.27 m (chamber-1906): "a river span of 1,182 feet"
- `islandSpanM`: 192.02 m (chamber-1906): "a central span across the island of 630 feet"
- `riverSpanEastM`: 299.92 m (chamber-1906): "a second river span of 984" feet
- `shoreSpanEastM`: 139.9 m (chamber-1906): "a shore span of 459 feet"
- `trussDepthAtTowersM`: 56.39 m (chamber-1906): "the height between the chords at the towers will be 185 feet"
- `trussDepthMidM`: 14 m (estimate): truss depth mid-span and at the anchor piers, proportioned by eye
- `deckClearanceM`: 41 m (estimate): the deck (bottom chord) above the water, about the East River bridges' 135 ft
- `deckWidthM`: 30 m (estimate): the deck between the truss walls (the S07a kit's stylised width)
- `finialM`: 7.61 m (derived): tower height - deck clearance - truss depth at the towers, so the finials top out at the Wikidata height
- `towerLeg`: 6 × 8 m (estimate): each steel tower leg's section over a pier
- `pier`: 36 × 14 m (estimate): the masonry piers (the S07a kit's stylised plan)
- `pierTopM`: 12 m (estimate): the masonry piers' top above the water

Readability scale (drawn width ÷ true width): chord ×3, member ×4, lamp ×3.

Game scale: heights ×1.8, widths ×1.8. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8 and widths x1.8 against the real numbers above (1.8 keeps the deck inside the frame's 56 m exclusion), so the bridge reads at the 3,000-4,500 m game camera. Lengths along the axis stay real.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6552 triangles, 111544 bytes (`public/landmarks/queensboro-bridge/lod0.glb`)
- L1: 3216 triangles, 57600 bytes (`public/landmarks/queensboro-bridge/lod1.glb`)
- L2: 1184 triangles, 21116 bytes (`public/landmarks/queensboro-bridge/lod2.glb`)
- L3: 424 triangles, 9192 bytes (`public/landmarks/queensboro-bridge/lod3.glb`)

### statue-of-liberty

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q9202 (Statue of Liberty), CC0-1.0, <https://www.wikidata.org/wiki/Q9202>
- `nps`: National Park Service, Statue of Liberty National Monument, "Statue Statistics", public-domain, <https://www.nps.gov/stli/learn/historyculture/statue-statistics.htm>

Dimensions:

- `heightM`: 92.99 m (nps): ground to tip of torch, 305 ft 1 in
- `statueM`: 46.05 m (nps): top of base to torch, 151 ft 1 in (Wikidata height 46 m)
- `pedestalTopM`: 46.94 m (nps): ground to the top of the pedestal, 154 ft (Wikidata gives the pedestal 47 m)
- `pedestalM`: 27.13 m (estimate): the granite pedestal alone, the commonly given 89 ft; the fort below takes the rest of the 46.94 m
- `heelToHeadM`: 33.86 m (nps): heel to top of head, 111 ft 1 in
- `headM`: 5.26 m (nps): chin to cranium, 17 ft 3 in
- `headWidthM`: 3.05 m (nps): width of head, 10 ft
- `armM`: 3.66 × 12.8 m (nps): right arm: width 12 ft (widthM), length 42 ft (depthM)
- `waistM`: 10.67 m (nps): width of waist, 35 ft
- `tablet`: 4.14 × 7.19 m (nps): tablet 13 ft 7 in wide (widthM) by 23 ft 7 in long (depthM), 2 ft thick
- `pedestalPlan`: 28 × 19 m (estimate): the pedestal's base (widthM) and top (depthM) width, proportioned by eye
- `fort`: 100 × 76 m (estimate): the eleven-point star fort's outer (widthM) and inner (depthM) diameter, proportioned by eye

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.8, widths ×1.8. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights and widths x1.8, so the statue reads from Battery Park at the 3,000-4,500 m game camera (S07b acceptance).

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 1070 triangles, 18888 bytes (`public/landmarks/statue-of-liberty/lod0.glb`)
- L1: 476 triangles, 10544 bytes (`public/landmarks/statue-of-liberty/lod1.glb`)
- L2: 218 triangles, 6704 bytes (`public/landmarks/statue-of-liberty/lod2.glb`)
- L3: 100 triangles, 4264 bytes (`public/landmarks/statue-of-liberty/lod3.glb`)

### times-square

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q11259 (Times Square) and Q1139633 (One Times Square), CC0-1.0, <https://www.wikidata.org/wiki/Q1139633>

Dimensions:

- `centralTowerM`: 110.6 m (wikidata): One Times Square height (P2048) 363 ft: the generic screen tower at the square's south end
- `centralTowerFloors`: 25 (wikidata): One Times Square floors (P1101)
- `squareLengthM`: 420 m (estimate): the bowtie's length along Broadway and Seventh Avenue, 42nd to 47th Street (five blocks of about 80 m)
- `plazaWidthM`: 70 × 26 m (estimate): the square's width at its ends (widthM) and at its waist (depthM), proportioned by eye
- `heightM`: 230 m (estimate): the tallest flanking tower: the model's top
- `flankLowM`: 60 m (estimate): the lowest flanking tower; the others are interpolated, generic

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1, widths ×1. Real scale: the square is a district of real-size blocks; its screens, not its size, make it read.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 3472 triangles, 46940 bytes (`public/landmarks/times-square/lod0.glb`)
- L1: 1688 triangles, 28492 bytes (`public/landmarks/times-square/lod1.glb`)
- L2: 588 triangles, 13484 bytes (`public/landmarks/times-square/lod2.glb`)
- L3: 290 triangles, 8056 bytes (`public/landmarks/times-square/lod3.glb`)

### washington-square-arch

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q2550491 (Washington Square Arch), CC0-1.0, <https://www.wikidata.org/wiki/Q2550491>

Dimensions:

- `heightM`: 23.5 m (estimate): the commonly published 77 ft; Wikidata has no height and no public-domain survey was found
- `widthM`: 17.4 m (estimate): the commonly published 57 ft overall width
- `openingM`: 9.1 × 14.3 m (estimate): the commonly published opening: piers 30 ft apart (widthM), 47 ft to the crown (depthM)
- `depthM`: 6 m (estimate): the arch's depth through the opening, proportioned by eye
- `atticM`: 5.5 m (estimate): the attic above the entablature, proportioned by eye

Readability scale (drawn width ÷ true width): .

Game scale: heights ×2, widths ×2. Game scale (orchestrator decision 2026-10-08, the user may overrule): x2, so the 23 m arch reads at the game camera above the park's trees.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 636 triangles, 12536 bytes (`public/landmarks/washington-square-arch/lod0.glb`)
- L1: 300 triangles, 7160 bytes (`public/landmarks/washington-square-arch/lod1.glb`)
- L2: 148 triangles, 4796 bytes (`public/landmarks/washington-square-arch/lod2.glb`)
- L3: 68 triangles, 3632 bytes (`public/landmarks/washington-square-arch/lod3.glb`)

### wedge-building

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q220728 (the Fifth Avenue wedge building), CC0-1.0, <https://www.wikidata.org/wiki/Q220728>

Dimensions:

- `heightM`: 94 m (wikidata): height (P2048) above the street
- `floors`: 22 (wikidata): floors above ground (P1101): one window band per storey
- `lengthM`: 58 m (estimate): length of the wedge along its axis (the S07a kit's stylised plan)
- `baseWidthM`: 26 m (estimate): width of the wide back
- `prowWidthM`: 2 m (estimate): width of the truncated prow
- `podiumM`: 8 m (estimate): the low podium's height, set out 0.6 m

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.12, widths ×1.2. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.12 and widths x1.2, so the wedge reads beside the real-scale district without leaving the frame's exclusion.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 1332 triangles, 18952 bytes (`public/landmarks/wedge-building/lod0.glb`)
- L1: 594 triangles, 10444 bytes (`public/landmarks/wedge-building/lod1.glb`)
- L2: 264 triangles, 6176 bytes (`public/landmarks/wedge-building/lod2.glb`)
- L3: 96 triangles, 3992 bytes (`public/landmarks/wedge-building/lod3.glb`)

<!-- measurements:end -->
