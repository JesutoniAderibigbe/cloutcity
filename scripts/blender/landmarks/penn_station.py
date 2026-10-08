"""Penn Station: generic entrance pavilions and a concourse canopy only (LEGAL-1 / S07 plan:
no signage, no recreation of the arena above). The station archetype's concourse without a
hall. Numbers (all estimates) from data/landmarks/measurements/penn-station.json at its
`gameScale`, within the frame's exclusion.
"""

from archetypes import station
from cclib import inputs

ARCHETYPE = station
CATEGORY = "station"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    pav_w, pav_d = m["pavilion"]["widthM"] * w, m["pavilion"]["depthM"] * w
    spacing = m["pavilionSpacingM"]["valueM"] * w
    length, width = m["canopy"]["widthM"] * w, m["canopy"]["depthM"] * w
    ex = data["frame"]["exclusion"]
    long_side, short_side = 2 * max(ex["halfLengthM"], ex["halfWidthM"]), 2 * min(ex["halfLengthM"], ex["halfWidthM"])
    if max(spacing + pav_w, length) > long_side or width + pav_d > short_side:
        raise ValueError("the station is larger than the frame's exclusion")
    return {
        "id": data["id"],
        "kind": "concourse",
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "canopy": {"length": length, "width": width, "height": m["canopyM"]["valueM"] * h, "thickness": 1.5 * h,
                   "supports": 4},
        "pavilions": {"count": 2, "width": pav_w, "depth": pav_d, "height": m["pavilionM"]["valueM"] * h,
                      "spacing": spacing},
        "body": "stone",
        "trim": "stone",
        "canopy_role": "steel",
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0}
