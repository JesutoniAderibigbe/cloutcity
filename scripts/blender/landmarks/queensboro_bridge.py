"""Queensboro Bridge: the cantilever archetype over five real spans (shore, river, island,
river, shore), steel towers with finials over the four masonry piers, truss walls whose depth
peaks over the towers.

Placement: the two island piers stand at models.json `piers.offsetsM` (fitted to Roosevelt
Island on the LION frame); the river and shore spans then take their real lengths from
data/landmarks/measurements/queensboro-bridge.json. Heights and sections are at its
`gameScale`; `true_scale` builds the real proportions for comparison.
"""

from archetypes import cantilever
from cclib import inputs

ARCHETYPE = cantilever
CATEGORY = "bridge"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    read = data["measurements"]["readabilityScale"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    frame = data["frame"]
    half = frame["spanM"] / 2.0
    piers = data["model"]["params"]["piers"]["offsetsM"]
    island_w, island_e = piers[1], piers[2]
    if abs((island_e - island_w) - m["islandSpanM"]["valueM"]) > 0.02 * m["islandSpanM"]["valueM"]:
        raise ValueError("models.json island piers are not the measured island span apart")
    tower_w = island_w - m["riverSpanWestM"]["valueM"]
    tower_e = island_e + m["riverSpanEastM"]["valueM"]
    anchor_w = tower_w - m["shoreSpanWestM"]["valueM"]
    anchor_e = tower_e + m["shoreSpanEastM"]["valueM"]
    if anchor_w <= -half or anchor_e >= half:
        raise ValueError("the anchor piers must stand between the bridge ends")
    deck_width = m["deckWidthM"]["valueM"] * w
    if deck_width > 2 * frame["exclusion"]["halfWidthM"]:
        raise ValueError("the deck is wider than the frame's exclusion")
    peak = m["trussDepthAtTowersM"]["valueM"] * h
    low = m["trussDepthMidM"]["valueM"] * h
    k = (h * w) ** 0.5
    chord = 0.9 * read["chord"] * w

    def support(s, kind):
        return {"s": s, "kind": kind, "chord": peak if kind == "tower" else low}

    return {
        "id": data["id"],
        "detail": k,
        "half": half,
        "land_top": inputs.land_top_y(data["scene"]),
        "supports": [support(anchor_w, "anchor"), support(tower_w, "tower"), support(island_w, "tower"),
                     support(island_e, "tower"), support(tower_e, "tower"), support(anchor_e, "anchor")],
        "mid_chord": low,
        "deck": {"width": deck_width, "height": m["deckClearanceM"]["valueM"] * h, "thickness": 4.0 * h},
        "truss": {
            "xs": [-(deck_width / 2 - chord / 2), deck_width / 2 - chord / 2],
            "chord": chord,
            "member": 0.35 * read["member"] * w,
            "panel": 22.0,
        },
        "pier": {"plan": (m["pier"]["widthM"] * w, m["pier"]["depthM"] * w), "top": m["pierTopM"]["valueM"] * h},
        "tower": {"leg": (m["towerLeg"]["widthM"] * w, m["towerLeg"]["depthM"] * w), "finial": m["finialM"]["valueM"] * h},
        "lamp": {"head": 0.3 * read["lamp"] * w, "necklace_spacing": 26.0},
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["towerHeightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    """Preview land along the axis: Manhattan, Roosevelt Island between its piers, Queens."""
    s = [support["s"] for support in spec["supports"]]
    return {"land": [[-1e9, s[1] + 30.0], [s[2] - 40.0, s[3] + 40.0], [s[4] - 30.0, 1e9]], "focus": s[2]}
