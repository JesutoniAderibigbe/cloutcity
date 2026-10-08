"""Civic hall archetype (government): generic but recognisable classical massing. Blocks (a main
block and wings) on a rusticated base with a cornice, an attic or balustrade and a low hipped
roof; a columned portico on the front with steps, an entablature and an optional pediment; an
optional cupola (base stage, colonnaded drum, dome, lantern and finial). No signage, no text, no
seals or statues (LEGAL-1): the finial is a plain needle.

Blender coordinates (z up), centred on the origin, the front facing +y (the game's -z), standing
on `land_top`. `spec` (plain numbers from a landmark script):

- `blocks`: [{cx, cy, w, d, h, rows, roof_h, attic}] (centre, plan, wall height, window storeys,
  hipped roof height, attic or balustrade height above the cornice);
- `portico`: {cx, w, back, depth, h, columns, pediment, steps, steps_h} (`back` = y of the wall
  it stands against; `pediment` = its height or 0 for a flat balustraded top) or None;
- `cupola`: {on (block index), base {sides, r, h}, drum {sides, r, h}, dome {r, h}, lantern {r, h},
  finial} or None;
- `roles`: body, trim, roof, dome; `detail`: trim scale; `column_pitch`: window spacing.
"""

import math

from archetypes import facade, setback
from cclib import env, prim

LEVELS = {
    0: {"chamfer": True, "steps": 3, "column_sides": 8, "drum_columns": True, "dome_rings": 4, "dome_sides": 16,
        "rows": 1.0, "cornice": True, "base": True, "columns": True, "recess": True, "pilasters": 1.0,
        "balusters": True, "capitals": True, "apron": True, "simple": False},
    1: {"chamfer": False, "steps": 2, "column_sides": 6, "drum_columns": True, "dome_rings": 3, "dome_sides": 10,
        "rows": 0.7, "cornice": True, "base": True, "columns": True, "recess": True, "pilasters": 0.5,
        "balusters": False, "capitals": False, "apron": True, "simple": False},
    # The coarse levels are what mid and low show at the game camera (2-4.5 km): massing, the
    # dark roof, the pale portico and the cupola; one glowing window band per wall at night.
    2: {"chamfer": False, "steps": 1, "column_sides": 4, "drum_columns": False, "dome_rings": 2, "dome_sides": 8,
        "rows": 0.35, "cornice": True, "base": False, "columns": True, "recess": True, "pilasters": 0.0,
        "balusters": False, "capitals": False, "apron": True, "simple": False},
    3: {"chamfer": False, "steps": 0, "column_sides": 4, "drum_columns": False, "dome_rings": 1, "dome_sides": 6,
        "rows": 0.2, "cornice": False, "base": False, "columns": False, "recess": False, "pilasters": 0.0,
        "balusters": False, "capitals": False, "apron": False, "simple": True},
}

TRIM_TONE = 1.08
BASE_TONE = 0.86
#: Recessed surfaces (the wall behind the columns, the drum behind its colonnade) read darker.
RECESS_TONE = 0.7
UPLIGHT_TONE = 0.24


def uplight(builder):
    return builder.colour("lamp", UPLIGHT_TONE)


def rect(cx, cy, w, d):
    """A w x d rectangle centred on (cx, cy), counter-clockwise."""
    return [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2), (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]


def block_top(spec, block):
    """The z of a block's roof ridge."""
    return spec["land_top"] + block["h"] + block["attic"] + block["roof_h"]


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    lit = env.seeded_rng(spec["id"], "windows-L%d" % level)
    if flags["apron"] and spec.get("apron"):
        # The paved forecourt the hall stands on, just proud of the land.
        a = spec["apron"]
        z0 = spec["land_top"]
        builder.add(prim.box(-a["w"] / 2, a["w"] / 2, -a["d"] / 2, a["d"] / 2, z0, z0 + 0.3), spec["roles"]["paving"],
                    tone=0.9)
    for block in spec["blocks"]:
        _block(spec, block, flags, density, lit, builder)
    if spec.get("portico"):
        _portico(spec, spec["portico"], flags, builder)
    if spec.get("cupola"):
        _cupola(spec, spec["cupola"], flags, builder)
    return builder


def _block(spec, b, flags, density, lit, builder):
    k = spec["detail"]
    roles = spec["roles"]
    z0 = spec["land_top"]
    top = z0 + b["h"]
    corners = rect(b["cx"], b["cy"], b["w"], b["d"])
    # Farthest level: the attic folds into the wall (one box per block).
    wall_top = top + b["attic"] if flags["simple"] else top
    builder.add(setback.extrude(corners, z0, wall_top), roles["body"],
                chamfer_dim=min(b["w"], b["d"]) if flags["chamfer"] else None, glow=uplight(builder))
    base_h = 0.0
    if flags["base"]:
        # The rusticated base storey, slightly proud and darker.
        base_h = b.get("base", 0.0)
        if base_h > 0:
            builder.add(setback.extrude(rect(b["cx"], b["cy"], b["w"] + 0.8 * k, b["d"] + 0.8 * k), z0, z0 + base_h),
                        roles["body"], tone=BASE_TONE)
    if flags["cornice"]:
        band = 1.4 * k
        builder.add(setback.extrude(rect(b["cx"], b["cy"], b["w"] + 1.6 * k, b["d"] + 1.6 * k), top - band, top),
                    roles["trim"], tone=TRIM_TONE, glow=facade.floodlight(builder))
    roof_z = top
    if b["attic"] > 0 and flags["balusters"]:
        _balustrade(spec, rect(b["cx"], b["cy"], b["w"] - 0.6 * k, b["d"] - 0.6 * k), top, b["attic"], density, builder)
        roof_z = top + b["attic"] * 0.25
    elif b["attic"] > 0 and flags["simple"]:
        roof_z = wall_top
    elif b["attic"] > 0:
        builder.add(setback.extrude(rect(b["cx"], b["cy"], b["w"] - 0.6 * k, b["d"] - 0.6 * k), top, top + b["attic"]),
                    roles["trim"], tone=1.02)
        roof_z = top + b["attic"]
    if b["roof_h"] > 0:
        builder.add(hip_roof(b["cx"], b["cy"], b["w"] - 1.2 * k, b["d"] - 1.2 * k, roof_z, b["roof_h"]), roles["roof"])
    rows = min(b["rows"], int(round(b["rows"] * flags["rows"] * density)))
    rows = max(rows, 1)
    pitch = spec["column_pitch"] / max(min(flags["rows"] * density, 1.0), 0.2)
    z_lo = z0 + (base_h if flags["base"] else 0.0) + 1.2 * k
    if flags["pilasters"] > 0:
        _pilasters(spec, corners, z_lo - 0.6 * k, top - 1.4 * k, pitch, 0.08 * min(b["w"], b["d"]),
                   int(round(1 / flags["pilasters"])), builder)
    if flags["base"] and base_h > 0 and flags["rows"] >= 1.0:
        # Small windows in the basement storey.
        facade.window_bands(builder, rect(b["cx"], b["cy"], b["w"] + 0.8 * k, b["d"] + 0.8 * k), z0 + 0.25 * base_h,
                            z0 + 0.85 * base_h, 1, 0.08 * min(b["w"], b["d"]), lit, share=0.7, column_pitch=pitch)
    facade.window_bands(builder, corners, z_lo, top - 2.0 * k, rows, 0.08 * min(b["w"], b["d"]), lit, share=0.5,
                        column_pitch=pitch if flags["rows"] > 0.5 else None)


def _pilasters(spec, corners, z0, z1, pitch, margin, stride, builder):
    """Flat pilasters between the window bays on every wall (every `stride`-th bay line), laid
    out as facade.window_bands lays out its columns: shallow open boxes, lighter."""
    k = spec["detail"]
    n = len(corners)
    width, depth = 0.9 * k, 0.35 * k
    for i in range(n):
        (ax, ay), (bx, by) = corners[i], corners[(i + 1) % n]
        length = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        usable = length - 2 * margin
        count = max(1, int(round(usable / pitch)))
        if count < 2:
            continue
        ux, uy = (bx - ax) / length, (by - ay) / length
        nx, ny = uy, -ux
        for j in range(0, count + 1, stride):
            t = margin + usable * j / count
            cx, cy = ax + ux * t, ay + uy * t
            hw = width / 2
            base = [(cx - ux * hw, cy - uy * hw), (cx + ux * hw, cy + uy * hw),
                    (cx + ux * hw + nx * depth, cy + uy * hw + ny * depth),
                    (cx - ux * hw + nx * depth, cy - uy * hw + ny * depth)]
            verts = [(x, y, z0) for x, y in base] + [(x, y, z1) for x, y in base]
            # Three outward faces; the back and the ends hide in the wall, cornice and base.
            faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
            builder.add(prim.from_faces(verts, faces), spec["roles"]["body"], tone=1.06, jitter=False)


def _balustrade(spec, corners, z, height, density, builder):
    """A balustrade along a roof edge: a plinth, a top rail and posts between them."""
    k = spec["detail"]
    trim = spec["roles"]["trim"]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    w, d = max(xs) - min(xs), max(ys) - min(ys)
    rail = 0.22 * height
    t = 0.7 * k
    builder.add(setback.extrude(corners, z, z + 0.25 * height), trim, tone=1.02)
    for (x0, x1, y0, y1) in ((cx - w / 2, cx + w / 2, cy - d / 2, cy - d / 2 + t),
                             (cx - w / 2, cx + w / 2, cy + d / 2 - t, cy + d / 2),
                             (cx - w / 2, cx - w / 2 + t, cy - d / 2, cy + d / 2),
                             (cx + w / 2 - t, cx + w / 2, cy - d / 2, cy + d / 2)):
        builder.add(prim.box(x0, x1, y0, y1, z + height - rail, z + height), trim, tone=1.08,
                    glow=facade.floodlight(builder))
    spacing = 1.6 * k / max(min(density, 1.0), 0.3)
    for (ax, ay), (bx, by) in zip(corners, corners[1:] + corners[:1]):
        length = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        count = int(length / spacing)
        for j in range(1, count):
            u = j / count
            builder.add(column(ax + (bx - ax) * u, ay + (by - ay) * u, z + 0.25 * height, z + height - rail,
                               0.3 * k, 4), trim, tone=0.98, jitter=False)


def hip_roof(cx, cy, w, d, z, h):
    """A hipped roof over a w x d rectangle: four slopes up to a ridge along the longer side."""
    hw, hd = w / 2, d / 2
    if w >= d:
        ridge = [(cx - (hw - hd), cy, z + h), (cx + (hw - hd), cy, z + h)]
    else:
        ridge = [(cx, cy - (hd - hw), z + h), (cx, cy + (hd - hw), z + h)]
    verts = [(cx - hw, cy - hd, z), (cx + hw, cy - hd, z), (cx + hw, cy + hd, z), (cx - hw, cy + hd, z)] + ridge
    if w >= d:
        faces = [(3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4)]
    else:
        faces = [(3, 2, 1, 0), (0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5)]
    return prim.from_faces(verts, faces)


def _portico(spec, p, flags, builder):
    k = spec["detail"]
    roles = spec["roles"]
    z0 = spec["land_top"]
    x0, x1 = p["cx"] - p["w"] / 2, p["cx"] + p["w"] / 2
    back, front = p["back"], p["back"] + p["depth"]
    top = z0 + p["h"]
    stylo = 1.2 * k
    ent = 2.0 * k
    # Steps down to the street in front of the portico.
    steps = flags["steps"]
    for i in range(steps):
        reach = p["steps"] * (steps - i) / steps
        builder.add(prim.box(x0 + 0.6 * k * i, x1 - 0.6 * k * i, front, front + reach, z0,
                             z0 + p["steps_h"] * (i + 1) / steps), roles["trim"], tone=0.96 - 0.02 * i)
    if not flags["columns"]:
        # Far: the portico as one pale block under its pediment.
        builder.add(prim.box(x0, x1, back, front, z0, top), roles["trim"], glow=facade.floodlight(builder))
    else:
        builder.add(prim.box(x0, x1, back, front, z0, z0 + stylo), roles["trim"], tone=0.94)
        builder.add(prim.box(x0, x1, back, front, top - ent, top), roles["trim"], tone=TRIM_TONE,
                    glow=facade.floodlight(builder))
        if flags["recess"]:
            # The wall in the portico's shadow, darker than the open facade.
            builder.add(prim.quad((x0, back + 0.1, z0 + stylo), (x1, back + 0.1, z0 + stylo),
                                  (x1, back + 0.1, top - ent), (x0, back + 0.1, top - ent), (0.0, 1.0, 0.0)),
                        roles["body"], tone=RECESS_TONE, jitter=False)
        n = p["columns"]
        spacing = p["w"] / n
        r = min(spacing * 0.28, p["depth"] * 0.22)
        sides = flags["column_sides"]
        for i in range(n):
            x = x0 + spacing * (i + 0.5)
            y = front - r * 1.4
            builder.add(column(x, y, z0 + stylo, top - ent, r, sides), roles["trim"], tone=1.04,
                        jitter=False, glow=facade.floodlight(builder))
            if flags["capitals"]:
                c = r * 1.35
                builder.add(prim.box(x - c, x + c, y - c, y + c, top - ent - 0.7 * k, top - ent), roles["trim"],
                            tone=1.1)
                builder.add(prim.box(x - c, x + c, y - c, y + c, z0 + stylo, z0 + stylo + 0.5 * k), roles["trim"],
                            tone=0.95)
    if p["pediment"] > 0:
        outline = [(x0 - 0.4 * k, top), (x1 + 0.4 * k, top), (p["cx"], top + p["pediment"])]
        builder.add(prim.prism_xz(outline, back, front + 0.4 * k), roles["trim"], tone=TRIM_TONE,
                    glow=facade.floodlight(builder))
        if flags["recess"]:
            # The tympanum, recessed and darker inside the raking cornice.
            inset = 1.2 * k
            yf = front + 0.45 * k
            z_lo, z_hi = top + 0.6 * inset, top + p["pediment"] - 1.6 * inset
            # A sliver-topped quad (not a triangle) so prim.quad can wind it to face out.
            half_lo = (x1 - x0) / 2 - 3 * inset
            half_hi = 0.04 * half_lo
            cx = p["cx"]
            builder.add(prim.quad((cx - half_lo, yf, z_lo), (cx + half_lo, yf, z_lo), (cx + half_hi, yf, z_hi),
                                  (cx - half_hi, yf, z_hi), (0.0, 1.0, 0.0)), roles["trim"], tone=0.82, jitter=False)
    elif p.get("balustrade", 0) > 0:
        builder.add(prim.box(x0, x1, back, front, top, top + p["balustrade"]), roles["trim"], tone=1.02)


def column(x, y, z0, z1, r, sides):
    """A column shaft tapering slightly (an open prism: its ends hide in the base and capital)."""
    ring = lambda radius, z: [(x + radius * math.cos(2 * math.pi * (i + 0.5) / sides),  # noqa: E731
                               y + radius * math.sin(2 * math.pi * (i + 0.5) / sides), z) for i in range(sides)]
    verts = ring(r, z0) + ring(r * 0.86, z1)
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    return prim.from_faces(verts, faces)


def dome(cx, cy, z, r, h, sides, rings):
    """A dome over a `sides`-gon of radius r: `rings` bands of quads up to an apex."""
    verts = []
    for j in range(rings):
        a = (math.pi / 2) * j / rings
        rr, zz = r * math.cos(a), z + h * math.sin(a)
        verts += [(cx + rr * math.cos(2 * math.pi * (i + 0.5) / sides),
                   cy + rr * math.sin(2 * math.pi * (i + 0.5) / sides), zz) for i in range(sides)]
    verts.append((cx, cy, z + h))
    apex = len(verts) - 1
    faces = [tuple(reversed(range(sides)))]
    for j in range(rings - 1):
        a, b = j * sides, (j + 1) * sides
        faces += [(a + i, a + (i + 1) % sides, b + (i + 1) % sides, b + i) for i in range(sides)]
    last = (rings - 1) * sides
    faces += [(last + i, last + (i + 1) % sides, apex) for i in range(sides)]
    return prim.from_faces(verts, faces)


def cone(cx, cy, z0, z1, r0, r1, sides):
    """setback.cone (a regular frustum or pyramid, flat sides on the axes) centred on (cx, cy)."""
    bm = setback.cone(z0, z1, r0, r1, sides)
    for vert in bm.verts:
        vert.co.x += cx
        vert.co.y += cy
    return bm


def _cupola(spec, c, flags, builder):
    k = spec["detail"]
    roles = spec["roles"]
    block = spec["blocks"][c["on"]]
    cx, cy = block["cx"], block["cy"]
    z = spec["land_top"] + block["h"] + block["attic"] + c.get("seat", 0.0)
    flood = facade.floodlight(builder)
    if c.get("seat", 0.0) > 0:
        # The cupola's footing on the roof.
        r = c["base"]["r"] * 1.25
        builder.add(prim.box(cx - r, cx + r, cy - r, cy + r, z - c["seat"], z), roles["body"], tone=0.96)
    base = c["base"]
    builder.add(cone(cx, cy, z, z + base["h"], base["r"], base["r"], base["sides"]), roles["body"], glow=flood)
    if flags["cornice"]:
        builder.add(cone(cx, cy, z + base["h"] - 0.8 * k, z + base["h"], base["r"] + 0.6 * k, base["r"] + 0.6 * k,
                                 base["sides"]), roles["trim"], tone=TRIM_TONE, glow=flood)
    z += base["h"]
    drum = c["drum"]
    if flags["drum_columns"]:
        builder.add(cone(cx, cy, z, z + drum["h"], drum["r"] * 0.78, drum["r"] * 0.78, drum["sides"]), roles["body"],
                    tone=RECESS_TONE)
        rc = drum["r"] * 0.12
        for i in range(drum["sides"]):
            a = 2 * math.pi * i / drum["sides"]
            builder.add(column(cx + drum["r"] * 0.9 * math.cos(a), cy + drum["r"] * 0.9 * math.sin(a), z,
                               z + drum["h"], rc, 4), roles["trim"], tone=1.06, jitter=False, glow=flood)
        builder.add(cone(cx, cy, z + drum["h"] - 0.6 * k, z + drum["h"], drum["r"], drum["r"], drum["sides"]),
                    roles["trim"], tone=TRIM_TONE, glow=flood)
    else:
        sides = 6 if flags["simple"] else drum["sides"]
        builder.add(cone(cx, cy, z, z + drum["h"], drum["r"], drum["r"] * 0.96, sides), roles["body"], glow=flood)
    z += drum["h"]
    d = c["dome"]
    builder.add(dome(cx, cy, z, d["r"], d["h"], flags["dome_sides"], flags["dome_rings"]), roles["dome"], glow=flood)
    z += d["h"] * 0.92
    lantern = c["lantern"]
    if lantern["h"] > 0 and flags["simple"]:
        # Farthest level: the needle runs from the dome, as tall as lantern and needle together.
        builder.add(cone(cx, cy, z, z + lantern["h"] + c["finial"], lantern["r"], 0.0, 4), roles["dome"], tone=1.1)
        return
    if lantern["h"] > 0:
        builder.add(cone(cx, cy, z, z + lantern["h"], lantern["r"], lantern["r"] * 0.9, 6), roles["body"],
                    glow=flood)
        z += lantern["h"]
    builder.add(cone(cx, cy, z, z + c["finial"], lantern["r"] * 0.6, 0.0, 4), roles["dome"], tone=1.1)


def cupola_top(spec):
    """The finial tip's z (what the bounding box must reach)."""
    c = spec["cupola"]
    block = spec["blocks"][c["on"]]
    return (spec["land_top"] + block["h"] + block["attic"] + c.get("seat", 0.0) + c["base"]["h"] + c["drum"]["h"]
            + c["dome"]["h"] * 0.92 + c["lantern"]["h"] + c["finial"])
