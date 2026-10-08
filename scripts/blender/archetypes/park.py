"""Park archetype: what a park adds on top of the green the map already draws. Tree masses
(low-poly canopy mounds in the leaf green of the CC0 trees) fill the map's park outline, broken
by open lawns and water, with paved drives and promenades, lamps along them that outline the
park at night, and the park's defining structures (generic: a terrace and fountain, a folly
tower on a rock; never a statue, sign or text, LEGAL-1).

Blender coordinates (z up) in map orientation: x east, y north, metres from the landmark's
landmarks.json location, on `land_top`. The model is placed there unturned (heading 0), so it
lines up with data/geo/parks.derived.json.

`spec` (plain numbers from a landmark script):

- `area`: the map's park polygons [[outer, *holes]] of [(x, y)]; `inset`: trees keep this far
  inside the outline;
- `trees`: {spacing (per level at density 1), height (lo, hi), lift};
- `clearings`: [{kind: "lawn" | "water", cx, cy, rx, ry, heading}] (heading: compass degrees of
  the rx axis);
- `paths`: [{points [(x, y)], width, closed, lamps (spacing or 0)}];
- `structures`: [{kind: "terrace" | "folly", ...}] (see `_terrace`, `_folly`);
- `detail`: trim scale; `perimeter_lamps`: spacing of the lamps that ring the park (0 for none).
"""

import math

import bmesh

from archetypes import facade, setback
from cclib import env, inputs, prim

LEVELS = {
    0: {"tree_spacing": 1.0, "disc_sides": 16, "paths": True, "lamps": 1.0, "detail": 2, "tree_sides": 6},
    1: {"tree_spacing": 1.45, "disc_sides": 12, "paths": True, "lamps": 0.0, "detail": 1, "tree_sides": 6},
    # The coarse levels are what mid and low show at the game camera: tree masses, lawns, water,
    # the structures as plain shapes and the lamplit drives at night.
    2: {"tree_spacing": 2.6, "disc_sides": 10, "paths": True, "lamps": 0.0, "detail": 0, "tree_sides": 5},
    3: {"tree_spacing": 4.2, "disc_sides": 8, "paths": False, "lamps": 0.0, "detail": 0, "tree_sides": 5},
}

#: Flat sheets sit this far above the land so they never fight the map's park green.
LAWN_LIFT = 0.35
WATER_LIFT = 0.25
PATH_LIFT = 0.5
LAMP_LIFT = 4.0
#: A lamplit drive glows faintly at night, so the park's drives draw its outline in the dark.
PATH_GLOW = 0.3


# ---- the map's park area -------------------------------------------------------------------

def project(lat, lng, projection):
    """Local metres (x east, y north) from the projection origin (src/lib/geo/projection.ts)."""
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    s = math.sin(math.radians(projection["originLat"]))
    term = 1 - e2 * s * s
    per_lat = (a * (1 - e2)) / term ** 1.5 * math.pi / 180
    per_lng = a / math.sqrt(term) * math.cos(math.radians(projection["originLat"])) * math.pi / 180
    return (lng - projection["originLng"]) * per_lng, (lat - projection["originLat"]) * per_lat


def decode_ring(deltas):
    """A delta-encoded ring (src/lib/geo/codec.ts) as [(x, y)] metres."""
    x = y = 0
    out = []
    for i in range(0, len(deltas), 2):
        x += deltas[i]
        y += deltas[i + 1]
        out.append((float(x), float(y)))
    return out


def local_frame(data):
    """A function lat/lng -> local (x, y) metres around the landmark's landmarks.json location
    (scripts/blender/inputs.ts puts the projection and the location in the lock digest)."""
    geo = inputs.read_json("data", "geo", "parks.derived.json")
    places = inputs.read_json("data", "landmarks", "landmarks.json")["landmarks"]
    place = next(p for p in places if p["id"] == data["id"])
    ox, oy = project(place["location"]["lat"], place["location"]["lng"], geo["projection"])

    def local(lat, lng):
        x, y = project(lat, lng, geo["projection"])
        return x - ox, y - oy

    return local


def map_frame(data):
    """(the measurements' `park` area as polygons around the landmark's location, local_frame)."""
    geo = inputs.read_json("data", "geo", "parks.derived.json")
    park_id = data["measurements"]["park"]
    area = next((p for p in geo["parks"] if p["id"] == park_id), None)
    if area is None:
        raise ValueError("no park %s in data/geo/parks.derived.json" % park_id)
    local = local_frame(data)
    ox, oy = local(*_inverse_origin(geo["projection"]))
    polygons = [[[(x + ox, y + oy) for x, y in decode_ring(ring)] for ring in polygon] for polygon in area["polygons"]]
    return polygons, local


def _inverse_origin(projection):
    """The projection origin as lat/lng: local_frame of it is minus the landmark's offset."""
    return projection["originLat"], projection["originLng"]


def oriented_box(points, heading_deg):
    """(centre, half length along the compass heading, half width across) of points."""
    ux, uy = math.sin(math.radians(heading_deg)), math.cos(math.radians(heading_deg))
    along = [x * ux + y * uy for x, y in points]
    across = [x * uy - y * ux for x, y in points]
    ca, cc = (max(along) + min(along)) / 2, (max(across) + min(across)) / 2
    return (ca * ux + cc * uy, ca * uy - cc * ux), (max(along) - min(along)) / 2, (max(across) - min(across)) / 2


def axis_point(centre, heading_deg, along, across):
    """The point `along` metres up the heading and `across` to its right from `centre`."""
    ux, uy = math.sin(math.radians(heading_deg)), math.cos(math.radians(heading_deg))
    return centre[0] + along * ux + across * uy, centre[1] + along * uy - across * ux


def inside_ring(x, y, ring):
    hit = False
    n = len(ring)
    for i in range(n):
        (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            hit = not hit
    return hit


def edge_distance(x, y, ring):
    best = float("inf")
    n = len(ring)
    for i in range(n):
        (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length2))
        best = min(best, math.hypot(x - ax - t * dx, y - ay - t * dy))
    return best


def in_area(x, y, area, inset):
    for polygon in area:
        outer, holes = polygon[0], polygon[1:]
        if inside_ring(x, y, outer) and not any(inside_ring(x, y, h) for h in holes):
            return all(edge_distance(x, y, ring) >= inset for ring in polygon)
    return False


def in_clearing(x, y, c, pad):
    t = math.radians(c["heading"])
    ux, uy = math.sin(t), math.cos(t)
    a = (x - c["cx"]) * ux + (y - c["cy"]) * uy
    b = (x - c["cx"]) * uy - (y - c["cy"]) * ux
    return (a / (c["rx"] + pad)) ** 2 + (b / (c["ry"] + pad)) ** 2 <= 1.0


# ---- build ---------------------------------------------------------------------------------

def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    rng = env.seeded_rng(spec["id"], "park-L%d" % level)
    z0 = spec["land_top"]
    for c in spec["clearings"]:
        _disc(builder, c, z0, flags["disc_sides"])
    if flags["paths"]:
        for path in spec["paths"]:
            _path(builder, spec, path, z0)
    lamp = spec["lamp_head"]
    if flags["lamps"] > 0 and view.shows(lamp):
        for path in spec["paths"]:
            if path["lamps"] > 0:
                _lamps(builder, spec, path["points"], path["closed"], path["lamps"] / flags["lamps"], z0, lamp)
    for s in spec["structures"]:
        {"terrace": _terrace, "folly": _folly}[s["kind"]](spec, s, flags["detail"], builder)
    _trees(spec, flags, density, rng, builder)
    return builder


def _flat(outline, z, lift):
    """A flat sheet `lift` above the land over a counter-clockwise outline, facing up (seen only
    from above: the game camera never goes below the land)."""
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, y, z + lift)) for x, y in outline])
    return bm


def ellipse(c, sides, grow=0.0):
    t = math.radians(c["heading"])
    ux, uy = math.sin(t), math.cos(t)
    out = []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        p, q = (c["rx"] + grow) * math.cos(a), (c["ry"] + grow) * math.sin(a)
        out.append((c["cx"] + p * ux + q * uy, c["cy"] + p * uy - q * ux))
    # Counter-clockwise seen from above, as setback.extrude expects.
    area = sum(out[i][0] * out[(i + 1) % sides][1] - out[(i + 1) % sides][0] * out[i][1] for i in range(sides))
    return out if area > 0 else list(reversed(out))


def _disc(builder, c, z0, sides):
    if c["kind"] == "water":
        # A pale shore ring under the water, showing round its edge.
        builder.add(_flat(ellipse(c, sides, 5.0), z0, WATER_LIFT), "granite", tone=0.9, jitter=False)
        builder.add(_flat(ellipse(c, sides), z0, WATER_LIFT + 0.1), "water", jitter=False)
    else:
        builder.add(_flat(ellipse(c, sides), z0, LAWN_LIFT), "lawn", tone=c.get("tone", 1.0))


def wet(x, y, spec, pad=6.0):
    return any(c["kind"] == "water" and in_clearing(x, y, c, pad) for c in spec["clearings"])


def pieces(points, closed, step):
    """A polyline cut into pieces about `step` long: [(a, b)]."""
    pts = points + (points[:1] if closed else [])
    out = []
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        n = max(1, int(math.ceil(math.hypot(bx - ax, by - ay) / step)))
        for i in range(n):
            out.append(((ax + (bx - ax) * i / n, ay + (by - ay) * i / n),
                        (ax + (bx - ax) * (i + 1) / n, ay + (by - ay) * (i + 1) / n)))
    return out


def _path(builder, spec, path, z0):
    """A paved ribbon, cut where it would run over water (the drives pass round the shores)."""
    runs, run = [], []
    for a, b in pieces(path["points"], path["closed"], 40.0):
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if wet(mid[0], mid[1], spec, path["width"]):
            if run:
                runs.append(run)
            run = []
            continue
        run = run + [a, b] if not run else run + [b]
    if run:
        runs.append(run)
    for points in runs:
        _ribbon(builder, path, points, z0)


def straightened(points):
    """`points` without the ones that lie on a straight line between their neighbours."""
    out = [points[0]]
    for i in range(1, len(points) - 1):
        (ax, ay), (bx, by), (cx, cy) = out[-1], points[i], points[i + 1]
        if abs((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) > 1e-6 * max(1.0, math.hypot(cx - ax, cy - ay)) ** 2:
            out.append(points[i])
    out.append(points[-1])
    return out


def _ribbon(builder, path, points, z0):
    pts = straightened(points)
    hw = path["width"] / 2
    z = z0 + PATH_LIFT
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        length = math.hypot(bx - ax, by - ay)
        if length < 1e-6:
            continue
        nx, ny = -(by - ay) / length * hw, (bx - ax) / length * hw
        # Each segment runs a half-width past its ends so the corners close.
        ex, ey = (bx - ax) / length * hw, (by - ay) / length * hw
        builder.add(prim.quad((ax - ex + nx, ay - ey + ny, z), (ax - ex - nx, ay - ey - ny, z),
                              (bx + ex - nx, by + ey - ny, z), (bx + ex + nx, by + ey + ny, z), (0.0, 0.0, 1.0)),
                    path.get("role", "granite"), tone=path.get("tone", 1.0),
                    glow=builder.colour("lamp", PATH_GLOW) if path.get("lit") else None)


def _lamps(builder, spec, points, closed, spacing, z0, head):
    pts = points + (points[:1] if closed else [])
    carry = spacing / 2
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        length = math.hypot(bx - ax, by - ay)
        t = carry
        while t < length:
            u = t / length
            if wet(ax + (bx - ax) * u, ay + (by - ay) * u, spec):
                t += spacing
                continue
            builder.add(prim.diamond((ax + (bx - ax) * u, ay + (by - ay) * u, z0 + LAMP_LIFT), head / 2), "lamp",
                        group="windows", jitter=False)
            t += spacing
        carry = t - length


def _crown(x, y, z0, r, h, sides, rng):
    """A canopy mound: a ring on the ground, a wider ring part-way up and a peak, each vertex
    nudged so neighbouring mounds read as different trees. Open underneath (it sits on land)."""
    phase = rng.uniform(0, 2 * math.pi)
    ring = lambda radius, z: [(x + radius * rng.uniform(0.88, 1.08) * math.cos(phase + 2 * math.pi * i / sides),  # noqa: E731
                               y + radius * rng.uniform(0.88, 1.08) * math.sin(phase + 2 * math.pi * i / sides), z)
                              for i in range(sides)]
    verts = ring(r * 0.78, z0) + ring(r, z0 + h * rng.uniform(0.4, 0.55))
    verts.append((x + rng.uniform(-0.15, 0.15) * r, y + rng.uniform(-0.15, 0.15) * r, z0 + h))
    apex = 2 * sides
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    faces += [(sides + i, sides + (i + 1) % sides, apex) for i in range(sides)]
    return prim.from_faces(verts, faces)


def _trees(spec, flags, density, rng, builder):
    t = spec["trees"]
    spacing = t["spacing"] * flags["tree_spacing"] / math.sqrt(max(density, 1e-3))
    xs = [x for polygon in spec["area"] for x, _ in polygon[0]]
    ys = [y for polygon in spec["area"] for _, y in polygon[0]]
    z0 = spec["land_top"]
    lo, hi = t["height"]
    # Bigger mounds on the coarse levels (fewer, wider, the same cover), a little lower.
    # Mounds about half the spacing wide: clumps of trees with the park's green between them.
    radius = 0.52 * spacing
    clear_pad = 0.35 * spacing
    j = 0
    y = min(ys) + spacing / 2
    while y < max(ys):
        x = min(xs) + spacing / 2 + (spacing / 2 if j % 2 else 0.0)
        while x < max(xs):
            px, py = x + rng.uniform(-0.35, 0.35) * spacing, y + rng.uniform(-0.35, 0.35) * spacing
            r = radius * rng.uniform(0.8, 1.15)
            ok = in_area(px, py, spec["area"], spec["inset"] + 0.4 * r)
            ok = ok and not any(in_clearing(px, py, c, clear_pad) for c in spec["clearings"])
            ok = ok and not any(math.hypot(px - s["x"], py - s["y"]) < s["clear"] + 0.5 * r for s in spec["structures"])
            height = rng.uniform(lo, hi)
            tone = rng.uniform(0.86, 1.12)
            if ok:
                bm = _crown(px, py, z0, r, height, flags["tree_sides"], rng)
                builder.add_toned(bm, "foliage", lambda _c, n, k=tone: k * (0.78 + 0.34 * max(n[2], 0.0)))
            x += spacing
        y += spacing * 0.87
        j += 1


# ---- structures (generic) ------------------------------------------------------------------

def _terrace(spec, s, detail, builder):
    """A formal terrace above a lake: a stone platform with a stair down to a round fountain
    plaza, a tiered fountain (no figure) in a basin. Floodlit at night."""
    k = spec["detail"]
    z0 = spec["land_top"]
    flood = facade.floodlight(builder)
    x, y, a = s["x"], s["y"], math.radians(s["heading"])
    ux, uy = math.sin(a), math.cos(a)

    def at(along, across):
        return x + along * ux + across * uy, y + along * uy - across * ux

    def rect(a0, a1, c0, c1):
        pts = [at(a0, c0), at(a0, c1), at(a1, c1), at(a1, c0)]
        area = sum(pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1] for i in range(4))
        return pts if area > 0 else list(reversed(pts))

    w, d, h = s["width"], s["depth"], s["height"]
    # The upper terrace (back) and its balustrade wall; the plaza toward the water (+along).
    builder.add(setback.extrude(rect(-d / 2, -d / 2 + d * 0.38, -w / 2, w / 2), z0, z0 + h), "stone", glow=flood)
    steps = 3 if detail else 1
    for i in range(steps):
        a0 = -d / 2 + d * 0.38 + i * d * 0.12 / steps
        builder.add(setback.extrude(rect(a0, a0 + d * 0.12 / steps, -w * 0.22, w * 0.22), z0,
                                    z0 + h * (steps - i) / (steps + 1)), "stone", tone=0.95)
    builder.add(setback.extrude(rect(-d / 2 + d * 0.38, d / 2, -w / 2, w / 2), z0, z0 + 0.6 * k), "granite",
                tone=0.96)
    if s["fountain"] > 0:
        _fountain(spec, s, at(d * 0.18, 0.0), detail, flood, builder)
    if detail >= 1:
        # Arcade openings under the upper terrace, darker (recessed), facing the plaza.
        for i in range(-2, 3):
            cx, cy = at(-d / 2 + d * 0.38 + 0.05, i * w * 0.08)
            ox, oy = uy * w * 0.03, -ux * w * 0.03
            zb, zt2 = z0 + 0.4 * k, z0 + h * 0.75
            builder.add(prim.quad((cx - ox, cy - oy, zb), (cx + ox, cy + oy, zb), (cx + ox, cy + oy, zt2),
                                  (cx - ox, cy - oy, zt2), (ux, uy, 0.0)), "stone", tone=0.62, jitter=False)


def _fountain(spec, s, centre, detail, flood, builder):
    """A round basin with a tiered fountain in it (no figure)."""
    k = spec["detail"]
    z0 = spec["land_top"]
    fx, fy = centre
    sides = (16, 12, 8)[min(detail, 2)] if detail else 8
    r = s["fountain"]
    builder.add(setback_ring(fx, fy, z0, z0 + 1.2 * k, r, sides), "stone", tone=1.05, glow=flood)
    builder.add(setback_ring(fx, fy, z0, z0 + 1.0 * k, r * 0.9, sides), "water")
    tiers = 2 if detail else 1
    zt = z0 + 1.0 * k
    for i in range(tiers):
        builder.add(setback_ring(fx, fy, zt, zt + s["fountain_h"] / (tiers + 1), r * 0.12, 6), "stone", tone=1.08,
                    glow=flood)
        zt += s["fountain_h"] / (tiers + 1)
        builder.add(setback_ring(fx, fy, zt, zt + 0.5 * k, r * (0.45 - 0.18 * i), sides // 2), "stone", tone=1.1,
                    glow=flood)
        zt += 0.5 * k


def setback_ring(cx, cy, z0, z1, r, sides):
    bm = setback.cone(z0, z1, r, r, sides)
    for v in bm.verts:
        v.co.x += cx
        v.co.y += cy
    return bm


def _folly(spec, s, detail, builder):
    """A folly on a rock outcrop: a stone keep with a square tower and a small round turret
    with a pointed roof (generic). The tower top is the model's top (`top` above the land)."""
    k = spec["detail"]
    z0 = spec["land_top"]
    flood = facade.floodlight(builder)
    x, y = s["x"], s["y"]
    rock_h = s["rock_h"]
    sides = 8 if detail else 6
    bm = setback.cone(z0, z0 + rock_h, s["rock_r"], s["rock_r"] * 0.55, sides)
    for v in bm.verts:
        v.co.x += x
        v.co.y += y
    builder.add(bm, "granite", tone=0.84)
    base = z0 + rock_h
    kw = s["keep"]
    builder.add(prim.box(x - kw, x + kw * 0.6, y - kw * 0.5, y + kw * 0.5, base, base + s["keep_h"]), "stone",
                tone=0.92, glow=flood)
    tw = s["tower_w"]
    tower_top = z0 + s["top"] - s["roof_h"]
    builder.add(prim.box(x + kw * 0.6 - tw, x + kw * 0.6, y - tw / 2, y + tw / 2, base, tower_top), "stone",
                glow=flood)
    if detail >= 1:
        # Crenellations on the keep: merlons along its long sides.
        for i in range(5):
            mx = x - kw + (i + 0.5) * kw * 1.6 / 5
            for my in (y - kw * 0.5, y + kw * 0.5 - 0.8 * k):
                builder.add(prim.box(mx - 0.5 * k, mx + 0.5 * k, my, my + 0.8 * k, base + s["keep_h"],
                                     base + s["keep_h"] + 1.0 * k), "stone", tone=0.95)
    tx, ty = x + kw * 0.6 - tw / 2, y
    builder.add(setback_ring(tx, ty, tower_top, tower_top + 0.8 * k, tw * 0.62, 8), "stone", tone=1.06, glow=flood)
    roof = setback.cone(tower_top + 0.8 * k, z0 + s["top"], tw * 0.5, 0.0, 8)
    for v in roof.verts:
        v.co.x += tx
        v.co.y += ty
    builder.add(roof, "roof", tone=0.9)
