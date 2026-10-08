"""Memorial archetype: a raised plaza with two square reflecting pools set into it, each with
light inner walls (the falling water), a dark water surface, a darker central void and a low
dark bronze parapet, among a grid of plain trees. Muted and still: no emissive, no animation,
no text (the parapet carries no names here). The game's memorial rules (CLAUDE.md) apply.

Blender coordinates (z up), centred on the origin, the pools along y, on `land_top`. The
game's land is a solid slab, so the pools are cut into a plaza raised above it rather than
sunk below the land top.
"""

import math

from cclib import prim

LEVELS = {
    0: {"trees": 1.0, "parapet": True, "void": True, "walls": True, "tree_sides": 5},
    1: {"trees": 0.5, "parapet": True, "void": True, "walls": True, "tree_sides": 4},
    2: {"trees": 0.22, "parapet": False, "void": True, "walls": True, "tree_sides": 3},
    3: {"trees": 0.06, "parapet": False, "void": False, "walls": False, "tree_sides": 3},
}

WALL_TONE = 1.0
WATER_TONE = 0.55
VOID_TONE = 0.35


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    k = spec["detail"]
    z0 = spec["land_top"]
    top = z0 + spec["plaza_height"]
    half_w, half_d = spec["width"] / 2, spec["depth"] / 2
    pool = spec["pool"]
    p = pool["side"] / 2
    centres = pool["centres"]
    # The plaza: strips around the two pool holes.
    ys = sorted([-half_d] + [c + s * p for c in centres for s in (-1, 1)] + [half_d])
    builder.add(prim.box(-half_w, -p, -half_d, half_d, z0, top), spec["plaza"], tone=0.95)
    builder.add(prim.box(p, half_w, -half_d, half_d, z0, top), spec["plaza"], tone=0.95)
    for y0, y1 in zip(ys[0::2], ys[1::2]):
        builder.add(prim.box(-p, p, y0, y1, z0, top), spec["plaza"], tone=0.95)
    floor = z0 + pool["floor"]
    wall = pool["wall"]
    for cy in centres:
        # The water surface, then the light inner walls the water falls down.
        builder.add(prim.box(-p, p, cy - p, cy + p, z0, floor), spec["water"], tone=WATER_TONE, jitter=False)
        walls = ((-p, p, cy - p, cy - p + wall), (-p, p, cy + p - wall, cy + p),
                 (-p, -p + wall, cy - p, cy + p), (p - wall, p, cy - p, cy + p))
        for x0, x1, y0, y1 in walls if flags["walls"] else ():
            builder.add(prim.box(x0, x1, y0, y1, floor, top - 0.05 * k), spec["walls"], tone=WALL_TONE)
        if flags["void"]:
            v = pool["void"] / 2
            builder.add(prim.box(-v, v, cy - v, cy + v, floor, floor + 0.08 * k), spec["void_role"], tone=VOID_TONE,
                        jitter=False)
        if flags["parapet"]:
            o, t = pool["parapet"], 0.9 * k
            for x0, x1, y0, y1 in ((-p - o, p + o, cy - p - o, cy - p), (-p - o, p + o, cy + p, cy + p + o),
                                   (-p - o, -p, cy - p, cy + p), (p, p + o, cy - p, cy + p)):
                builder.add(prim.box(x0, x1, y0, y1, top, top + t), spec["parapet_role"], tone=0.8)
    _trees(spec, top, flags, density, builder)
    return builder


def _trees(spec, top, flags, density, builder):
    t = spec["trees"]
    spacing = t["spacing"] / max(flags["trees"] * density, 1e-3) ** 0.5 if flags["trees"] > 0 else None
    if spacing is None:
        return
    half_w, half_d = spec["width"] / 2 - t["margin"], spec["depth"] / 2 - t["margin"]
    p = spec["pool"]["side"] / 2 + spec["pool"]["parapet"] + t["margin"]
    sides = flags["tree_sides"]
    nx, ny = int(2 * half_w / spacing), int(2 * half_d / spacing)
    for i in range(nx + 1):
        for j in range(ny + 1):
            x = -half_w + i * (2 * half_w / max(nx, 1))
            y = -half_d + j * (2 * half_d / max(ny, 1))
            if any(abs(x) < p and abs(y - c) < p for c in spec["pool"]["centres"]):
                continue
            trunk = t["height"] * 0.35
            builder.add(_cone(x, y, top, top + trunk, t["trunk"], t["trunk"] * 0.7, 3), spec["trunk_role"],
                        tone=0.8, jitter=False)
            builder.add(_cone(x, y, top + trunk * 0.8, top + t["height"], t["crown"], t["crown"] * 0.55, sides),
                        spec["foliage_role"], tone=0.82)


def _cone(x, y, z0, z1, r0, r1, sides):
    ring = lambda r, z: [(x + r * math.cos(2 * math.pi * i / sides), y + r * math.sin(2 * math.pi * i / sides), z)  # noqa: E731
                         for i in range(sides)]
    verts = ring(r0, z0) + ring(r1, z1)
    faces = [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
    faces += [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    return prim.from_faces(verts, faces)
