"""Facade pieces the building archetypes share: window bands and floodlit trims.

Windows are bands of dark glass laid just proud of a wall, one quad per band, wound to face
out (the runtime culls back faces). At night a seeded share of them glows warm through the S04f
night-glow contract; by day they read as glass.
"""

from cclib import prim

PROUD = 0.15
WINDOW_TONE = 1.0
#: Share of window bands lit at night, and their glow as a fraction of the window colour.
LIT_SHARE = 0.72
GLOW_TONE = 0.8
FLOOD_TONE = 0.42


def floodlight(builder):
    return builder.colour("lamp", FLOOD_TONE)


def window_bands(builder, corners, z0, z1, rows, margin, rng_lit, share=0.55, column_pitch=None):
    """Window bands on every wall of a convex footprint `corners` [(x, y)] (counter-clockwise),
    `rows` bands between z0 and z1, inset `margin` from each wall's ends; each band fills `share`
    of its storey's height (less glass reads as masonry with punched windows). With
    `column_pitch`, each band is split into punched windows about that far apart."""
    if rows <= 0:
        return
    n = len(corners)
    pitch = (z1 - z0) / rows
    band = pitch * share
    glow = builder.colour("window", GLOW_TONE)
    for i in range(n):
        (ax, ay), (bx, by) = corners[i], corners[(i + 1) % n]
        length = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        if length <= 2 * margin + 1.0:
            continue
        ux, uy = (bx - ax) / length, (by - ay) / length
        # Outward normal of a counter-clockwise footprint edge.
        nx, ny = uy, -ux
        x0, y0 = ax + ux * margin + nx * PROUD, ay + uy * margin + ny * PROUD
        x1, y1 = bx - ux * margin + nx * PROUD, by - uy * margin + ny * PROUD
        usable = length - 2 * margin
        columns = 1 if column_pitch is None else max(1, int(round(usable / column_pitch)))
        step = usable / columns
        opening = step if columns == 1 else step * 0.55
        for r in range(rows):
            zb = z0 + r * pitch + (pitch - band) / 2
            for c in range(columns):
                t0 = c * step + (step - opening) / 2
                ax0, ay0 = x0 + ux * t0, y0 + uy * t0
                ax1, ay1 = ax0 + ux * opening, ay0 + uy * opening
                lit = rng_lit.random() < LIT_SHARE
                builder.add(prim.quad((ax0, ay0, zb), (ax1, ay1, zb), (ax1, ay1, zb + band), (ax0, ay0, zb + band),
                                      (nx, ny, 0.0)),
                            "glass", tone=WINDOW_TONE, jitter=False, glow=glow if lit else None)


def fins(builder, corners, z0, z1, count, margin, width, depth, role):
    """`count` vertical piers on each wall of a convex footprint, proud of the window bands: the
    vertical stripes of an Art Deco facade. Each is a closed box (12 triangles)."""
    if count <= 0:
        return
    n = len(corners)
    for i in range(n):
        (ax, ay), (bx, by) = corners[i], corners[(i + 1) % n]
        length = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        if length <= 2 * margin + width:
            continue
        ux, uy = (bx - ax) / length, (by - ay) / length
        nx, ny = uy, -ux
        for j in range(count):
            t = margin + (length - 2 * margin) * (j + 0.5) / count
            cx, cy = ax + ux * t, ay + uy * t
            hw = width / 2
            base = [(cx - ux * hw, cy - uy * hw), (cx + ux * hw, cy + uy * hw),
                    (cx + ux * hw + nx * depth, cy + uy * hw + ny * depth),
                    (cx - ux * hw + nx * depth, cy - uy * hw + ny * depth)]
            verts = [(x, y, z0) for x, y in base] + [(x, y, z1) for x, y in base]
            faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
            builder.add(prim.from_faces(verts, faces), role, tone=1.06, jitter=False)
