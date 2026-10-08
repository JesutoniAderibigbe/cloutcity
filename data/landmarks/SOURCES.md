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

### astoria-park

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q4811114 (Astoria Park), CC0-1.0, <https://www.wikidata.org/wiki/Q4811114>

Dimensions:

- `heightM`: 20 m (estimate): the pool bathhouse's twin towers above the park: the model's top
- `treeLowM`: 11 m (estimate): the lower canopy height of the tree masses
- `treeHighM`: 16 m (estimate): the upper canopy height (below the bathhouse towers)
- `treeSpacingM`: 40 m (estimate): canopy mound spacing at the finest level at density 1
- `pool`: 40.777504, -73.925076 (estimate): the big outdoor pool's centre, placed by eye inside the map's park outline
- `poolPlan`: 100 × 50 m (estimate): the pool's length (widthM) and width (depthM), the commonly published 330 by 165 ft (drawn at the readability scale)
- `bathhouse`: 70 × 18 m (estimate): the bathhouse along the pool's east side: length and depth
- `bathhouseM`: 9 m (estimate): the bathhouse's walls
- `lawn`: 40.780295, -73.921289 (estimate): the great lawn's centre, placed by eye inside the map's park outline
- `lawnAxes`: 120 × 60 m (estimate): its semi-axes, the long one running north-north-east
- `track`: 40.779035, -73.922827 (estimate): the running track's centre, placed by eye inside the map's park outline
- `trackAxes`: 60 × 34 m (estimate): its semi-axes
- `promenadeWidthM`: 10 m (estimate): the riverside promenade (Shore Boulevard), drawn along the park's west edge
- `lampSpacingM`: 40 m (estimate): between the promenade lamps
- `parkHeadingDeg`: 40 m (estimate): the park's long axis, compass degrees (north-north-east along the river)

Readability scale (drawn width ÷ true width): structures ×1.6, paths ×1.6, lamp ×3.

Game scale: heights ×1.6, widths ×1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.6 (trees, the bathhouse); the plan stays the map's park outline (park-qn0191), structures and paths take the readability scale.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 3814 triangles, 104540 bytes (`public/landmarks/astoria-park/lod0.glb`)
- L1: 1676 triangles, 45920 bytes (`public/landmarks/astoria-park/lod1.glb`)
- L2: 443 triangles, 14096 bytes (`public/landmarks/astoria-park/lod2.glb`)
- L3: 177 triangles, 6496 bytes (`public/landmarks/astoria-park/lod3.glb`)

### bronx-ballpark

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q753529 (the Bronx ballpark), CC0-1.0, <https://www.wikidata.org/wiki/Q753529>

Dimensions:

- `heightM`: 48 m (estimate): the light towers' tops above the street, proportioned by eye
- `fenceLeftM`: 96.9 m (estimate): home plate to the left-field foul pole (318 ft)
- `fenceCentreM`: 124.4 m (estimate): home plate to the centre-field fence
- `fenceRightM`: 95.7 m (estimate): home plate to the right-field foul pole
- `basePathM`: 27.43 m (derived): the 90 ft between bases (the rules of baseball)
- `moundM`: 18.44 m (derived): home plate to the pitcher's plate, 60 ft 6 in (the rules of baseball)
- `centreFieldHeadingDeg`: 60 m (estimate): compass heading from home plate to centre field, by eye
- `homeOffsetM`: 55 m (estimate): how far home plate stands back from the landmark point (Wikidata P625), toward the stands
- `foulM`: 16 m (estimate): foul ground from the foul lines and behind home plate to the stands
- `lowerDepthM`: 30 m (estimate): the lower deck's depth
- `lowerFrontM`: 2.5 m (estimate): the lower deck's front row above the field
- `lowerTopM`: 14 m (estimate): the lower deck's back row above the field
- `upperSetbackM`: 22 m (estimate): the upper deck's front row back from the lower deck's
- `upperDepthM`: 34 m (estimate): the upper deck's depth
- `upperFrontM`: 21 m (estimate): the upper deck's front above the field (the suites below it)
- `upperTopM`: 40 m (estimate): the upper deck's back row above the field
- `upperReachM`: 85 m (estimate): how far out along each foul line the upper deck runs
- `bleacherDepthM`: 22 m (estimate): the outfield bleachers' depth
- `bleacherTopM`: 10 m (estimate): the outfield bleachers' top
- `scoreboardWidthM`: 40 m (estimate): the scoreboard panel's width (a plain screen, no text)
- `scoreboardHeightM`: 16 m (estimate): the scoreboard panel's height
- `scoreboardBaseM`: 14 m (estimate): the scoreboard panel's bottom above the street
- `capacity`: 49642 (wikidata): maximum capacity (P1083), for scale

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.6, widths ×1.15. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.6 and plan x1.15, so the bowl reads at the 3,000-4,500 m game camera without its stands standing steeper than a real rake.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 2948 triangles, 44140 bytes (`public/landmarks/bronx-ballpark/lod0.glb`)
- L1: 1274 triangles, 21716 bytes (`public/landmarks/bronx-ballpark/lod1.glb`)
- L2: 582 triangles, 12996 bytes (`public/landmarks/bronx-ballpark/lod2.glb`)
- L3: 224 triangles, 6784 bytes (`public/landmarks/bronx-ballpark/lod3.glb`)

### brooklyn-arena

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q807966 (the Brooklyn arena), CC0-1.0, <https://www.wikidata.org/wiki/Q807966>

Dimensions:

- `heightM`: 36 m (estimate): the arena's roof edge above the street, proportioned by eye
- `glazedBaseM`: 9 m (estimate): the glazed concourse level under the metal band
- `length`: 175 × 125 m (estimate): the arena body's length and width (a rounded oblong)
- `headingDeg`: 105 m (estimate): compass heading of the arena's long axis, along the avenue to its south (by eye)
- `canopyHeadingDeg`: 305 m (estimate): compass heading from the arena's middle to the entrance canopy over the corner plaza
- `canopyDistanceM`: 100 m (estimate): from the arena's middle to the canopy's middle
- `canopyRadiusM`: 42 m (estimate): the canopy's radius
- `canopyOpeningM`: 14 m (estimate): the round opening's radius
- `canopyM`: 13 m (estimate): the canopy's height above the plaza
- `capacity`: 17732 (wikidata): maximum capacity (P1083), for scale

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.6, widths ×1.15. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.6 and plan x1.15 like the ballparks, so the arena reads at the 3,000-4,500 m game camera.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 1318 triangles, 18728 bytes (`public/landmarks/brooklyn-arena/lod0.glb`)
- L1: 486 triangles, 9168 bytes (`public/landmarks/brooklyn-arena/lod1.glb`)
- L2: 186 triangles, 5276 bytes (`public/landmarks/brooklyn-arena/lod2.glb`)
- L3: 74 triangles, 3656 bytes (`public/landmarks/brooklyn-arena/lod3.glb`)

### brooklyn-borough-hall

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q929403 (Brooklyn Borough Hall), CC0-1.0, <https://www.wikidata.org/wiki/Q929403>

Dimensions:

- `heightM`: 44 m (estimate): the cupola's tip above the street, proportioned by eye (Wikidata Q929403 lists no height; no PD/CC0 figure found)
- `block`: 40 × 26 m (estimate): the main block's plan (the S07a kit's stylised footprint)
- `wallM`: 17 m (estimate): the main cornice above the street: a tall raised basement and two storeys
- `basementM`: 4.5 m (estimate): the raised basement, drawn as a darker rusticated band; the portico floor stands at its top
- `atticM`: 1.2 m (estimate): the parapet over the cornice
- `roofM`: 2.5 m (estimate): the low hipped roof
- `storeys`: 2 (estimate): window storeys over the raised basement
- `portico`: 22 × 6 m (estimate): the Greek Revival front portico (the S07a kit's stylised plan)
- `porticoM`: 15 m (estimate): the portico's entablature top above the street
- `pedimentM`: 5 m (estimate): the pediment's rise over the entablature
- `porticoColumns`: 6 (estimate): columns across the portico front (hexastyle)
- `stepsM`: 8 m (estimate): how far the tall flight of front steps runs out ahead of the portico
- `cupolaBaseWidthM`: 10 m (estimate): the cupola's square lower stage across (drawn plain: no dial or text)
- `cupolaBaseM`: 5 m (estimate): the square lower stage's height
- `cupolaDrumDiameterM`: 8 m (estimate): the colonnaded drum across
- `cupolaDrumM`: 8 m (estimate): the colonnaded drum's height
- `cupolaDomeM`: 4.5 m (estimate): the dome's rise over the drum
- `lanternM`: 3 m (estimate): the lantern on the dome

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.8, widths ×1.35. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8 so the hall and its cupola read at the 3,000-4,500 m game camera; the plan x1.35, the most that fits the frame's exclusion (60 x 58 m) with the portico and steps.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 1676 triangles, 27980 bytes (`public/landmarks/brooklyn-borough-hall/lod0.glb`)
- L1: 672 triangles, 13164 bytes (`public/landmarks/brooklyn-borough-hall/lod1.glb`)
- L2: 280 triangles, 7580 bytes (`public/landmarks/brooklyn-borough-hall/lod2.glb`)
- L3: 108 triangles, 4796 bytes (`public/landmarks/brooklyn-borough-hall/lod3.glb`)

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

### central-park

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q160409 (Central Park) and its features: Q532029 Bethesda Terrace and Fountain, Q816268 Belvedere Castle, Q1190219 the Reservoir, Q903865 Great Lawn and Turtle Pond, Q902461 Sheep Meadow, Q3508849 Harlem Meer, Q7757717 The Pond, Q5163141 Conservatory Water, Q5061610 the Mall, Q63337240 North Woods and North Meadow, CC0-1.0, <https://www.wikidata.org/wiki/Q160409>

Dimensions:

- `heightM`: 27 m (estimate): the folly tower's roof tip above the surrounding park (the rock outcrop and a square tower), proportioned by eye
- `treeLowM`: 14 m (estimate): the lower canopy height of the tree masses
- `treeHighM`: 22 m (estimate): the upper canopy height of the tree masses (below the folly)
- `treeSpacingM`: 52 m (estimate): the spacing of canopy mounds at the finest level at density 1 (each mound a clump of trees)
- `bethesda`: 40.7741, -73.9711 (wikidata): Bethesda Terrace and Fountain (Q532029, P625): the generic terrace and fountain, facing up the park toward the lake
- `terrace`: 70 × 60 m (estimate): the terrace and its fountain plaza: width across the park and depth toward the lake
- `terraceM`: 6 m (estimate): the upper terrace above the plaza
- `fountainRadiusM`: 14 m (estimate): the fountain basin's radius
- `fountainM`: 7 m (estimate): the tiered fountain's height (no figure, LEGAL-1)
- `belvedere`: 40.7794, -73.9691 (wikidata): Belvedere Castle (Q816268, P625): the generic folly on its rock
- `rockM`: 12 m (estimate): the rock outcrop the folly stands on, above the park
- `rockRadiusM`: 30 m (estimate): the outcrop's radius at its foot
- `keep`: 12 × 9 m (estimate): the folly's half-length and height (its keep)
- `towerWidthM`: 7 m (estimate): the folly tower's side
- `towerRoofM`: 4 m (estimate): the turret roof's rise
- `reservoir`: 40.7864, -73.9623 (estimate): the Reservoir's middle, centred across the park and north of the Great Lawn (the Wikidata Q1190219 point, 40.785089, -73.960475, lies near its south-east shore)
- `reservoirAxes`: 420 × 300 m (derived): semi-axes along and across the park: an ellipse of about the reservoir's Wikidata area (43 ha, P2046; drawn 92 %), kept between the drives and clear of the Great Lawn
- `greatLawn`: 40.7813, -73.9665 (wikidata): Great Lawn and Turtle Pond (Q903865, P625, first point)
- `greatLawnAxes`: 150 × 105 m (estimate): the Great Lawn's semi-axes along and across the park
- `turtlePond`: 40.77985, -73.96855 (estimate): Turtle Pond, between the Great Lawn and the folly (by eye)
- `turtlePondAxes`: 80 × 32 m (estimate): Turtle Pond's semi-axes
- `sheepMeadow`: 40.771944, -73.975 (wikidata): Sheep Meadow (Q902461, P625)
- `sheepMeadowAxes`: 158.5 × 121.9 m (derived): semi-axes of an ellipse of Sheep Meadow's Wikidata area (15 acres, P2046)
- `harlemMeer`: 40.7966, -73.9517 (wikidata): Harlem Meer (Q3508849, P625)
- `harlemMeerAxes`: 140.8 × 100.6 m (estimate): Harlem Meer's semi-axes (about 11 acres)
- `pond`: 40.766361, -73.97449 (wikidata): The Pond (Q7757717, P625)
- `pondAxes`: 95 × 45 m (estimate): The Pond's semi-axes
- `conservatoryWater`: 40.77418, -73.96747 (wikidata): Conservatory Water (Q5163141, P625)
- `conservatoryWaterAxes`: 60 × 38 m (estimate): Conservatory Water's semi-axes
- `lake`: 40.7763, -73.9718 (estimate): the Lake's middle, north of the terrace (no Wikidata point found; by eye)
- `lakeAxes`: 210 × 105 m (estimate): the Lake's semi-axes (about 20 acres)
- `northMeadow`: 40.7935, -73.9585 (estimate): North Meadow, south of the North Woods point (Q63337240), by eye
- `northMeadowAxes`: 190 × 120 m (estimate): North Meadow's semi-axes
- `mallSouth`: 40.771111, -73.971667 (wikidata): the Mall (Q5061610, P625, second point): its south end; it runs to the terrace
- `mallWidthM`: 12 m (estimate): the Mall's paved width
- `driveWidthM`: 9 m (estimate): the park drive's width
- `driveInset`: 130 × 95 m (estimate): how far the loop drive runs inside the park outline: from each long side and from each end
- `lampSpacingM`: 80 m (estimate): lamps along the drive at the finest level

Readability scale (drawn width ÷ true width): structures ×2, paths ×2, lamp ×3.

Game scale: heights ×1.8, widths ×1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8 (trees, the folly, the terrace); the plan stays the map's park outline (x1.0) so the model fits the green the map draws; structures and paths take the readability scale instead.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6748 triangles, 171044 bytes (`public/landmarks/central-park/lod0.glb`)
- L1: 3290 triangles, 83288 bytes (`public/landmarks/central-park/lod1.glb`)
- L2: 1179 triangles, 29900 bytes (`public/landmarks/central-park/lod2.glb`)
- L3: 570 triangles, 14364 bytes (`public/landmarks/central-park/lod3.glb`)

### city-hall

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q1065206 (New York City Hall), CC0-1.0, <https://www.wikidata.org/wiki/Q1065206>
- `nps-survey-1959`: National Park Service, National Survey of Historic Sites and Buildings: New York City Hall (1959; NRHP 66000539), public-domain, <https://npgallery.nps.gov/NRHP/GetAsset/NHLS/66000539_text>

Dimensions:

- `lengthM`: 65.76 m (wikidata): length (P2043, 215.75 ft): the front from wing end to wing end
- `storeys`: 2 (wikidata): number of floors above ground (P1101): two storeys over a raised basement
- `heightM`: 42 m (estimate): the cupola's tip above the street, proportioned by eye (no PD/CC0 figure found); a plain needle stands in for the statue (LEGAL-1: no figures)
- `wallM`: 16 m (estimate): the main cornice above the street: a raised basement and two tall storeys
- `basementM`: 3.5 m (estimate): the raised basement storey, drawn as a darker rusticated band
- `atticM`: 1.6 m (estimate): the balustrade over the cornice
- `roofM`: 3 m (estimate): the low hipped roof behind the balustrade
- `centreBlock`: 37.76 × 32 m (derived): the front length less the two wings; the depth is an estimate
- `wing`: 14 × 5 m (estimate): each end wing's width (two bays) and how far it projects ahead of the centre block (the C-shaped plan the NPS survey's engravings show)
- `portico`: 22 × 5 m (estimate): the central columned portico at the main storey, with a balustrade over it
- `porticoM`: 9 m (estimate): the portico's top above the street
- `porticoColumns`: 6 (estimate): columns across the portico front
- `stepsM`: 6 m (estimate): how far the broad front steps run out ahead of the portico
- `cupolaBaseWidthM`: 9 m (estimate): the cupola's square lower stage across (the clock stage, drawn plain: no dial or text)
- `cupolaBaseM`: 6 m (estimate): the square lower stage's height
- `cupolaDrumDiameterM`: 7.6 m (estimate): the colonnaded drum across
- `cupolaDrumM`: 7 m (estimate): the colonnaded drum's height
- `cupolaDomeM`: 4.5 m (estimate): the dome's rise over the drum
- `lanternM`: 2.5 m (estimate): the small lantern on the dome

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.8, widths ×1.25. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8 so the hall and its cupola read at the 3,000-4,500 m game camera; the plan x1.25, the most that fits the frame's exclusion (86 x 60 m).

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 3350 triangles, 50124 bytes (`public/landmarks/city-hall/lod0.glb`)
- L1: 1186 triangles, 20048 bytes (`public/landmarks/city-hall/lod1.glb`)
- L2: 386 triangles, 9744 bytes (`public/landmarks/city-hall/lod2.glb`)
- L3: 168 triangles, 5940 bytes (`public/landmarks/city-hall/lod3.glb`)

### coney-island-boardwalk

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q4380603 (Riegelmann Boardwalk), CC0-1.0, <https://www.wikidata.org/wiki/Q4380603>

Dimensions:

- `heightM`: 10.5 m (estimate): the shelters' roofs above the street (deck 3 m plus shelters 7.5 m): the model's top
- `lengthM`: 2700 m (estimate): the stretch modelled, centred on the Wikidata point (the boardwalk runs about 4.3 km in all)
- `widthM`: 24.4 m (estimate): the commonly published 80 ft
- `deckM`: 3 m (estimate): the deck above the beach
- `headingDeg`: 76 m (estimate): the boardwalk's compass heading (east-north-east along the shore), by eye
- `beachM`: 110 m (estimate): the beach between the boardwalk and the water line
- `pier`: 12 × 300 m (estimate): the fishing pier: width (widthM) and length out from the boardwalk (depthM)
- `shelter`: 18 × 10 m (estimate): a generic roofed shelter on the deck
- `shelterM`: 7.5 m (estimate): the shelters' height above the deck
- `pierWestM`: 350 m (estimate): how far west of the Wikidata point the fishing pier leaves the boardwalk

Readability scale (drawn width ÷ true width): width ×1.6, lamp ×3.

Game scale: heights ×1.6, widths ×1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.6; lengths real, widths at the readability scale.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6970 triangles, 106416 bytes (`public/landmarks/coney-island-boardwalk/lod0.glb`)
- L1: 3290 triangles, 52344 bytes (`public/landmarks/coney-island-boardwalk/lod1.glb`)
- L2: 1130 triangles, 21256 bytes (`public/landmarks/coney-island-boardwalk/lod2.glb`)
- L3: 122 triangles, 4384 bytes (`public/landmarks/coney-island-boardwalk/lod3.glb`)

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

### dumbo

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q1264951 (DUMBO) and Q16996543 (Jane's Carousel), CC0-1.0, <https://www.wikidata.org/wiki/Q1264951>

Dimensions:

- `heightM`: 80 m (estimate): the waterfront clock-tower warehouse's tower top (generic: no clock face)
- `towerBlockM`: 55 m (estimate): that warehouse's main block, about 16 storeys
- `warehouseM`: 45 × 25 m (estimate): the other warehouses' tallest (widthM) and lowest (depthM) heights
- `blockPlan`: 50 × 40 m (estimate): a warehouse block's plan
- `parkStrip`: 260 × 40 m (estimate): the waterfront park lawn's length and width
- `carousel`: 22 × 9 m (estimate): the carousel's glass pavilion: side (widthM) and height (depthM)

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.2, widths ×1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.2; plan real, so the blocks match the district around them.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6840 triangles, 68356 bytes (`public/landmarks/dumbo/lod0.glb`)
- L1: 3120 triangles, 36020 bytes (`public/landmarks/dumbo/lod1.glb`)
- L2: 1200 triangles, 16808 bytes (`public/landmarks/dumbo/lod2.glb`)
- L3: 576 triangles, 9956 bytes (`public/landmarks/dumbo/lod3.glb`)

### flushing-main-street

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q6736067 (Flushing Main Street), CC0-1.0, <https://www.wikidata.org/wiki/Q6736067>

Dimensions:

- `heightM`: 90 m (estimate): the tallest of the newer towers behind Main Street: the model's top
- `streetLengthM`: 360 m (estimate): the stretch of Main Street modelled, about four blocks
- `streetWidthM`: 24 m (estimate): Main Street between the building lines, with its sidewalks
- `frontageM`: 28 × 10 m (estimate): the shopfront blocks' tallest (widthM) and lowest (depthM) heights
- `towerLowM`: 55 m (estimate): the lower of the towers behind the street

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.2, widths ×1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.2; plan real, so the blocks match the district around them.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6984 triangles, 73556 bytes (`public/landmarks/flushing-main-street/lod0.glb`)
- L1: 3264 triangles, 41400 bytes (`public/landmarks/flushing-main-street/lod1.glb`)
- L2: 1088 triangles, 17420 bytes (`public/landmarks/flushing-main-street/lod2.glb`)
- L3: 540 triangles, 10992 bytes (`public/landmarks/flushing-main-street/lod3.glb`)

### flushing-meadows

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q745296 (Flushing Meadows Corona Park) and the points of its features: Q717956, Q4571746, Q1320229, Q2306200, Q1852081, Q1072882, CC0-1.0, <https://www.wikidata.org/wiki/Q745296>

Dimensions:

- `heightM`: 69 m (estimate): the tallest observation deck's top above the park (about 226 ft)
- `treeLowM`: 12 m (estimate): the lower canopy height of the tree masses
- `treeHighM`: 19 m (estimate): the upper canopy height
- `treeSpacingM`: 60 m (estimate): canopy mound spacing at the finest level at density 1
- `parkHeadingDeg`: 160 m (estimate): the compass heading of the park's long axis and its lakes
- `fountainPool`: 40.746389, -73.845 (wikidata): the fair's central plaza (the steel globe's point, Q717956 P625): drawn as a generic round fountain pool with plain jets; no globe replica (LEGAL-1)
- `fountainRadiusM`: 40 m (estimate): the round pool's radius
- `jetM`: 6 m (estimate): the fountain jets' height
- `pavilion`: 40.744028, -73.844417 (wikidata): the 1964 exposition pavilion (Q4571746, P625): generic observation towers beside an open ring of columns
- `ringAxes`: 53 × 38 m (estimate): the open ring pavilion's semi-axes
- `ringM`: 30 m (estimate): the ring pavilion's columns' height
- `ringColumns`: 16 (estimate): columns round the ring
- `towerHighM`: 69 m (derived): the tallest tower's deck top: the measured height
- `towerMidM`: 46 m (estimate): the middle tower's deck top (about 150 ft)
- `towerLowM`: 18 m (estimate): the low tower's deck top (about 60 ft)
- `towerDeckRadiusM`: 14 m (estimate): the round decks' radius
- `towerShaftRadiusM`: 3.5 m (estimate): each tower shaft's radius
- `museum`: 40.745833, -73.846667 (wikidata): the art museum's building (Q1320229, P625): a generic long low hall
- `museumPlan`: 110 × 60 m (estimate): the museum hall's length and width
- `museumM`: 12 m (estimate): the museum hall's height
- `science`: 40.747445, -73.851628 (wikidata): the science museum (Q2306200, P625): a generic hall
- `sciencePlan`: 90 × 55 m (estimate): its length and width
- `scienceM`: 24 m (estimate): its height
- `tennis`: 40.75, -73.8475 (wikidata): the tennis centre (Q1852081, P625): paved ground, no trees (its venues are not drawn)
- `tennisAxes`: 260 × 190 m (estimate): the paved tennis grounds' semi-axes
- `ballpark`: 40.756986, -73.845783 (wikidata): the Queens ballpark's point (Q1072882, P625): kept clear for its own model
- `ballparkClearM`: 230 m (estimate): the radius kept clear round the ballpark
- `longPool`: 40.7485, -73.8436 (estimate): a long formal pool north of the plaza, by eye
- `longPoolAxes`: 170 × 26 m (estimate): its semi-axes
- `longPoolHeadingDeg`: 20 m (estimate): its long axis' compass heading
- `meadowLake`: 40.7305, -73.8395 (estimate): Meadow Lake's middle, by eye
- `meadowLakeAxes`: 560 × 215 m (estimate): its semi-axes (about 94 acres)
- `willowLake`: 40.7215, -73.8318 (estimate): Willow Lake's middle, by eye
- `willowLakeAxes`: 380 × 190 m (estimate): its semi-axes (about 57 acres)
- `fairLawn`: 40.7415, -73.8428 (estimate): the open lawns south of the pavilion, by eye
- `fairLawnAxes`: 240 × 150 m (estimate): their semi-axes
- `pathWidthM`: 10 m (estimate): the promenades' width
- `lampSpacingM`: 80 m (estimate): lamps along the promenades at the finest level
- `spine0`: 40.7525, -73.8445 (estimate): promenade point 0: the north fairgrounds (by eye)
- `spine1`: 40.7466, -73.8452 (estimate): promenade point 1: west of the plaza (by eye)
- `spine2`: 40.742, -73.8446 (estimate): promenade point 2: past the pavilion (by eye)
- `spine3`: 40.736, -73.844 (estimate): promenade point 3: Meadow Lake's north-west shore (by eye)
- `spine4`: 40.727, -73.841 (estimate): promenade point 4: along Meadow Lake's west shore (by eye)
- `spine5`: 40.72, -73.8355 (estimate): promenade point 5: Willow Lake's north shore (by eye)
- `spine6`: 40.716, -73.83 (estimate): promenade point 6: the south end (by eye)
- `cross0`: 40.7472, -73.8505 (estimate): cross promenade end 0: the science museum (by eye)
- `cross1`: 40.7458, -73.8392 (estimate): cross promenade end 1: the east side (by eye)

Readability scale (drawn width ÷ true width): structures ×1.6, paths ×2, lamp ×3.

Game scale: heights ×1.8, widths ×1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8; the plan stays the map's park outline (x1.0); structures and promenades take the readability scale.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6716 triangles, 164828 bytes (`public/landmarks/flushing-meadows/lod0.glb`)
- L1: 3250 triangles, 78660 bytes (`public/landmarks/flushing-meadows/lod1.glb`)
- L2: 1094 triangles, 27128 bytes (`public/landmarks/flushing-meadows/lod2.glb`)
- L3: 522 triangles, 11984 bytes (`public/landmarks/flushing-meadows/lod3.glb`)

### high-line

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q843869 (High Line), CC0-1.0, <https://www.wikidata.org/wiki/Q843869>

Dimensions:

- `lengthM`: 2330 m (wikidata): length (P2043, 2.33 km): the route below runs about this long
- `heightM`: 15 m (derived): the tallest tree's top above the street: the deck's elevation plus the tallest tree
- `elevationM`: 9 m (estimate): the deck top above the street (about 30 ft)
- `treeHighM`: 6 m (estimate): the tallest small trees in the beds
- `treeLowM`: 3.5 m (estimate): the lower small trees
- `deckWidthM`: 10 m (estimate): the viaduct's width (it widens and narrows; one width drawn)
- `deckThicknessM`: 1.2 m (estimate): the deck slab
- `girderM`: 1.4 m (estimate): the edge girders' depth below the slab
- `walkWidthM`: 3.5 m (estimate): the paved walk down the middle
- `columnSpacingM`: 20 m (estimate): between column pairs along the line
- `columnWidthM`: 0.9 m (estimate): each steel column's side
- `treeSpacingM`: 30 m (estimate): small trees along the beds at the finest level
- `shrubSpacingM`: 14 m (estimate): shrubs along the beds at the finest level
- `cornerRadiusM`: 45 m (estimate): how round the line turns its corners
- `route0`: 40.73975, -74.0082 (estimate): route point 0: the south end at Gansevoort Street (by eye from the street grid; no PD/CC0 alignment found)
- `route1`: 40.7416, -74.0079 (estimate): route point 1: along Washington Street near 14th Street (by eye from the street grid; no PD/CC0 alignment found)
- `route2`: 40.74335, -74.00695 (estimate): route point 2: 16th Street, turning onto the avenue grid (by eye from the street grid; no PD/CC0 alignment found)
- `route3`: 40.7458, -74.00515 (estimate): route point 3: 20th Street (by eye from the street grid; no PD/CC0 alignment found)
- `route4`: 40.7478, -74.0037 (estimate): route point 4: 23rd Street (by eye from the street grid; no PD/CC0 alignment found)
- `route5`: 40.7526, -74.0002 (estimate): route point 5: 30th Street, where the line turns west (by eye from the street grid; no PD/CC0 alignment found)
- `route6`: 40.7544, -74.0045 (estimate): route point 6: 30th Street at 12th Avenue, turning north (by eye from the street grid; no PD/CC0 alignment found)
- `route7`: 40.7565, -74.003 (estimate): route point 7: 34th Street, turning east (by eye from the street grid; no PD/CC0 alignment found)
- `route8`: 40.7556, -74.0008 (estimate): route point 8: the north end on 34th Street (by eye from the street grid; no PD/CC0 alignment found)

Readability scale (drawn width ÷ true width): deck ×2, columns ×3.

Game scale: heights ×1.8, widths ×1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8 (the deck stands 16 m over the street); the route keeps its real length; widths take the readability scale.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6680 triangles, 133940 bytes (`public/landmarks/high-line/lod0.glb`)
- L1: 3232 triangles, 63584 bytes (`public/landmarks/high-line/lod1.glb`)
- L2: 1191 triangles, 24920 bytes (`public/landmarks/high-line/lod2.glb`)
- L3: 589 triangles, 13688 bytes (`public/landmarks/high-line/lod3.glb`)

### jamaica-station

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q11310077 (Jamaica), CC0-1.0, <https://www.wikidata.org/wiki/Q11310077>

Dimensions:

- `heightM`: 22 m (estimate): the station hall's roof above the street
- `hall`: 60 × 32 m (estimate): the hall's front width and depth
- `hallFloors`: 4 (estimate): storeys of windows on the hall
- `pavilion`: 12 × 12 m (estimate): each entrance pavilion's plan
- `pavilionM`: 11 m (estimate): the pavilions' height
- `pavilionSpacingM`: 72 m (estimate): between the pavilions' centres
- `canopy`: 70 × 16 m (estimate): the canopy's length and width
- `canopyM`: 9 m (estimate): the canopy's height

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.4, widths ×1.1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.4 and widths x1.1, within the frame's exclusion, so the station reads at the game camera. Wikidata gives no dimensions, so every number is an estimate (the S07a kit's stylised proportions).

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 1144 triangles, 17344 bytes (`public/landmarks/jamaica-station/lod0.glb`)
- L1: 544 triangles, 10220 bytes (`public/landmarks/jamaica-station/lod1.glb`)
- L2: 224 triangles, 6080 bytes (`public/landmarks/jamaica-station/lod2.glb`)
- L3: 76 triangles, 3976 bytes (`public/landmarks/jamaica-station/lod3.glb`)

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

### penn-station

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q54451 (Pennsylvania Station), CC0-1.0, <https://www.wikidata.org/wiki/Q54451>

Dimensions:

- `heightM`: 13.8 m (estimate): the entrance pavilions' roofs above the street
- `pavilion`: 18 × 14 m (estimate): each entrance pavilion's width and depth
- `pavilionM`: 13 m (estimate): the entrance pavilions' height
- `pavilionSpacingM`: 140 m (estimate): between the two pavilions' centres
- `canopy`: 110 × 24 m (estimate): the concourse canopy's length (widthM) and width (depthM)
- `canopyM`: 10 m (estimate): the canopy's height

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.4, widths ×1.1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.4 and widths x1.1, within the frame's exclusion, so the station reads at the game camera. Wikidata gives no dimensions, so every number is an estimate (the S07a kit's stylised proportions).

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 688 triangles, 11552 bytes (`public/landmarks/penn-station/lod0.glb`)
- L1: 332 triangles, 7456 bytes (`public/landmarks/penn-station/lod1.glb`)
- L2: 144 triangles, 4876 bytes (`public/landmarks/penn-station/lod2.glb`)
- L3: 64 triangles, 3732 bytes (`public/landmarks/penn-station/lod3.glb`)

### prospect-park

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q1049632 (Prospect Park) and its features: Q106694860 Prospect Park Lake, Q4931524 Prospect Park Boathouse, Q6647480 Litchfield Villa, CC0-1.0, <https://www.wikidata.org/wiki/Q1049632>

Dimensions:

- `heightM`: 21 m (estimate): the villa's tower top above the park, proportioned by eye
- `treeLowM`: 13 m (estimate): the lower canopy height of the tree masses
- `treeHighM`: 19 m (estimate): the upper canopy height (below the villa tower)
- `treeSpacingM`: 48 m (estimate): canopy mound spacing at the finest level at density 1
- `longMeadowNorth`: 40.6685, -73.9695 (estimate): the Long Meadow's northern half, by eye
- `longMeadowNorthAxes`: 330 × 140 m (estimate): its semi-axes, the long one running south-south-west
- `longMeadowSouth`: 40.6627, -73.9732 (estimate): the Long Meadow's southern half, by eye
- `longMeadowSouthAxes`: 290 × 130 m (estimate): its semi-axes
- `longMeadowHeadingDeg`: 205 m (estimate): the compass heading of the Long Meadow's long axis
- `nethermead`: 40.6597, -73.9683 (estimate): the Nethermead, the park's middle meadow, by eye
- `nethermeadAxes`: 170 × 115 m (estimate): its semi-axes
- `lake`: 40.6535, -73.968 (estimate): Prospect Park Lake's middle, by eye (Wikidata Q106694860 gives no point)
- `lakeAxes`: 420 × 190 m (derived): semi-axes of an ellipse of the lake's Wikidata area (60 acres, P2046), the long axis east-north-east
- `lakeHeadingDeg`: 75 m (estimate): the compass heading of the lake's long axis
- `lullwater`: 40.6573, -73.9652 (estimate): the Lullwater, the narrow water from the boathouse down to the lake, by eye
- `lullwaterAxes`: 240 × 34 m (estimate): its semi-axes, the long one north-south
- `boathouse`: 40.660833, -73.965278 (wikidata): Prospect Park Boathouse (Q4931524, P625): a generic pale pavilion and terrace over the water
- `boathouse2`: 40 × 26 m (estimate): the boathouse terrace's width and depth
- `boathouseM`: 9 m (estimate): the boathouse's height
- `villa`: 40.666944, -73.973889 (wikidata): Litchfield Villa (Q6647480, P625): a generic villa with a square tower
- `villaKeep`: 10 × 9 m (estimate): the villa's half-length and height
- `villaTowerWidthM`: 6 m (estimate): the villa tower's side
- `villaRoofM`: 3 m (estimate): the tower's pointed roof
- `driveWidthM`: 9 m (estimate): the park drive's width
- `lampSpacingM`: 80 m (estimate): lamps along the drive at the finest level
- `drive0`: 40.6703, -73.9688 (estimate): loop drive point 0: north, near Grand Army Plaza (by eye)
- `drive1`: 40.6668, -73.9722 (estimate): loop drive point 1: west side (by eye)
- `drive2`: 40.6618, -73.9758 (estimate): loop drive point 2: south-west (by eye)
- `drive3`: 40.656, -73.972 (estimate): loop drive point 3: west of the lake (by eye)
- `drive4`: 40.6512, -73.97 (estimate): loop drive point 4: south-west of the lake (by eye)
- `drive5`: 40.6503, -73.966 (estimate): loop drive point 5: south of the lake (by eye)
- `drive6`: 40.654, -73.964 (estimate): loop drive point 6: east of the lake (by eye)
- `drive7`: 40.66, -73.9645 (estimate): loop drive point 7: east side (by eye)
- `drive8`: 40.666, -73.965 (estimate): loop drive point 8: north-east (by eye)
- `drive9`: 40.6698, -73.966 (estimate): loop drive point 9: north (by eye)

Readability scale (drawn width ÷ true width): structures ×2, paths ×2, lamp ×3.

Game scale: heights ×1.8, widths ×1. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8; the plan stays the map's park outline (x1.0); structures and the drive take the readability scale.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 6726 triangles, 179324 bytes (`public/landmarks/prospect-park/lod0.glb`)
- L1: 3002 triangles, 80532 bytes (`public/landmarks/prospect-park/lod1.glb`)
- L2: 1173 triangles, 33020 bytes (`public/landmarks/prospect-park/lod2.glb`)
- L3: 539 triangles, 16044 bytes (`public/landmarks/prospect-park/lod3.glb`)

### queens-ballpark

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q1072882 (the Queens ballpark), CC0-1.0, <https://www.wikidata.org/wiki/Q1072882>

Dimensions:

- `heightM`: 48 m (estimate): the light towers' tops above the street, proportioned by eye
- `fenceLeftM`: 102.1 m (estimate): home plate to the left-field foul pole (335 ft)
- `fenceCentreM`: 124.4 m (estimate): home plate to the centre-field fence
- `fenceRightM`: 100.6 m (estimate): home plate to the right-field foul pole
- `basePathM`: 27.43 m (derived): the 90 ft between bases (the rules of baseball)
- `moundM`: 18.44 m (derived): home plate to the pitcher's plate, 60 ft 6 in (the rules of baseball)
- `centreFieldHeadingDeg`: 35 m (estimate): compass heading from home plate to centre field, by eye
- `homeOffsetM`: 55 m (estimate): how far home plate stands back from the landmark point (Wikidata P625), toward the stands
- `foulM`: 16 m (estimate): foul ground from the foul lines and behind home plate to the stands
- `lowerDepthM`: 30 m (estimate): the lower deck's depth
- `lowerFrontM`: 2.5 m (estimate): the lower deck's front row above the field
- `lowerTopM`: 14 m (estimate): the lower deck's back row above the field
- `upperSetbackM`: 22 m (estimate): the upper deck's front row back from the lower deck's
- `upperDepthM`: 34 m (estimate): the upper deck's depth
- `upperFrontM`: 21 m (estimate): the upper deck's front above the field (the suites below it)
- `upperTopM`: 40 m (estimate): the upper deck's back row above the field
- `upperReachM`: 85 m (estimate): how far out along each foul line the upper deck runs
- `bleacherDepthM`: 22 m (estimate): the outfield bleachers' depth
- `bleacherTopM`: 10 m (estimate): the outfield bleachers' top
- `scoreboardWidthM`: 40 m (estimate): the scoreboard panel's width (a plain screen, no text)
- `scoreboardHeightM`: 16 m (estimate): the scoreboard panel's height
- `scoreboardBaseM`: 14 m (estimate): the scoreboard panel's bottom above the street
- `capacity`: 41922 (wikidata): maximum capacity (P1083), for scale

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.6, widths ×1.15. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.6 and plan x1.15, so the bowl reads at the 3,000-4,500 m game camera without its stands standing steeper than a real rake.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 2948 triangles, 45476 bytes (`public/landmarks/queens-ballpark/lod0.glb`)
- L1: 1274 triangles, 21864 bytes (`public/landmarks/queens-ballpark/lod1.glb`)
- L2: 582 triangles, 12852 bytes (`public/landmarks/queens-ballpark/lod2.glb`)
- L3: 224 triangles, 6736 bytes (`public/landmarks/queens-ballpark/lod3.glb`)

### queens-borough-hall

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q2122585 (Queens Borough Hall), CC0-1.0, <https://www.wikidata.org/wiki/Q2122585>

Dimensions:

- `heightM`: 23 m (estimate): the roof ridge above the street, proportioned by eye (Wikidata Q2122585 lists no height; no PD/CC0 figure found)
- `block`: 96 × 22 m (estimate): the long main block's plan (the S07a kit's stylised footprint)
- `wallM`: 20 m (estimate): the main cornice above the street: four storeys of brick over a stone base
- `basementM`: 3 m (estimate): the stone base storey, drawn as a darker band
- `atticM`: 1.2 m (estimate): the parapet over the cornice
- `roofM`: 1.8 m (derived): the low roof: the measured height less the wall and parapet
- `storeys`: 4 (estimate): window storeys (the S07a kit's four floors)
- `windowColumns`: 14 (estimate): window bays along the long front (the S07a kit's 14 columns)
- `portico`: 24 × 5 m (estimate): the central stone portico (the S07a kit's stylised plan)
- `porticoM`: 16 m (estimate): the portico's top above the street, a balustrade over it
- `porticoColumns`: 6 (estimate): columns across the portico front
- `stepsM`: 3 m (estimate): how far the front steps run out ahead of the portico

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.8, widths ×1.15. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.8 so the long hall reads at the 3,000-4,500 m game camera; the plan x1.15, the most that fits the frame's exclusion (116 m along Queens Boulevard).

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 1954 triangles, 28840 bytes (`public/landmarks/queens-borough-hall/lod0.glb`)
- L1: 602 triangles, 10744 bytes (`public/landmarks/queens-borough-hall/lod1.glb`)
- L2: 178 triangles, 5588 bytes (`public/landmarks/queens-borough-hall/lod2.glb`)
- L3: 60 triangles, 3720 bytes (`public/landmarks/queens-borough-hall/lod3.glb`)

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

### september-11-memorial

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q1136137 (National September 11 Memorial & Museum), CC0-1.0, <https://www.wikidata.org/wiki/Q1136137>

Dimensions:

- `heightM`: 13.6 m (estimate): the plaza trees' crowns above the street (the raised plaza plus the trees): the model's top
- `plaza`: 180 × 220 m (estimate): the memorial plaza's width and length, proportioned by eye
- `poolM`: 53.6 m (estimate): each reflecting pool's side, the commonly published 176 ft (about an acre); Wikidata gives no dimensions
- `poolSpacingM`: 110 m (estimate): between the two pools' centres, standing in the original towers' footprints
- `voidM`: 18 m (estimate): the central void's side in each pool
- `treeM`: 12 m (estimate): a plaza tree's height

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1, widths ×1. Real scale: a memorial is not exaggerated; its plaza raised 2 m so the pools can be cut into it above the game's solid land.

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 3372 triangles, 58708 bytes (`public/landmarks/september-11-memorial/lod0.glb`)
- L1: 1660 triangles, 30428 bytes (`public/landmarks/september-11-memorial/lod1.glb`)
- L2: 460 triangles, 10188 bytes (`public/landmarks/september-11-memorial/lod2.glb`)
- L3: 228 triangles, 6204 bytes (`public/landmarks/september-11-memorial/lod3.glb`)

### staten-island-ferry

Retrieved 2026-10-08. Sources:

- `wikidata`: Wikidata Q5927015 (Saint George Terminal), CC0-1.0, <https://www.wikidata.org/wiki/Q5927015>

Dimensions:

- `heightM`: 20 m (estimate): the terminal hall's roof above the street
- `hall`: 110 × 60 m (estimate): the terminal hall's front width and depth
- `hallFloors`: 3 (estimate): storeys of windows on the hall
- `pavilion`: 14 × 12 m (estimate): each entrance pavilion's plan
- `pavilionM`: 12 m (estimate): the pavilions' height
- `pavilionSpacingM`: 42 m (estimate): between the pavilions' centres (three pavilions)
- `canopy`: 100 × 18 m (estimate): the canopy's length and width
- `canopyM`: 9 m (estimate): the canopy's height

Readability scale (drawn width ÷ true width): .

Game scale: heights ×1.4, widths ×1.05. Game scale (orchestrator decision 2026-10-08, the user may overrule): heights x1.4 and widths x1.05, within the frame's exclusion, so the station reads at the game camera. Wikidata gives no dimensions, so every number is an estimate (the S07a kit's stylised proportions).

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 600 / mid 1800 / high 3500 triangles:

- L0: 1666 triangles, 23064 bytes (`public/landmarks/staten-island-ferry/lod0.glb`)
- L1: 710 triangles, 12396 bytes (`public/landmarks/staten-island-ferry/lod1.glb`)
- L2: 334 triangles, 7436 bytes (`public/landmarks/staten-island-ferry/lod2.glb`)
- L3: 102 triangles, 4448 bytes (`public/landmarks/staten-island-ferry/lod3.glb`)

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

Built with Blender 5.2.2 (d13f752e3b9c) under caps low 1200 / mid 3500 / high 7000 triangles:

- L0: 3712 triangles, 49404 bytes (`public/landmarks/times-square/lod0.glb`)
- L1: 1840 triangles, 29720 bytes (`public/landmarks/times-square/lod1.glb`)
- L2: 900 triangles, 18016 bytes (`public/landmarks/times-square/lod2.glb`)
- L3: 434 triangles, 10632 bytes (`public/landmarks/times-square/lod3.glb`)

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
