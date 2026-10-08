"""Queens Borough Hall: the civic archetype without a cupola. One long brick block of four
storeys on a stone base, a stone cornice and parapet, a low roof, and a central stone portico
with a balustrade and steps (LEGAL-1: no seals, signage or text).

Numbers come from data/landmarks/measurements/queens-borough-hall.json at its `gameScale`; the
plan must fit the frame's exclusion.
"""

from archetypes import civic
from cclib import inputs

ARCHETYPE = civic
CATEGORY = "government"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    p = 1.0 if true_scale else game["plan"]
    v = lambda key: m[key]["valueM"]  # noqa: E731
    if abs(v("wallM") + v("atticM") + v("roofM") - v("heightM")) > 0.01:
        raise ValueError("the wall, parapet and roof must add up to the measured height")
    width, block_d = m["block"]["widthM"] * p, m["block"]["depthM"] * p
    portico_d, steps = m["portico"]["depthM"] * p, v("stepsM") * p
    depth = block_d + portico_d + steps
    ex = data["frame"]["exclusion"]
    if width > 2 * ex["halfWidthM"] or depth > 2 * ex["halfLengthM"]:
        raise ValueError("the plan is larger than the frame's exclusion")
    back = -depth / 2
    return {
        "id": data["id"],
        "detail": (h * p) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "roles": {"body": "brick", "trim": "stone", "roof": "steel", "dome": "stone", "paving": "granite"},
        "apron": {"w": 2 * ex["halfWidthM"] - 2.0, "d": 2 * ex["halfLengthM"] - 2.0},
        "column_pitch": width / m["windowColumns"]["count"],
        "blocks": [{"cx": 0.0, "cy": back + block_d / 2, "w": width, "d": block_d, "h": v("wallM") * h,
                    "rows": m["storeys"]["count"], "base": v("basementM") * h, "attic": v("atticM") * h,
                    "roof_h": v("roofM") * h}],
        "portico": {"cx": 0.0, "w": m["portico"]["widthM"] * p, "back": back + block_d, "depth": portico_d,
                    "h": v("porticoM") * h, "columns": m["porticoColumns"]["count"], "pediment": 0.0,
                    "balustrade": v("atticM") * h, "steps": steps, "steps_h": v("basementM") * h * 0.5},
        "cupola": None,
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 250.0}
