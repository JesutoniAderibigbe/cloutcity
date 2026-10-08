"""Setback tower archetype: stacked tiers, each inset from the one below, with chamfered
corners, a trim band at each setback, window bands on every wall, topped by a generic tapered
spire (stacked octagonal stages and a needle; never a copy of a real crown, LEGAL-1).

Blender coordinates (z up), the footprint centred on the origin, the front facing +y (the
game's -z), standing on `land_top`. `spec`: width, depth, tiers [{height, inset}], spire
{base, height, stages}, window rows per tier, detail (trim scale).
"""

import math

from archetypes import facade
from cclib import env, prim

LEVELS = {
    0: {"chamfer": True, "corners": True, "bands": True, "rows": 1.0, "fins": 1.0, "spire_sides": 8},
    1: {"chamfer": False, "corners": True, "bands": True, "rows": 0.6, "fins": 0.5, "spire_sides": 8},
    # A building's coarse levels are what mid and low show at the game camera (2-4.5 km).
    2: {"chamfer": False, "corners": True, "bands": True, "rows": 0.5, "fins": 0.3, "spire_sides": 8},
    3: {"chamfer": False, "corners": True, "bands": False, "rows": 0.3, "fins": 0.0, "spire_sides": 6},
}

TRIM_TONE = 1.12
#: Corner cut of each tier, as a share of its smaller side (the Art Deco stepped corner).
CORNER = 0.12


def footprint(w, d, cut):
    """A rectangle w x d with its four corners cut by `cut` (an octagon), counter-clockwise."""
    hw, hd = w / 2, d / 2
    if cut <= 0:
        return [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
    return [(-hw + cut, -hd), (hw - cut, -hd), (hw, -hd + cut), (hw, hd - cut), (hw - cut, hd), (-hw + cut, hd),
            (-hw, hd - cut), (-hw, -hd + cut)]


def extrude(corners, z0, z1):
    """A closed prism over a convex footprint."""
    n = len(corners)
    verts = [(x, y, z0) for x, y in corners] + [(x, y, z1) for x, y in corners]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return prim.from_faces(verts, faces)


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    k = spec["detail"]
    lit = env.seeded_rng(spec["id"], "windows-L%d" % level)
    z = spec["land_top"]
    w, d = spec["width"], spec["depth"]
    for i, tier in enumerate(spec["tiers"]):
        w -= 2 * tier["inset"]
        d -= 2 * tier["inset"]
        cut = CORNER * min(w, d) if flags["corners"] else 0.0
        corners = footprint(w, d, cut)
        top = z + tier["height"]
        builder.add(extrude(corners, z, top), spec["body"], chamfer_dim=min(w, d) if flags["chamfer"] else None)
        rows = int(round(tier["rows"] * flags["rows"] * density))
        facade.window_bands(builder, corners, z + 2.0 * k, top - 3.0 * k, rows, 0.12 * min(w, d), lit)
        fins = int(round(spec["fins"] * flags["fins"] * density))
        facade.fins(builder, corners, z + 1.0 * k, top - 1.6 * k, fins, 0.12 * min(w, d), 0.9 * k, 0.7 * k,
                    spec["body"])
        if flags["bands"]:
            band = 1.6 * k
            grown = footprint(w + 1.2 * k, d + 1.2 * k, cut)
            builder.add(extrude(grown, top - band, top), spec["body"], tone=TRIM_TONE,
                        glow=facade.floodlight(builder))
        z = top
    _spire(spec, z, w, d, flags, builder)
    return builder


def _spire(spec, z, w, d, flags, builder):
    sp = spec["spire"]
    sides = flags["spire_sides"]
    stages = sp["stages"] if flags["spire_sides"] > 4 else 1
    base = min(sp["base"], min(w, d))
    stage_h = sp["height"] * 0.62 / stages
    radius = base / 2
    for i in range(stages):
        top_r = radius * 0.72
        builder.add(cone(z, z + stage_h, radius, top_r, sides), spec["spire_role"], tone=1.0 + 0.04 * i,
                    glow=facade.floodlight(builder) if i == stages - 1 else None)
        z += stage_h
        radius = top_r * 0.86
    needle = sp["height"] * 0.38
    builder.add(cone(z, z + needle, radius * 0.5, 0.0, max(4, sides // 2)), spec["spire_role"], tone=1.1)


def cone(z0, z1, r0, r1, sides):
    """A regular frustum (r1 = 0: a pyramid), its flat sides aligned to the axes."""
    ring = lambda r, z: [(r * math.cos(2 * math.pi * (i + 0.5) / sides),  # noqa: E731
                          r * math.sin(2 * math.pi * (i + 0.5) / sides), z) for i in range(sides)]
    if r1 <= 0:
        verts = ring(r0, z0) + [(0.0, 0.0, z1)]
        faces = [tuple(reversed(range(sides)))] + [(i, (i + 1) % sides, sides) for i in range(sides)]
    else:
        verts = ring(r0, z0) + ring(r1, z1)
        faces = [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
        faces += [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    return prim.from_faces(verts, faces)
