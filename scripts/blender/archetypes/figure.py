"""Pedestal figure archetype: a star-shaped fort, a stepped granite pedestal and a robed copper
figure with a raised torch, a tablet and a rayed crown, in plain low-poly volumes.

Blender coordinates (z up), centred on the origin, the figure facing +y (the game's -z),
standing on `land_top`. `spec` (plain numbers from a landmark script):

- `fort`: points, outer and inner radius, height; `pedestal`: base and top width, height;
- `figure`: robe (base, waist, shoulder radius; shoulder height above the pedestal), head
  (radius, height), crown (rays, length), arm (length, width), torch (cup radius, flame
  height), tablet (width, height, thickness); all heights above the pedestal top;
- `detail`: trim scale; roles: `stone`, `metal` (the copper), `flame`.
"""

import math

from archetypes import facade, setback
from cclib import ops, prim

LEVELS = {
    0: {"sides": 14, "rays": True, "folds": 14, "tablet": True, "trims": True, "star": True, "pilasters": 4},
    1: {"sides": 9, "rays": True, "folds": 6, "tablet": True, "trims": True, "star": True, "pilasters": 2},
    2: {"sides": 5, "rays": True, "folds": 0, "tablet": True, "trims": False, "star": False},
    3: {"sides": 4, "rays": False, "folds": 0, "tablet": False, "trims": False, "star": False, "simple": True},
}

TRIM_TONE = 1.1
#: Night glow: the pedestal floodlit warm, the copper lit in its own green, the flame full.
FLOOD_TONE = 0.36
COPPER_GLOW = 0.3


def star(points, outer, inner):
    """A star footprint, counter-clockwise (the fort's walls)."""
    corners = []
    for i in range(points * 2):
        r = outer if i % 2 == 0 else inner
        a = math.pi / 2 + math.pi * i / points
        corners.append((r * math.cos(a), r * math.sin(a)))
    return corners


def prism(corners, z0, z1):
    """A closed prism over any simple footprint (the star is concave)."""
    return setback.extrude(corners, z0, z1)


def build(spec, level, view, density, builder):
    flags = dict(LEVELS[level])
    # Density sets how round the volumes are and how many folds the robe shows.
    flags["sides"] = max(4, min(24, int(round(flags["sides"] * density))))
    flags["folds"] = int(round(flags["folds"] * density))
    k = spec["detail"]
    z = spec["land_top"]
    fort = spec["fort"]
    stone = spec["stone"]
    flood = builder.colour("lamp", FLOOD_TONE)
    walls = (star(fort["points"], fort["outer"], fort["inner"]) if flags["star"]
             else star(max(3, flags["sides"]), fort["outer"], fort["outer"] * 0.92))
    builder.add(prism(walls, z, z + fort["height"]), stone, tone=0.92)
    z += fort["height"]
    ped = spec["pedestal"]
    bw, tw, ph = ped["base"], ped["top"], ped["height"]
    if flags.get("simple"):
        # The farthest level: one pedestal block, one robe cone, the arm and the flame.
        builder.add(prim.frustum(0, 0, z, z + ph, bw, bw, tw, tw), stone, glow=flood)
        _figure_simple(spec, z + ph, builder)
        return builder
    builder.add(prim.frustum(0, 0, z, z + ph * 0.55, bw, bw, tw * 1.1, tw * 1.1), stone, glow=flood)
    if flags["trims"]:
        band = 1.2 * k
        builder.add(prim.box(-tw * 0.6, tw * 0.6, -tw * 0.6, tw * 0.6, z + ph * 0.55, z + ph * 0.55 + band), stone,
                    tone=TRIM_TONE, glow=flood)
    builder.add(prim.box(-tw / 2, tw / 2, -tw / 2, tw / 2, z + ph * 0.55, z + ph * 0.92), stone, tone=0.96, glow=flood)
    pilasters = int(round(flags.get("pilasters", 0) * density))
    if pilasters:
        # The pedestal's upper storey: pilasters framing a darker loggia on each face.
        square = [(-tw / 2, -tw / 2), (tw / 2, -tw / 2), (tw / 2, tw / 2), (-tw / 2, tw / 2)]
        facade.fins(builder, square, z + ph * 0.58, z + ph * 0.9, pilasters, tw * 0.1, 1.0 * k, 0.6 * k, stone)
    builder.add(prim.box(-tw * 0.56, tw * 0.56, -tw * 0.56, tw * 0.56, z + ph * 0.92, z + ph), stone,
                tone=TRIM_TONE, glow=flood)
    z += ph
    _figure(spec, z, flags, builder)
    return builder


def _cone(z0, z1, r0, r1, sides, cx=0.0, cy=0.0):
    bm = setback.cone(z0, z1, r0, r1, sides)
    for v in bm.verts:
        v.co.x += cx
        v.co.y += cy
    return bm


def _figure(spec, z, flags, builder):
    f = spec["figure"]
    metal = spec["metal"]
    sides = flags["sides"]
    glow = builder.colour(metal, COPPER_GLOW)
    robe = f["robe"]
    waist_z = z + robe["shoulder"] * 0.45
    # The robe: flaring to the feet, narrowing to the shoulders.
    builder.add(_cone(z, waist_z, robe["base"], robe["waist"], sides), metal, tone=0.94, glow=glow)
    builder.add(_cone(waist_z, z + robe["shoulder"], robe["waist"], robe["shoulder_r"], sides), metal, glow=glow)
    for i in range(flags["folds"]):
        a = math.pi * (0.25 + 0.5 * i / max(1, flags["folds"] - 1))
        x, y = robe["base"] * 0.92 * math.cos(a), robe["base"] * 0.92 * math.sin(a)
        top = (robe["waist"] * 0.95 * math.cos(a), robe["waist"] * 0.95 * math.sin(a), waist_z)
        builder.add(prim.ribbon((x, y, z + 0.5), top, 0.45 * spec["detail"], ops.norm((-math.sin(a), math.cos(a), 0.0))),
                    metal, tone=0.86, jitter=False, glow=glow)
    head = f["head"]
    neck = z + robe["shoulder"]
    builder.add(_cone(neck, neck + head["height"], head["radius"], head["radius"] * 0.85, sides), metal, tone=1.04,
                glow=glow)
    if flags["rays"]:
        crown = f["crown"]
        base_z = neck + head["height"] * 0.8
        for i in range(crown["rays"]):
            a = math.pi * (0.15 + 0.7 * i / (crown["rays"] - 1))
            d = (math.cos(a), math.sin(a) * 0.6 + 0.2, 0.55)
            tip = ops.add((0.0, 0.0, base_z), ops.scale(ops.norm(d), head["radius"] + crown["length"]))
            root = ops.add((0.0, 0.0, base_z), ops.scale(ops.norm((d[0], d[1], 0.15)), head["radius"] * 0.8))
            builder.add(_ray(root, tip, crown["length"] * 0.28), metal, tone=1.08, glow=glow)
    # The raised right arm and the torch.
    arm = f["arm"]
    shoulder = (robe["shoulder_r"] * 0.85, 0.0, neck - head["height"] * 0.2)
    direction = ops.norm((0.22, 0.12, 1.0))
    hand = ops.add(shoulder, ops.scale(direction, arm["length"]))
    builder.add(_member(shoulder, hand, arm["width"]), metal, glow=glow)
    torch = f["torch"]
    hx, hy, hz = hand
    builder.add(_cone(hz, hz + torch["cup"] * 1.4, torch["cup"] * 0.5, torch["cup"], sides, hx, hy), spec["flame"],
                tone=0.9, glow=builder.colour(spec["flame"], 0.5))
    builder.add(_cone(hz + torch["cup"] * 1.4, hz + torch["cup"] * 1.4 + torch["flame"], torch["cup"] * 0.9, 0.0,
                      max(4, sides // 2), hx, hy), spec["flame"], tone=1.15, group="windows")
    if flags["tablet"]:
        t = f["tablet"]
        x0 = -robe["shoulder_r"] - t["thickness"]
        zc = z + robe["shoulder"] * 0.62
        builder.add(prim.box(x0 - t["thickness"], x0, -t["width"] / 2, t["width"] / 2, zc - t["height"] / 2,
                             zc + t["height"] / 2), metal, tone=0.9, glow=glow)


def _member(a, b, width):
    """A closed square beam from a to b."""
    along = ops.norm(ops.sub(b, a))
    side = ops.norm(ops.cross(along, (0.0, 1.0, 0.0)))
    up = ops.cross(side, along)
    h = width / 2
    corners = [ops.add(ops.scale(side, sx * h), ops.scale(up, sy * h)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    verts = [ops.add(a, c) for c in corners] + [ops.add(b, c) for c in corners]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return prim.from_faces(verts, faces)


def _ray(root, tip, width):
    """A crown ray: a slim three-sided spike from root to tip."""
    along = ops.norm(ops.sub(tip, root))
    side = ops.norm(ops.cross(along, (0.0, 0.0, 1.0)))
    up = ops.cross(side, along)
    h = width / 2
    verts = [ops.add(root, ops.scale(side, -h)), ops.add(root, ops.scale(side, h)), ops.add(root, ops.scale(up, h)), tip]
    return prim.from_faces(verts, [(0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)])


def _figure_simple(spec, z, builder):
    f = spec["figure"]
    metal = spec["metal"]
    glow = builder.colour(metal, COPPER_GLOW)
    robe, head = f["robe"], f["head"]
    top = z + robe["shoulder"] + head["height"]
    builder.add(_cone(z, top, robe["base"], head["radius"], 4), metal, glow=glow)
    shoulder = (robe["shoulder_r"] * 0.85, 0.0, z + robe["shoulder"] - head["height"] * 0.2)
    hand = ops.add(shoulder, ops.scale(ops.norm((0.22, 0.12, 1.0)), f["arm"]["length"]))
    builder.add(_member(shoulder, hand, f["arm"]["width"]), metal, glow=glow)
    torch = f["torch"]
    hx, hy, hz = hand
    builder.add(_cone(hz, hz + torch["cup"] * 1.4 + torch["flame"], torch["cup"], 0.0, 3, hx, hy), spec["flame"],
                group="windows")
