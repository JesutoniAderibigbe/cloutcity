"""Astoria Park: lane E's park archetype over the map's park outline (park-qn0191) with this
park's own pieces: tree masses round the great lawn and the running track, the riverside
promenade along the park's west edge (following the outline), lamplit at night, and the big
outdoor pool with a generic bathhouse and its two towers (no signs or text, LEGAL-1).

Points are marked estimates in data/landmarks/measurements/astoria-park.json. Map-oriented:
placed at the landmarks.json location with heading 0.
"""

import math

from archetypes import facade, park, setback
from cclib import env, inputs, prim

CATEGORY = "park"


class _Archetype:
    """The park archetype plus the pool and bathhouse (kept out of park.py, which is lane E's)."""

    LEVELS = park.LEVELS

    @staticmethod
    def build(spec, level, view, density, builder):
        park.build(spec, level, view, density, builder)
        _pool(spec, level, builder)
        return builder


ARCHETYPE = _Archetype


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    read = data["measurements"]["readabilityScale"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    s = 1.0 if true_scale else read["structures"]
    v = lambda key: m[key]["valueM"]  # noqa: E731
    area, local = park.map_frame(data)

    def at(key):
        return local(m[key]["lat"], m[key]["lng"])

    def clearing(key, kind, heading, tone=1.0):
        x, y = at(key)
        axes = m[key + "Axes"]
        return {"kind": kind, "cx": x, "cy": y, "rx": axes["widthM"], "ry": axes["depthM"], "heading": heading,
                "tone": tone}

    axis = v("parkHeadingDeg")
    px, py = at("pool")
    pool_w, pool_d = m["poolPlan"]["widthM"] * s, m["poolPlan"]["depthM"] * s
    bath_w, bath_d = m["bathhouse"]["widthM"] * s, m["bathhouse"]["depthM"] * s
    clearings = [
        clearing("lawn", "lawn", axis, 1.2),
        clearing("track", "lawn", axis, 0.95),
        # The pool and bathhouse stand in a paved clearing (no trees).
        {"kind": "lawn", "cx": px + bath_d / 2, "cy": py, "rx": pool_w * 0.75, "ry": pool_d * 0.95,
         "heading": 90.0, "tone": 0.9},
    ]
    return {
        "id": data["id"],
        "detail": (h * s) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "area": area,
        "inset": 14.0,
        "trees": {"spacing": v("treeSpacingM"), "height": (v("treeLowM") * h, v("treeHighM") * h)},
        "clearings": clearings,
        "paths": [{"points": shore(area, axis), "width": v("promenadeWidthM") * read["paths"], "closed": False,
                   "lamps": v("lampSpacingM"), "role": "stone", "tone": 0.95, "lit": True}],
        "lamp_head": 0.5 * read["lamp"],
        "structures": [],
        "pool": {"x": px, "y": py, "width": pool_w, "depth": pool_d, "bath_w": bath_w, "bath_d": bath_d,
                 "bath_h": v("bathhouseM") * h, "top": expected_height(data, true_scale)},
        "water_role": "water" if "water" in data["palette"] else "glass",
    }


def shore(area, heading, inset=12.0):
    """The promenade: the outline's river side (left of the park's long axis, the north-west
    edge), a little inside it, in order along the axis."""
    ring = max((polygon[0] for polygon in area), key=len)
    t = math.radians(heading)
    ux, uy = math.sin(t), math.cos(t)
    nx, ny = -uy, ux
    across = [x * nx + y * ny for x, y in ring]
    cut = sum(across) / len(across)
    points = sorted(((x - nx * inset, y - ny * inset) for (x, y), c in zip(ring, across) if c > cut),
                    key=lambda p: p[0] * ux + p[1] * uy)
    return points


def _pool(spec, level, builder):
    """The pool: a paved deck, the water, and the bathhouse along its east side with two towers."""
    p = spec["pool"]
    k = spec["detail"]
    z0 = spec["land_top"]
    x, y, w, d = p["x"], p["y"], p["width"], p["depth"]
    flood = facade.floodlight(builder)
    rect = lambda cx, cy, a, b: [(cx - a / 2, cy - b / 2), (cx + a / 2, cy - b / 2), (cx + a / 2, cy + b / 2),  # noqa: E731
                                 (cx - a / 2, cy + b / 2)]
    builder.add(setback.extrude(rect(x, y, w + 12.0 * k, d + 12.0 * k), z0, z0 + 0.5 * k), "stone", tone=0.95)
    builder.add(setback.extrude(rect(x, y, w, d), z0, z0 + 0.65 * k), spec["water_role"], tone=0.9, jitter=False)
    bx = x + w / 2 + 6.0 * k + p["bath_d"] / 2
    bh = p["bath_h"]
    builder.add(setback.extrude(rect(bx, y, p["bath_d"], p["bath_w"]), z0, z0 + bh), "brick", tone=0.88, glow=flood)
    tower = p["bath_d"] * 0.8
    for side in (-1, 1):
        ty = y + side * (p["bath_w"] / 2 - tower / 2)
        builder.add(setback.extrude(rect(bx, ty, tower, tower), z0 + bh, z0 + p["top"] - 1.0 * k), "brick",
                    tone=0.92, glow=flood)
        builder.add(prim.box(bx - tower / 2 - 0.4 * k, bx + tower / 2 + 0.4 * k, ty - tower / 2 - 0.4 * k,
                             ty + tower / 2 + 0.4 * k, z0 + p["top"] - 1.0 * k, z0 + p["top"]), "stone",
                    tone=1.08, glow=flood)
    if level <= 1:
        # Lit windows along the bathhouse front, facing the pool.
        facade.window_bands(builder, rect(bx, y, p["bath_d"], p["bath_w"]), z0 + 2.0 * k, z0 + bh - 1.5 * k, 2,
                            0.1 * p["bath_w"], _rng(spec, level), share=0.5, column_pitch=4.0 * k)


def _rng(spec, level):
    return env.seeded_rng(spec["id"], "windows-L%d" % level)


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 700.0, "green": [polygon[0] for polygon in spec["area"]]}


def exclusions(spec):
    """None: the map already draws the park's green, and its own data keeps buildings out."""
    return []
