"""Brooklyn Bridge: the suspension archetype dressed from the bridge's own measurements.

Placement is the game's: the deck runs end to end along the LION frame (frames.derived.json
spanM) and the towers stand at models.json `towers.offsetsM` from its anchor, which put them
486 m apart, the real main span. Every height and section comes from
data/landmarks/measurements/brooklyn-bridge.json, multiplied by its `gameScale` (heights and
widths; lengths along the axis stay real) so the bridge reads at game distance; thin members are
widened further by its readabilityScale. `true_scale` builds the real proportions for comparison.
"""

import math

from archetypes import suspension
from cclib import inputs

ARCHETYPE = suspension
CATEGORY = "bridge"


def spec(data, true_scale=False):
    """Archetype parameters; game scale (measurements `gameScale`) unless true_scale."""
    m = data["measurements"]["dimensions"]
    read = data["measurements"]["readabilityScale"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    frame = data["frame"]
    towers = data["model"]["params"]["towers"]["offsetsM"]
    if abs((towers[1] - towers[0]) - m["mainSpanM"]["valueM"]) > 0.01 * m["mainSpanM"]["valueM"]:
        raise ValueError("models.json tower offsets are not the measured main span apart")
    road = m["roadwayAtTowersM"]["valueM"] * h
    top = m["towerHeightM"]["valueM"] * h
    side = m["sideSpanM"]["valueM"]
    deck_width = m["deckWidthM"]["valueM"] * w
    cable = m["mainCables"]
    half = frame["spanM"] / 2.0
    outer_x = deck_width / 2 - 0.5 * w
    promenade_width = 5.2 * w
    inner_x = promenade_width / 2 + 1.0 * w
    suspender_width = m["suspenders"]["diameterM"] * read["suspender"] * w
    anchorages = [towers[0] - side, towers[1] + side]
    depth = m["anchorage"]["depthM"] * w
    if anchorages[0] - depth <= -half or anchorages[1] + depth >= half:
        raise ValueError("the anchorages must stand between the bridge ends")
    # The pointed arch keeps its real rise-to-span shape under the two scales: span x w, rise x h.
    span_real = m["archSpanM"]["valueM"]
    radius_real = m["archRadiusM"]["valueM"]
    rise = math.sqrt(radius_real ** 2 - (radius_real - span_real / 2) ** 2) * h
    span = span_real * w
    radius = (rise ** 2 + span ** 2 / 4) / span
    section = lambda key: (m[key]["widthM"] * w, m[key]["depthM"] * w)  # noqa: E731
    return {
        "id": data["id"],
        # Trims, bands and railings (real metres in the archetype) grow with the section.
        "detail": math.sqrt(h * w),
        "half": half,
        "land_top": inputs.land_top_y(data["scene"]),
        "towers": towers,
        "tower": {
            "water": section("towerAtWater"),
            "road": section("towerAtRoadway"),
            "cornice": section("towerAtCornice"),
            "top": top,
            "cornice_base": m["corniceBaseM"]["valueM"] * h,
            "arch_span": span,
            "arch_radius": radius,
            "arch_apex": road + m["archApexAboveRoadwayM"]["valueM"] * h,
            "openings": 2,
            "plinth_h": 3.0 * h,
        },
        "deck": {
            "width": deck_width,
            "road_at_towers": road,
            "mid": m["midspanClearanceM"]["valueM"] * h,
            "thickness": 2.6 * h,
            "promenade": {"width": promenade_width, "height": m["promenadeAboveDeckM"]["valueM"] * h},
        },
        "cables": {
            "xs": [-outer_x, -inner_x, inner_x, outer_x],
            "radius": cable["diameterM"] * read["mainCable"] * w / 2,
            "saddle_z": (m["corniceBaseM"]["valueM"] - 1.5) * h,
            "low_above_deck": 2.4 * h,
            "side_sag": 0.035,
        },
        "anchorage": {
            "s": anchorages,
            "width": m["anchorage"]["widthM"] * w,
            "depth": depth,
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
        "lamp": {
            "spacing": 22.0,
            "post": 0.12 * read["lamp"] * w,
            "head": 0.3 * read["lamp"] * w,
            "height": 3.4 * h,
            # The necklace lights on the main cables, drawn sparser than the real string.
            "necklace_spacing": 24.0,
        },
    }


def expected_height(data, true_scale=False):
    """The model's top above the water: the measured tower height, at game scale unless true."""
    real = data["measurements"]["dimensions"]["towerHeightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]
