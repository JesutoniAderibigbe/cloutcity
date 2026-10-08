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

- L0: 6832 triangles, 110584 bytes (`public/landmarks/brooklyn-bridge/lod0.glb`)
- L1: 3308 triangles, 59864 bytes (`public/landmarks/brooklyn-bridge/lod1.glb`)
- L2: 1200 triangles, 23660 bytes (`public/landmarks/brooklyn-bridge/lod2.glb`)
- L3: 584 triangles, 12708 bytes (`public/landmarks/brooklyn-bridge/lod3.glb`)

<!-- measurements:end -->
