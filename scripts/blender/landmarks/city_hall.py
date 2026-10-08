"""City Hall (Manhattan): the civic archetype. A C-shaped plan (a centre block between two end
wings that project ahead of it), a raised rusticated basement, a cornice and balustrade over
two storeys, low hipped roofs, a central columned portico with a balustrade and broad steps,
and the cupola (a plain square stage, a colonnaded drum, a dome, a lantern and a needle in
place of the statue: LEGAL-1, no figures, dials or text).

Numbers come from data/landmarks/measurements/city-hall.json at its `gameScale`; the plan
must fit the frame's exclusion, and the needle takes the height left to the measured top.
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
    centre_w, centre_d = m["centreBlock"]["widthM"] * p, m["centreBlock"]["depthM"] * p
    wing_w, wing_proj = m["wing"]["widthM"] * p, m["wing"]["depthM"] * p
    if abs(centre_w + 2 * wing_w - v("lengthM") * p) > 0.05:
        raise ValueError("the centre block and wings must add up to the measured length")
    portico_d, steps = m["portico"]["depthM"] * p, v("stepsM") * p
    depth = centre_d + max(wing_proj, portico_d + steps)
    ex = data["frame"]["exclusion"]
    if v("lengthM") * p > 2 * ex["halfWidthM"] or depth > 2 * ex["halfLengthM"]:
        raise ValueError("the plan is larger than the frame's exclusion")
    back = -depth / 2
    front = back + centre_d
    land_top = inputs.land_top_y(data["scene"])

    def block(cx, w, d):
        return {"cx": cx, "cy": back + d / 2, "w": w, "d": d, "h": v("wallM") * h, "rows": m["storeys"]["count"],
                "base": v("basementM") * h, "attic": v("atticM") * h, "roof_h": v("roofM") * h}

    blocks = [block(0.0, centre_w, centre_d)]
    for side in (-1, 1):
        blocks.append(block(side * (centre_w + wing_w) / 2, wing_w, centre_d + wing_proj))
    out = {
        "id": data["id"],
        "detail": k,
        "land_top": land_top,
        "roles": {"body": "stone", "trim": "stone", "roof": "steel", "dome": "stone", "paving": "granite"},
        "apron": {"w": 2 * ex["halfWidthM"] - 4.0, "d": 2 * ex["halfLengthM"] - 4.0},
        "column_pitch": 4.5 * p,
        "blocks": blocks,
        "portico": {"cx": 0.0, "w": m["portico"]["widthM"] * p, "back": front, "depth": portico_d,
                    "h": v("porticoM") * h, "columns": m["porticoColumns"]["count"], "pediment": 0.0,
                    "balustrade": v("atticM") * h, "steps": steps, "steps_h": v("basementM") * h * 0.6},
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
