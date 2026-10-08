"""Staten Island Ferry (St. George terminal): the station archetype's concourse: a long terminal hall with window bands, a canopy along its front and three entrance pavilions. Generic and sign-free (LEGAL-1).
Numbers (all estimates) from data/landmarks/measurements/staten-island-ferry.json at its `gameScale`, within
the frame's exclusion.
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
    hall_w, hall_d = m["hall"]["widthM"] * w, m["hall"]["depthM"] * w
    pav_w, pav_d = m["pavilion"]["widthM"] * w, m["pavilion"]["depthM"] * w
    spacing = m["pavilionSpacingM"]["valueM"] * w
    length, width = m["canopy"]["widthM"] * w, m["canopy"]["depthM"] * w
    ex = data["frame"]["exclusion"]
    long_side, short_side = 2 * max(ex["halfLengthM"], ex["halfWidthM"]), 2 * min(ex["halfLengthM"], ex["halfWidthM"])
    if max(hall_w, length, spacing * (3 - 1) + pav_w) > long_side or hall_d + width + pav_d > short_side:
        raise ValueError("the station is larger than the frame's exclusion")
    return {
        "id": data["id"],
        "kind": "concourse",
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "hall": {"width": hall_w, "depth": hall_d, "height": m["heightM"]["valueM"] * h, "rows": m["hallFloors"]["count"]},
        "canopy": {"length": length, "width": width, "height": m["canopyM"]["valueM"] * h, "thickness": 1.3 * h,
                   "supports": 6},
        "pavilions": {"count": 3, "width": pav_w, "depth": pav_d, "height": m["pavilionM"]["valueM"] * h,
                      "spacing": spacing},
        "window_pitch": 4.5 * w,
        "body": "stone",
        "trim": "stone",
        "canopy_role": "steel",
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0}
