"""Fifth Avenue wedge ("wedge-building", a generic label): plain massing only (LEGAL-1: no
cornice, no ornament that recreates the claimed design, no signage). The wedge archetype: a
triangular block with a truncated prow at the front, on a low podium, with window bands.

Numbers come from data/landmarks/measurements/wedge-building.json at its `gameScale`; the plan
must fit the frame's exclusion.
"""

from archetypes import wedge
from cclib import inputs

ARCHETYPE = wedge
CATEGORY = "building"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    length = m["lengthM"]["valueM"] * w
    base = m["baseWidthM"]["valueM"] * w
    ex = data["frame"]["exclusion"]
    if length > 2 * max(ex["halfLengthM"], ex["halfWidthM"]) or base > 2 * min(ex["halfLengthM"], ex["halfWidthM"]):
        raise ValueError("the plan is larger than the frame's exclusion")
    height = m["heightM"]["valueM"] * h
    return {
        "id": data["id"],
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "length": length,
        "base_width": base,
        "prow_width": m["prowWidthM"]["valueM"] * w,
        "height": height,
        "podium": {"height": m["podiumM"]["valueM"] * h, "outset": 0.6 * w},
        # One window band per storey at full density.
        "rows": m["floors"]["count"],
        # Punched windows about this far apart along each wall at full density.
        "column_pitch": 4.5 * w,
        "body": "stone",
        "podium_role": "stone",
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0}
