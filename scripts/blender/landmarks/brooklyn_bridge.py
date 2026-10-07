"""Brooklyn Bridge: the suspension archetype dressed from the bridge's own measurements.

Placement is the game's: the deck runs end to end along the LION frame (frames.derived.json
spanM) and the towers stand at models.json `towers.offsetsM` from its anchor, which put them
486 m apart, the real main span. Every height and section comes from
data/landmarks/measurements/brooklyn-bridge.json; thin members are widened by its
readabilityScale so they read at game distance.
"""

from archetypes import suspension
from cclib import inputs

ARCHETYPE = suspension
CATEGORY = "bridge"


def spec(data):
    m = data["measurements"]["dimensions"]
    read = data["measurements"]["readabilityScale"]
    frame = data["frame"]
    towers = data["model"]["params"]["towers"]["offsetsM"]
    if abs((towers[1] - towers[0]) - m["mainSpanM"]["valueM"]) > 0.01 * m["mainSpanM"]["valueM"]:
        raise ValueError("models.json tower offsets are not the measured main span apart")
    road = m["roadwayAtTowersM"]["valueM"]
    top = m["towerHeightM"]["valueM"]
    side = m["sideSpanM"]["valueM"]
    deck_width = m["deckWidthM"]["valueM"]
    cable = m["mainCables"]
    half = frame["spanM"] / 2.0
    outer_x = deck_width / 2 - 0.5
    promenade_width = 5.2
    inner_x = promenade_width / 2 + 0.6 + 0.4
    suspender_width = m["suspenders"]["diameterM"] * read["suspender"]
    anchorages = [towers[0] - side, towers[1] + side]
    depth = m["anchorage"]["depthM"]
    if anchorages[0] - depth <= -half or anchorages[1] + depth >= half:
        raise ValueError("the anchorages must stand between the bridge ends")
    return {
        "id": data["id"],
        "half": half,
        "land_top": inputs.land_top_y(data["scene"]),
        "towers": towers,
        "tower": {
            "water": (m["towerAtWater"]["widthM"], m["towerAtWater"]["depthM"]),
            "road": (m["towerAtRoadway"]["widthM"], m["towerAtRoadway"]["depthM"]),
            "cornice": (m["towerAtCornice"]["widthM"], m["towerAtCornice"]["depthM"]),
            "top": top,
            "cornice_base": m["corniceBaseM"]["valueM"],
            "arch_span": m["archSpanM"]["valueM"],
            "arch_radius": m["archRadiusM"]["valueM"],
            "arch_apex": road + m["archApexAboveRoadwayM"]["valueM"],
            "openings": 2,
            "plinth_h": 3.0,
        },
        "deck": {
            "width": deck_width,
            "road_at_towers": road,
            "mid": m["midspanClearanceM"]["valueM"],
            "thickness": 2.6,
            "promenade": {"width": promenade_width, "height": m["promenadeAboveDeckM"]["valueM"]},
        },
        "cables": {
            "xs": [-outer_x, -inner_x, inner_x, outer_x],
            "radius": cable["diameterM"] * read["mainCable"] / 2,
            "saddle_z": m["corniceBaseM"]["valueM"] - 1.5,
            "low_above_deck": 2.4,
            "side_sag": 0.035,
        },
        "anchorage": {
            "s": anchorages,
            "width": m["anchorage"]["widthM"],
            "depth": m["anchorage"]["depthM"],
        },
        "suspender": {
            # The real ropes hang every 2.3 m per cable; drawn sparser so the web stays legible.
            "spacing": 9.0,
            "width": suspender_width,
        },
        "stay": {
            "count": 9,
            "width": suspender_width,
            "reach_main": 0.34 * m["mainSpanM"]["valueM"],
            "reach_side": 0.6 * side,
        },
        "lamp": {"spacing": 22.0, "post": 0.12 * read["lamp"], "head": 0.3 * read["lamp"], "height": 3.4},
    }
