"""Manhattan Bridge: the suspension archetype with steel towers on masonry piers, a deep
stiffening-truss deck (no promenade, no stays) and four cables over the four truss lines.

Placement is the game's: the deck runs along the LION frame and the towers stand at models.json
`towers.offsetsM` (451 m apart, the real main span). Heights and sections come from
data/landmarks/measurements/manhattan-bridge.json at its `gameScale`; `true_scale` builds the
real proportions for comparison.
"""

from archetypes import suspension
from cclib import inputs

ARCHETYPE = suspension
CATEGORY = "bridge"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    read = data["measurements"]["readabilityScale"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    frame = data["frame"]
    towers = data["model"]["params"]["towers"]["offsetsM"]
    if abs((towers[1] - towers[0]) - m["mainSpanM"]["valueM"]) > 0.01 * m["mainSpanM"]["valueM"]:
        raise ValueError("models.json tower offsets are not the measured main span apart")
    half = frame["spanM"] / 2.0
    deck_width = m["deckWidthM"]["valueM"] * w
    if deck_width > 2 * frame["exclusion"]["halfWidthM"]:
        raise ValueError("the deck is wider than the frame's exclusion")
    side = m["sideSpanM"]["valueM"]
    anchorages = [towers[0] - side, towers[1] + side]
    depth = m["anchorage"]["depthM"] * w
    if anchorages[0] - depth <= -half or anchorages[1] + depth >= half:
        raise ValueError("the anchorages must stand between the bridge ends")
    deck_z = m["midspanClearanceM"]["valueM"] * h
    top = m["towerHeightM"]["valueM"] * h
    crown = m["crownM"]["valueM"] * h
    leg = (m["towerLeg"]["widthM"] * w, m["towerLeg"]["depthM"] * w)
    half_w = deck_width / 2
    suspender = 0.06 * read["suspender"] * w
    lamp_head = 0.3 * read["lamp"] * w
    return {
        "id": data["id"],
        "metal": "steel",
        "detail": (h * w) ** 0.5,
        "half": half,
        "land_top": inputs.land_top_y(data["scene"]),
        "towers": towers,
        "tower": {
            "style": "steel",
            "pier": (m["towerPier"]["widthM"] * w, m["towerPier"]["depthM"] * w),
            "pier_top": m["pierTopM"]["valueM"] * h,
            "width": deck_width + 2 * leg[0] + 2.0 * w,
            "leg": leg,
            "top": top,
            "crown": crown,
            # The steel towers' depth along the axis, for keeping hangers clear of them.
            "road": (deck_width, leg[1]),
        },
        "deck": {
            "width": deck_width,
            # The deck is close to level: at the towers it is the mid-span height.
            "road_at_towers": deck_z,
            "mid": deck_z,
            "thickness": m["trussDepthM"]["valueM"] * h,
            "truss_top": 2.0,
            "panel": 18.0,
            "promenade": None,
        },
        "cables": {
            "xs": [-(half_w - 0.6 * w), -0.27 * deck_width, 0.27 * deck_width, half_w - 0.6 * w],
            "radius": m["mainCables"]["diameterM"] * read["mainCable"] * w / 2,
            "saddle_z": top - crown - 2.0 * h,
            "low_above_deck": 2.4 * h,
            "side_sag": 0.04,
        },
        "anchorage": {"s": anchorages, "width": m["anchorage"]["widthM"] * w, "depth": depth},
        "suspender": {"spacing": 10.0, "width": suspender},
        "stay": None,
        "lamp": {"spacing": 24.0, "post": 0.12 * read["lamp"] * w, "head": lamp_head, "height": 3.4 * h,
                 "necklace_spacing": 22.0},
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["towerHeightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]
