"""Brooklyn Borough Hall: the civic archetype. One Greek Revival block on a tall raised
basement, a cornice and parapet, a low hipped roof, a hexastyle portico with a pediment at the
top of a tall flight of steps, and the cupola on the roof (a plain square stage, a colonnaded
drum, a dome, a lantern and a needle: LEGAL-1, no figures, dials or text).

Numbers come from data/landmarks/measurements/brooklyn-borough-hall.json at its `gameScale`;
the plan must fit the frame's exclusion, and the needle takes the height left to the top.
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
    k = (h * p) ** 0.5
    v = lambda key: m[key]["valueM"]  # noqa: E731
    width, block_d = m["block"]["widthM"] * p, m["block"]["depthM"] * p
    portico_d, steps = m["portico"]["depthM"] * p, v("stepsM") * p
    depth = block_d + portico_d + steps
    ex = data["frame"]["exclusion"]
    if width > 2 * ex["halfWidthM"] or depth > 2 * ex["halfLengthM"]:
        raise ValueError("the plan is larger than the frame's exclusion")
    back = -depth / 2
    land_top = inputs.land_top_y(data["scene"])
    out = {
        "id": data["id"],
        "detail": k,
        "land_top": land_top,
        "roles": {"body": "stone", "trim": "stone", "roof": "steel", "dome": "stone", "paving": "granite"},
        "apron": {"w": 2 * ex["halfWidthM"] - 2.0, "d": 2 * ex["halfLengthM"] - 2.0},
        "column_pitch": 4.5 * p,
        "blocks": [{"cx": 0.0, "cy": back + block_d / 2, "w": width, "d": block_d, "h": v("wallM") * h,
                    "rows": m["storeys"]["count"], "base": v("basementM") * h, "attic": v("atticM") * h,
                    "roof_h": v("roofM") * h}],
        "portico": {"cx": 0.0, "w": m["portico"]["widthM"] * p, "back": back + block_d, "depth": portico_d,
                    "h": v("porticoM") * h, "columns": m["porticoColumns"]["count"], "pediment": v("pedimentM") * h,
                    "steps": steps, "steps_h": v("basementM") * h},
        "cupola": {
            "on": 0,
            "seat": 1.0 * h,
            "base": {"sides": 4, "r": v("cupolaBaseWidthM") * k / 2 * 2 ** 0.5, "h": v("cupolaBaseM") * h},
            "drum": {"sides": 8, "r": v("cupolaDrumDiameterM") * k / 2, "h": v("cupolaDrumM") * h},
            "dome": {"r": v("cupolaDrumDiameterM") * k / 2, "h": v("cupolaDomeM") * h},
            "lantern": {"r": 1.4 * k, "h": v("lanternM") * h},
            "finial": 0.0,
        },
    }
    finial = land_top + expected_height(data, true_scale) - civic.cupola_top(out)
    if finial <= 0:
        raise ValueError("the cupola is taller than the measured height")
    out["cupola"]["finial"] = finial
    return out


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 250.0}
