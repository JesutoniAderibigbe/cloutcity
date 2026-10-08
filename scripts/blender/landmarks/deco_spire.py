"""Lexington Avenue Art Deco tower ("deco-spire", a generic label): the setback archetype.
Stepped tiers with cut corners, trim bands and window bands, ending in a generic tapered spire
(LEGAL-1: no copy of the real crown, no ornament that recreates it, no signage).

Heights come from data/landmarks/measurements/deco-spire.json (Wikidata roof and tip; tiers
proportioned), at its `gameScale`; the footprint must fit the frame's exclusion.
"""

from archetypes import setback
from cclib import inputs

ARCHETYPE = setback
CATEGORY = "building"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    width = m["footprint"]["widthM"] * w
    depth = m["footprint"]["depthM"] * w
    ex = data["frame"]["exclusion"]
    if max(width, depth) > 2 * max(ex["halfLengthM"], ex["halfWidthM"]) or min(width, depth) > 2 * min(
            ex["halfLengthM"], ex["halfWidthM"]):
        raise ValueError("the footprint is larger than the frame's exclusion")
    tiers = [("tier1M", 0.0, 9), ("tier2M", 7.0, 10), ("tier3M", 6.0, 8), ("tier4M", 5.0, 6)]
    roof = sum(m[key]["valueM"] for key, _inset, _rows in tiers)
    if abs(roof - m["roofM"]["valueM"]) > 0.5:
        raise ValueError("the tiers must add up to the roof height")
    return {
        "id": data["id"],
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "width": width,
        "depth": depth,
        "tiers": [{"height": m[key]["valueM"] * h, "inset": inset * w, "rows": rows} for key, inset, rows in tiers],
        "spire": {
            "base": m["spireBaseM"]["valueM"] * w,
            "height": (m["heightM"]["valueM"] - m["roofM"]["valueM"]) * h,
            "stages": 3,
        },
        # Vertical piers per wall (at full density): the facade's Art Deco stripes.
        "fins": 5,
        "body": "stone",
        "spire_role": "steel",
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0}
