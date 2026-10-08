"""Elevated park archetype: a park on a disused rail viaduct. A steel deck on pairs of steel
columns along a route, its edges railed, a paved walk down the middle between planting beds
with low shrubs and small trees (the CC0 trees' leaf green). The walk is lamplit at night, so the
line reads in the dark. No signs or text (LEGAL-1).

Blender coordinates (z up) in map orientation: x east, y north, metres from the landmark's
landmarks.json location, on `land_top`; placed there unturned (heading 0).

`spec`: route [(x, y)] (corners are rounded by `corner_radius`), elevation (deck top above the
land), deck {width, thickness, girder}, columns {spacing, width}, walk width, beds {shrubs,
trees: spacing, height (lo, hi)}, top (the tallest tree's top above the land: the model's top).
"""

import math

from archetypes import park
from cclib import env, loft, prim

LEVELS = {
    0: {"corner_segments": 5, "columns": 1.0, "shrubs": 1.0, "trees": 1.0, "rails": True, "girders": True},
    1: {"corner_segments": 3, "columns": 0.5, "shrubs": 0.4, "trees": 0.6, "rails": True, "girders": True},
    2: {"corner_segments": 2, "columns": 0.2, "shrubs": 0.0, "trees": 0.3, "rails": False, "girders": False},
    3: {"corner_segments": 1, "columns": 0.1, "shrubs": 0.0, "trees": 0.15, "rails": False, "girders": False},
}

WALK_GLOW = 0.3
BED_TONE = 1.05


def rounded(points, radius, segments):
    """The route with each inner corner replaced by an arc of `radius` (`segments` pieces)."""
    out = [points[0]]
    for i in range(1, len(points) - 1):
        (ax, ay), (bx, by), (cx, cy) = points[i - 1], points[i], points[i + 1]
        l0, l1 = math.hypot(bx - ax, by - ay), math.hypot(cx - bx, cy - by)
        u0 = ((bx - ax) / l0, (by - ay) / l0)
        u1 = ((cx - bx) / l1, (cy - by) / l1)
        turn = math.acos(max(-1.0, min(1.0, u0[0] * u1[0] + u0[1] * u1[1])))
        if turn < 1e-3 or segments < 1:
            out.append(points[i])
            continue
        cut = min(radius * math.tan(turn / 2), 0.45 * l0, 0.45 * l1)
        p0 = (bx - u0[0] * cut, by - u0[1] * cut)
        p1 = (bx + u1[0] * cut, by + u1[1] * cut)
        for j in range(segments + 1):
            t = j / segments
            # A quadratic Bezier through the corner: close to the arc at these turns.
            out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * bx + t * t * p1[0],
                        (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * by + t * t * p1[1]))
    out.append(points[-1])
    return out


def stations(route, spacing):
    """Points every `spacing` along the route: [(x, y, unit tangent)]."""
    out = []
    carry = spacing / 2
    for (ax, ay), (bx, by) in zip(route, route[1:]):
        length = math.hypot(bx - ax, by - ay)
        if length < 1e-6:
            continue
        ux, uy = (bx - ax) / length, (by - ay) / length
        t = carry
        while t < length:
            out.append((ax + ux * t, ay + uy * t, (ux, uy)))
            t += spacing
        carry = t - length
    return out


def offset(route, d):
    """The route moved `d` to its left (a polyline offset, mitred at the joints)."""
    out = []
    n = len(route)
    for i in range(n):
        a = route[max(0, i - 1)]
        b = route[min(n - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        length = math.hypot(tx, ty) or 1.0
        out.append((route[i][0] - ty / length * d, route[i][1] + tx / length * d))
    return out


def rect_section(x0, x1, z0, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    rng = env.seeded_rng(spec["id"], "elevated-L%d" % level)
    k = spec["detail"]
    z0 = spec["land_top"]
    top = z0 + spec["elevation"]
    route = rounded(spec["route"], spec["corner_radius"], flags["corner_segments"])
    path3 = [(x, y, 0.0) for x, y in route]
    deck = spec["deck"]
    hw = deck["width"] / 2

    def sweep(section, role, tone=1.0, glow=None):
        builder.add(loft.sweep(path3, section, caps=True), role, tone=tone, glow=glow)

    # The deck slab and, below it, the two steel edge girders (darker: the underside in shadow).
    sweep(rect_section(-hw, hw, top - deck["thickness"], top), "steel-dark", tone=0.9)
    if flags["girders"]:
        g = deck["girder"]
        sweep(rect_section(-hw, -hw + 1.2 * k, top - deck["thickness"] - g, top - deck["thickness"]), "steel-dark",
              tone=0.75)
        sweep(rect_section(hw - 1.2 * k, hw, top - deck["thickness"] - g, top - deck["thickness"]), "steel-dark",
              tone=0.75)
    # Beds either side of the walk, then the walk (lamplit at night), each just proud of the deck.
    walk = spec["walk"] / 2
    sweep(rect_section(-hw + 0.8 * k, hw - 0.8 * k, top, top + 0.25), "lawn", tone=BED_TONE)
    sweep(rect_section(-walk, walk, top, top + 0.4), "stone", tone=0.95,
          glow=builder.colour("lamp", WALK_GLOW))
    if flags["rails"]:
        for side in (-1, 1):
            x0 = side * hw - (0.5 * k if side > 0 else 0.0)
            sweep(rect_section(x0, x0 + 0.5 * k, top, top + 1.4 * k), "steel-dark", tone=0.85)
    # Column pairs under the deck edges.
    cols = spec["columns"]
    spacing = cols["spacing"] / max(flags["columns"] * min(density, 1.5), 0.05)
    cw = cols["width"]
    for x, y, (ux, uy) in stations(route, spacing):
        for side in (-1, 1):
            cx, cy = x - uy * side * (hw - 1.5 * k), y + ux * side * (hw - 1.5 * k)
            builder.add(column_box(cx, cy, z0, top - deck["thickness"], cw, ux, uy), "steel-dark", tone=0.8,
                        jitter=False)
    _plantings(spec, route, flags, density, rng, top, builder)
    return builder


def column_box(cx, cy, z0, z1, w, ux, uy):
    """An open square column turned to the route (its ends hide in the land and the deck)."""
    h = w / 2
    corners = [(cx + (-ux - uy) * h, cy + (-uy + ux) * h), (cx + (ux - uy) * h, cy + (uy + ux) * h),
               (cx + (ux + uy) * h, cy + (uy - ux) * h), (cx + (-ux + uy) * h, cy + (-uy - ux) * h)]
    verts = [(x, y, z0) for x, y in corners] + [(x, y, z1) for x, y in corners]
    faces = [(i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i) for i in range(4)]
    return prim.from_faces(verts, faces)


def _plantings(spec, route, flags, density, rng, top, builder):
    beds = spec["beds"]
    hw = spec["deck"]["width"] / 2
    walk = spec["walk"] / 2
    lane = (walk + hw) / 2
    crowns = []
    if flags["shrubs"] > 0:
        spacing = beds["shrub_spacing"] / max(flags["shrubs"] * density, 0.05)
        for x, y, (ux, uy) in stations(route, spacing):
            side = 1 if rng.random() < 0.5 else -1
            d = side * lane * rng.uniform(0.85, 1.1)
            crowns.append((x - uy * d, y + ux * d, (hw - walk) * 0.38, rng.uniform(0.25, 0.4) * beds["tree_height"][1],
                           5))
    spacing = beds["tree_spacing"] / max(flags["trees"] * density, 0.05)
    for x, y, (ux, uy) in stations(route, spacing):
        side = 1 if rng.random() < 0.5 else -1
        d = side * lane
        crowns.append((x - uy * d, y + ux * d, (hw - walk) * 0.55, rng.uniform(*beds["tree_height"]), 5))
    if not crowns:
        return
    # The tallest crown reaches exactly the model's top (the measured tree height).
    tallest = max(c[3] for c in crowns)
    scale = beds["tree_height"][1] / tallest
    for x, y, r, h, sides in crowns:
        tone = rng.uniform(0.9, 1.12)
        builder.add_toned(park._crown(x, y, top, r, h * scale, sides, rng),
                          "foliage", lambda _c, n, k=tone: k * (0.78 + 0.34 * max(n[2], 0.0)))

