"""Station archetypes, generic and sign-free (LEGAL-1: no signage, no clock, no sculpture):

- `terminal`: a main hall with tall arched windows on its front, lower side wings, a low
  hipped roof and a cornice band; window bands on the walls.
- `concourse`: an optional hall with window bands, a canopy on supports along the front, and
  entrance pavilions (glass fronts, flat roofs) in a row.

Blender coordinates (z up), centred on the origin, the front facing +y (the game's -z),
standing on `land_top`. Lit windows and the canopy's underside lights glow at night.
"""

from archetypes import facade, setback
from cclib import curves, env, prim

LEVELS = {
    0: {"rows": 1.0, "trims": True, "arc": 8, "supports": 1.0, "chamfer": True},
    1: {"rows": 0.55, "trims": True, "arc": 5, "supports": 1.0, "chamfer": False},
    2: {"rows": 0.3, "trims": False, "arc": 3, "supports": 0.5, "chamfer": False},
    3: {"rows": 0.15, "trims": False, "arc": 1, "supports": 0.0, "chamfer": False},
}

TRIM_TONE = 1.1


def rect(x, y, w, d):
    return [(x - w / 2, y - d / 2), (x + w / 2, y - d / 2), (x + w / 2, y + d / 2), (x - w / 2, y + d / 2)]


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    if spec["kind"] == "terminal":
        _terminal(spec, flags, density, builder, level)
    else:
        _concourse(spec, flags, density, builder, level)
    return builder


def _block(builder, spec, corners, z0, z1, role, rows, flags, density, lit, chamfer_dim=None):
    k = spec["detail"]
    builder.add(setback.extrude(corners, z0, z1), role, chamfer_dim=chamfer_dim if flags["chamfer"] else None)
    n = int(round(rows * flags["rows"] * density))
    span = min(abs(corners[1][0] - corners[0][0]), abs(corners[2][1] - corners[1][1]))
    facade.window_bands(builder, corners, z0 + 2.0 * k, z1 - 2.0 * k, n, 0.12 * span, lit, share=0.4,
                        column_pitch=spec.get("window_pitch"))


def _cornice(builder, spec, x, y, w, d, z, role):
    k = spec["detail"]
    band = 1.4 * k
    builder.add(setback.extrude(rect(x, y, w + 1.2 * k, d + 1.2 * k), z - band, z), role, tone=TRIM_TONE,
                glow=facade.floodlight(builder))


def _terminal(spec, flags, density, builder, level):
    k = spec["detail"]
    z0 = spec["land_top"]
    lit = env.seeded_rng(spec["id"], "windows-L%d" % level)
    hall, wings = spec["hall"], spec["wings"]
    w, d, h = hall["width"], hall["depth"], hall["height"]
    _block(builder, spec, rect(0, 0, w, d), z0, z0 + h, spec["body"], hall["rows"], flags, density, lit, min(w, d))
    for side in (-1, 1):
        x = side * (w / 2 + wings["width"] / 2)
        y = -d / 2 + wings["depth"] / 2
        _block(builder, spec, rect(x, y, wings["width"], wings["depth"]), z0, z0 + wings["height"], spec["body"],
               wings["rows"], flags, density, lit)
        if flags["trims"]:
            _cornice(builder, spec, x, y, wings["width"], wings["depth"], z0 + wings["height"], spec["trim"])
    if flags["trims"]:
        _cornice(builder, spec, 0, 0, w, d, z0 + h, spec["trim"])
    # A low hipped roof: a frustum to a ridge.
    roof = spec["roof"]
    builder.add(prim.frustum(0, 0, z0 + h, z0 + h + roof, w, d, w * 0.55, d * 0.2), spec["roof_role"])
    # Tall arched windows on the front: dark glass panels with round heads, lit at night.
    arches = spec["arches"]
    pitch = w / (arches["count"] + 1)
    y = d / 2 + 0.15 * k
    glow = builder.colour("window", 0.7)
    segments = max(1, int(round(flags["arc"] * density)))
    for i in range(arches["count"]):
        cx = -w / 2 + pitch * (i + 1)
        half = arches["width"] / 2
        zb = z0 + 3.0 * k
        spring = z0 + arches["height"] - half
        builder.add(prim.quad((cx - half, y, zb), (cx + half, y, zb), (cx + half, y, spring), (cx - half, y, spring),
                              (0.0, 1.0, 0.0)), "glass", jitter=False, glow=glow)
        head, _rise = curves.pointed_arch(cx, half, spring, half, segments)
        verts = [(cx, y, spring)] + [(px, y, pz) for (px, pz) in head]
        faces = [(0, i + 1, i + 2) for i in range(len(head) - 1)]
        fan = prim.from_faces(verts, faces)
        for f in fan.faces:
            if f.normal.y < 0:
                f.normal_flip()
        builder.add(fan, "glass", jitter=False, glow=glow)


def _concourse(spec, flags, density, builder, level):
    k = spec["detail"]
    z0 = spec["land_top"]
    lit = env.seeded_rng(spec["id"], "windows-L%d" % level)
    front = 0.0
    hall = spec.get("hall")
    if hall is not None:
        y = -hall["depth"] / 2
        _block(builder, spec, rect(0, y, hall["width"], hall["depth"]), z0, z0 + hall["height"], spec["body"],
               hall["rows"], flags, density, lit, min(hall["width"], hall["depth"]))
        if flags["trims"]:
            _cornice(builder, spec, 0, y, hall["width"], hall["depth"], z0 + hall["height"], spec["trim"])
    canopy = spec["canopy"]
    cy = front + canopy["width"] / 2
    ch = z0 + canopy["height"]
    builder.add(prim.box(-canopy["length"] / 2, canopy["length"] / 2, cy - canopy["width"] / 2, cy + canopy["width"] / 2,
                         ch - canopy["thickness"], ch), spec["canopy_role"], glow=builder.colour("lamp", 0.3))
    supports = int(round(canopy["supports"] * flags["supports"]))
    post = 0.7 * k
    for i in range(supports):
        x = -canopy["length"] / 2 + canopy["length"] * (i + 0.5) / supports
        for yy in (cy - canopy["width"] / 2 + post, cy + canopy["width"] / 2 - post):
            builder.add(prim.box(x - post / 2, x + post / 2, yy - post / 2, yy + post / 2, z0, ch - canopy["thickness"]),
                        spec["canopy_role"], tone=0.85)
    pav = spec["pavilions"]
    count = pav["count"]
    for i in range(count):
        x = (i - (count - 1) / 2) * pav["spacing"]
        y = cy + canopy["width"] / 2 + pav["depth"] / 2
        builder.add(prim.box(x - pav["width"] / 2, x + pav["width"] / 2, y - pav["depth"] / 2, y + pav["depth"] / 2, z0,
                             z0 + pav["height"]), spec["body"], chamfer_dim=pav["width"] if flags["chamfer"] else None)
        # A glass front facing the street, lit at night, and a flat roof slab.
        gy = y + pav["depth"] / 2 + 0.15 * k
        gw = pav["width"] * 0.36
        builder.add(prim.quad((x - gw, gy, z0 + 1.0 * k), (x + gw, gy, z0 + 1.0 * k), (x + gw, gy, z0 + pav["height"] * 0.7),
                              (x - gw, gy, z0 + pav["height"] * 0.7), (0.0, 1.0, 0.0)), "glass", jitter=False,
                    glow=builder.colour("window", 0.7))
        if flags["trims"]:
            o = 0.8 * k
            builder.add(prim.box(x - pav["width"] / 2 - o, x + pav["width"] / 2 + o, y - pav["depth"] / 2 - o,
                                 y + pav["depth"] / 2 + o, z0 + pav["height"], z0 + pav["height"] + 0.8 * k),
                        spec["trim"], tone=TRIM_TONE, glow=facade.floodlight(builder))

