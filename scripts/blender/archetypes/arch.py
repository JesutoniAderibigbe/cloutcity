"""Triumphal arch archetype: two piers carrying a round (or pointed) arch, an entablature band,
an attic with a cornice, darker panels on the pier faces where sculpture would stand (plain:
no figures, no inscription), on a low plinth.

Blender coordinates (z up), centred on the origin, the arch's faces looking along y (+y the
front), standing on `land_top`. `spec`: width, depth, height, opening (width, height to the
crown), entablature and attic heights, plinth height, detail, role.
"""

from cclib import curves, prim

LEVELS = {
    0: {"arc": 14, "trims": True, "panels": True, "chamfer": True, "courses": 5, "plinth": True, "cornice": True},
    1: {"arc": 9, "trims": True, "panels": True, "chamfer": False, "courses": 2, "plinth": True, "cornice": True},
    2: {"arc": 5, "trims": False, "panels": False, "chamfer": False, "courses": 0, "plinth": True, "cornice": True},
    3: {"arc": 2, "trims": False, "panels": False, "chamfer": False, "courses": 0, "plinth": False, "cornice": False},
}

TRIM_TONE = 1.08
PANEL_TONE = 0.8
#: The marble's night floodlight (the lamp colour at this sRGB fraction).
FLOOD_TONE = 0.34


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    k = spec["detail"]
    role = spec["role"]
    glow = builder.colour("lamp", FLOOD_TONE)
    z0 = spec["land_top"]
    w, d, h = spec["width"], spec["depth"], spec["height"]
    ow, oh = spec["opening"]["width"], spec["opening"]["height"]
    plinth = spec["plinth"]
    entab, attic = spec["entablature"], spec["attic"]
    body_top = z0 + h - attic
    if flags["plinth"]:
        builder.add(prim.box(-w / 2 - 1.0 * k, w / 2 + 1.0 * k, -d / 2 - 1.0 * k, d / 2 + 1.0 * k, z0, z0 + plinth),
                    role, tone=0.94, glow=glow)
    spring = z0 + oh - ow / 2
    pier = (w - ow) / 2
    for side in (-1, 1):
        x0, x1 = sorted((side * w / 2, side * ow / 2))
        builder.add(prim.box(x0, x1, -d / 2, d / 2, z0 + plinth, spring), role, glow=glow,
                    chamfer_dim=min(pier, d) if flags["chamfer"] else None)
    segments = max(2, int(round(flags["arc"] * density)))
    arc, _rise = curves.pointed_arch(0.0, ow / 2, 0.0, ow / 2, segments)
    outline = [(-w / 2, spring)] + [(px, spring + pz) for (px, pz) in arc] + [(w / 2, spring), (w / 2, body_top),
                                                                           (-w / 2, body_top)]
    builder.add_toned(prim.prism_xz(outline, -d / 2, d / 2), role,
                      lambda c, n: PANEL_TONE if (abs(c[0]) < ow / 2 and abs(n[1]) < 0.5) else 1.0, glow=glow)
    if flags["trims"]:
        band = entab
        o = 0.5 * k
        builder.add(prim.box(-w / 2 - o, w / 2 + o, -d / 2 - o, d / 2 + o, body_top - band, body_top), role,
                    tone=TRIM_TONE, glow=glow)
        builder.add(prim.box(-w / 2 - o, w / 2 + o, -d / 2 - o, d / 2 + o, spring - 0.8 * k, spring), role,
                    tone=TRIM_TONE, glow=glow)
    cornice = 1.0 * k if flags["cornice"] else 0.0
    builder.add(prim.box(-w / 2, w / 2, -d / 2, d / 2, body_top, z0 + h - cornice), role, tone=0.97, glow=glow)
    if flags["cornice"]:
        builder.add(prim.box(-w / 2 - 0.6 * k, w / 2 + 0.6 * k, -d / 2 - 0.6 * k, d / 2 + 0.6 * k, z0 + h - cornice,
                             z0 + h), role, tone=TRIM_TONE, glow=glow)
    courses = int(round(flags["courses"] * density))
    for side in (-1, 1):
        x0, x1 = sorted((side * w / 2, side * ow / 2))
        for i in range(courses):
            # Rusticated courses: thin proud bands up the lower piers.
            zc = z0 + plinth + (spring - z0 - plinth) * (i + 1) / (courses + 1)
            o = 0.15 * k
            builder.add(prim.box(x0 - o, x1 + o, -d / 2 - o, d / 2 + o, zc - 0.25 * k, zc + 0.25 * k), role,
                        tone=0.9, glow=glow)
    if flags["panels"]:
        # Plain darker panels on each pier face, where the real arch carries sculpture.
        for side in (-1, 1):
            cx = side * (ow / 2 + pier / 2)
            for face in (-1, 1):
                y = face * (d / 2 + 0.1 * k)
                builder.add(prim.quad((cx - pier * 0.32, y, z0 + plinth + 1.5 * k), (cx + pier * 0.32, y,
                                      z0 + plinth + 1.5 * k), (cx + pier * 0.32, y, spring - 2.0 * k),
                                      (cx - pier * 0.32, y, spring - 2.0 * k), (0.0, face, 0.0)), role,
                            tone=PANEL_TONE, glow=glow)
    return builder
