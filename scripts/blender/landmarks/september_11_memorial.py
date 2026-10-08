"""9/11 Memorial: the memorial archetype. Two square reflecting pools set into a plaza among
plain trees: light inner walls, dark water, a darker central void, a dark parapet. Muted and
still (CLAUDE.md): no emissive (the build fails if anything glows), no animation, no names or
other text. Muted roles only: grey stone, dark water, dark bronze, plain greens.

No S07a frame yet (S07b): it builds at the origin, pools along north-south, on the land top;
chunk 4 places it. Numbers (all estimates) from
data/landmarks/measurements/september-11-memorial.json, at real scale.
"""

from archetypes import memorial
from cclib import inputs

ARCHETYPE = memorial
#: perf.json has no memorial caps: it is budgeted as a building (as the GLB test checks).
CATEGORY = "building"
#: Nothing on a memorial may glow (checked by build.py).
MUTED = True

PLAZA_HEIGHT_M = 1.6


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    spacing = m["poolSpacingM"]["valueM"] * w
    side = m["poolM"]["valueM"] * w
    tree = m["treeM"]["valueM"] * h
    plaza_h = PLAZA_HEIGHT_M * h
    if abs(plaza_h + tree - m["heightM"]["valueM"] * h) > 0.01:
        raise ValueError("the plaza and trees must reach the measured height")
    return {
        "id": data["id"],
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "width": m["plaza"]["widthM"] * w,
        "depth": m["plaza"]["depthM"] * w,
        "plaza_height": plaza_h,
        "pool": {"side": side, "centres": [-spacing / 2, spacing / 2], "floor": 0.3 * h, "wall": 1.2 * w,
                 "void": m["voidM"]["valueM"] * w, "parapet": 1.2 * w},
        "trees": {"spacing": 11.0 * w, "margin": 6.0 * w, "height": tree, "trunk": 0.45 * w, "crown": 3.6 * w},
        "plaza": "granite",
        "walls": "granite",
        "water": "glass",
        "void_role": "steel-dark",
        "parapet_role": "steel-dark",
        "foliage_role": "foliage",
        "trunk_role": "wood-plank",
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0}
