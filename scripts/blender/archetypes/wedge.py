"""Wedge archetype: plain triangular massing, a truncated prow at the front, on a low podium,
with window bands. Nothing more: no cornice, no ornament (LEGAL-1 massing only).

Blender coordinates (z up), the footprint centred on the origin, the prow facing +y (the
game's -z, the model's front), standing on `land_top`. `spec`: length, base_width, prow_width,
height, podium {height, outset}, rows, detail.
"""

from archetypes import facade, setback
from cclib import env

LEVELS = {
    0: {"chamfer": True, "rows": 1.0, "podium": True},
    1: {"chamfer": False, "rows": 0.6, "podium": True},
    2: {"chamfer": False, "rows": 0.4, "podium": True},
    3: {"chamfer": False, "rows": 0.25, "podium": False},
}


def outline(length, base_width, prow_width, grow=0.0):
    """The wedge's plan, counter-clockwise: the wide back at -y, the prow at +y."""
    hl, hb, hp = length / 2 + grow, base_width / 2 + grow, prow_width / 2 + grow
    return [(-hb, -hl), (hb, -hl), (hp, hl), (-hp, hl)]


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    k = spec["detail"]
    lit = env.seeded_rng(spec["id"], "windows-L%d" % level)
    z0 = spec["land_top"]
    plan = outline(spec["length"], spec["base_width"], spec["prow_width"])
    podium = spec["podium"]
    if flags["podium"]:
        grown = outline(spec["length"], spec["base_width"], spec["prow_width"], podium["outset"])
        builder.add(setback.extrude(grown, z0, z0 + podium["height"]), spec["podium_role"], tone=0.94)
    builder.add(setback.extrude(plan, z0, z0 + spec["height"]), spec["body"],
                chamfer_dim=spec["prow_width"] * 4 if flags["chamfer"] else None)
    # At most one band per storey: a masonry block with punched windows, not a glass tower.
    rows = min(spec["rows"], int(round(spec["rows"] * flags["rows"] * density)))
    pitch = spec["column_pitch"] / max(min(flags["rows"] * density, 1.0), 0.2)
    facade.window_bands(builder, plan, z0 + podium["height"] + 1.0 * k, z0 + spec["height"] - 1.5 * k, rows,
                        0.1 * spec["base_width"], lit, share=0.45, column_pitch=pitch)
    return builder
