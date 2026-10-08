"""Washington Square Arch: the triumphal arch archetype in white marble. Plain: no figures,
no inscription. No S07a frame yet (S07b): it builds at the origin with its faces north and
south on the land top. Numbers from data/landmarks/measurements/washington-square-arch.json
(all estimates; see their notes) at its `gameScale`.
"""

from archetypes import arch
from cclib import inputs

ARCHETYPE = arch
#: perf.json has no monument caps yet: it is budgeted as a building.
CATEGORY = "building"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    return {
        "id": data["id"],
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "width": m["widthM"]["valueM"] * w,
        "depth": m["depthM"]["valueM"] * w,
        "height": m["heightM"]["valueM"] * h,
        "opening": {"width": m["openingM"]["widthM"] * w, "height": m["openingM"]["depthM"] * h},
        "plinth": 1.0 * h,
        "entablature": 1.6 * h,
        "attic": m["atticM"]["valueM"] * h,
        "role": "stone",
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0}
