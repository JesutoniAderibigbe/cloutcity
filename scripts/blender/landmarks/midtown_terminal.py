"""42nd Street terminal ("midtown-terminal", a generic label): plain massing (LEGAL-1: no
sculpture group, no clock, no signage). The station archetype's terminal: a main hall with
three tall arched front windows, lower side wings, a low hipped roof. Numbers (all estimates)
from data/landmarks/measurements/midtown-terminal.json at its `gameScale`.
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
    wing_w = m["wings"]["widthM"] * w
    ex = data["frame"]["exclusion"]
    long_side, short_side = 2 * max(ex["halfLengthM"], ex["halfWidthM"]), 2 * min(ex["halfLengthM"], ex["halfWidthM"])
    if hall_w + 2 * wing_w > long_side or hall_d > short_side:
        raise ValueError("the terminal is larger than the frame's exclusion")
    return {
        "id": data["id"],
        "kind": "terminal",
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "hall": {"width": hall_w, "depth": hall_d, "height": m["hallM"]["valueM"] * h, "rows": 6},
        "wings": {"width": wing_w, "depth": m["wings"]["depthM"] * w, "height": m["wingsM"]["valueM"] * h, "rows": 5},
        "roof": (m["heightM"]["valueM"] - m["hallM"]["valueM"]) * h,
        "arches": {"count": 3, "width": m["arches"]["widthM"] * w, "height": m["arches"]["depthM"] * h},
        "window_pitch": 5.0 * w,
        "body": "stone",
        "trim": "stone",
        "roof_role": "roof",
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0}
