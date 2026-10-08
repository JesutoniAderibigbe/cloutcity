"""Neighbourhood archetype: a small composed district. Plaza slabs, a set of blocks with window
bands, plain colour screen panels on chosen walls (generic: never text, logos or brands;
LEGAL-1), and optional stepped stands.

Blender coordinates (z up), centred on the origin, north +y, standing on `land_top`.
`spec` (plain numbers from a landmark script):

- `plazas`: [{"outline": [(x, y)], "role", "tone"}], slabs `plaza_thickness` thick;
- `blocks`: [{"x", "y", "w", "d", "h", "role", "rows", "screens": [{"wall": 0-3, "z0", "z1",
  "share", "role"}], optional "glass_share" and "window_pitch" (punched windows), "cap" (a
  pyramid roof of that height), "glow" (a whole glass block lit at night), "roof" (a dark roof
  slab), "tone"}]; walls are 0 south,
  1 east, 2 north, 3 west;
- `stands`: [{"x", "y", "w", "d", "h", "steps", "role", "facing": +1 north / -1 south}];
- `boards`: rooftop screens [{"x", "y", "z0", "w", "h", "facing": (nx, ny), "role"}]: a dark frame
  with a plain colour screen on its front, tilted back so it shows from above;
- `detail`: trim scale.

Screens glow in their own colour at night (the S04f night-glow contract); windows glow in a
seeded share.
"""

from archetypes import facade, setback
from cclib import env, prim

LEVELS = {
    0: {"rows": 1.0, "screens": 9, "boards": True, "stands": True, "plazas": True, "trims": True},
    1: {"rows": 0.55, "screens": 9, "boards": True, "stands": True, "plazas": True, "trims": True},
    2: {"rows": 0.25, "screens": 9, "boards": True, "stands": True, "plazas": True, "trims": False},
    # The far level keeps each block's first (largest) screen: they are what reads from afar.
    3: {"rows": 0.12, "screens": 1, "boards": False, "stands": False, "plazas": False, "trims": False},
}

TRIM_TONE = 1.08


def rect(x, y, w, d):
    return [(x - w / 2, y - d / 2), (x + w / 2, y - d / 2), (x + w / 2, y + d / 2), (x - w / 2, y + d / 2)]


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    k = spec["detail"]
    z0 = spec["land_top"]
    lit = env.seeded_rng(spec["id"], "windows-L%d" % level)
    if flags["plazas"]:
        for plaza in spec["plazas"]:
            builder.add(setback.extrude(plaza["outline"], z0, z0 + spec["plaza_thickness"]), plaza["role"],
                        tone=plaza.get("tone", 1.0))
    for block in spec["blocks"]:
        corners = rect(block["x"], block["y"], block["w"], block["d"])
        top = z0 + block["h"]
        light = builder.colour(block["role"], 0.6) if block.get("glow") else None
        builder.add(setback.extrude(corners, z0, top), block["role"], tone=block.get("tone", 1.0), glow=light)
        if flags["trims"] and block.get("roof"):
            # A dark roof slab inside the parapet: flat city roofs read tar-dark from above.
            inset = rect(block["x"], block["y"], block["w"] - 2.0 * k, block["d"] - 2.0 * k)
            builder.add(setback.extrude(inset, top, top + 0.3 * k), "roof", tone=0.8)
        if block.get("cap"):
            builder.add(prim.frustum(block["x"], block["y"], top, top + block["cap"], block["w"], block["d"],
                                     block["w"] * 0.08, block["d"] * 0.08), "roof")
        if flags["trims"]:
            band = 1.4 * k
            grown = rect(block["x"], block["y"], block["w"] + 1.0 * k, block["d"] + 1.0 * k)
            builder.add(setback.extrude(grown, top - band, top), block["role"], tone=TRIM_TONE,
                        glow=facade.floodlight(builder))
        rows = int(round(block["rows"] * flags["rows"] * density))
        facade.window_bands(builder, corners, z0 + 4.0 * k, top - 3.0 * k, rows, 0.1 * min(block["w"], block["d"]),
                            lit, share=block.get("glass_share", 0.55), column_pitch=block.get("window_pitch"))
        for screen in block.get("screens", [])[:flags["screens"]]:
            _screen(builder, corners, screen, z0, k)
    if flags["stands"]:
        for stand in spec.get("stands", []):
            _stand(builder, stand, z0)
    if flags["boards"]:
        for board in spec.get("boards", []):
            _board(builder, board, z0, k)
    return builder


#: Rooftop screens lean back by this share of their height, so the camera (polar 48°) sees them.
BOARD_LEAN = 0.35


def _board(builder, board, z0, k):
    nx, ny = board["facing"]
    ux, uy = -ny, nx
    hw = board["w"] / 2
    lean = board["h"] * BOARD_LEAN
    za, zb = z0 + board["z0"], z0 + board["z0"] + board["h"]
    bx, by = board["x"], board["y"]
    a = (bx - ux * hw, by - uy * hw, za)
    b = (bx + ux * hw, by + uy * hw, za)
    c = (bx + ux * hw - nx * lean, by + uy * hw - ny * lean, zb)
    d = (bx - ux * hw - nx * lean, by - uy * hw - ny * lean, zb)
    t = 0.8 * k
    back = [(p[0] - nx * t, p[1] - ny * t, p[2]) for p in (a, b, c, d)]
    verts = [a, b, c, d] + back
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (4, 5, 1, 0), (5, 6, 2, 1), (6, 7, 3, 2), (7, 4, 0, 3)]
    builder.add(prim.from_faces(verts, faces), "steel-dark", jitter=False)
    inset = 0.06
    def mix(p, q, f):
        return tuple(p[i] + (q[i] - p[i]) * f for i in range(3))
    face = [mix(a, c, inset), mix(b, d, inset), mix(c, a, inset), mix(d, b, inset)]
    face = [(p[0] + nx * 0.15 * k, p[1] + ny * 0.15 * k, p[2]) for p in face]
    normal = (nx, ny, lean / board["h"])
    builder.add(prim.quad(face[0], face[1], face[2], face[3], normal), board["role"], group="windows", jitter=False)


def _screen(builder, corners, screen, z0, k):
    """A plain colour panel proud of one wall, lit day and night (no text, no logos)."""
    (ax, ay), (bx, by) = corners[screen["wall"]], corners[(screen["wall"] + 1) % 4]
    length = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
    ux, uy = (bx - ax) / length, (by - ay) / length
    nx, ny = uy, -ux
    proud = 0.6 * k
    inset = length * (1.0 - screen["share"]) / 2
    x0, y0 = ax + ux * inset + nx * proud, ay + uy * inset + ny * proud
    x1, y1 = bx - ux * inset + nx * proud, by - uy * inset + ny * proud
    za, zb = z0 + screen["z0"], z0 + screen["z1"]
    builder.add(prim.quad((x0, y0, za), (x1, y1, za), (x1, y1, zb), (x0, y0, zb), (nx, ny, 0.0)), screen["role"],
                group="windows", jitter=False)


def _stand(builder, stand, z0):
    """Stepped stands: `steps` boxes, each shorter and set back, rising toward `facing`."""
    n = stand["steps"]
    for i in range(n):
        depth = stand["d"] * (n - i) / n
        y = stand["y"] - stand["facing"] * (stand["d"] - depth) / 2
        h = stand["h"] * (i + 1) / n
        builder.add(setback.extrude(rect(stand["x"], y, stand["w"], depth), z0 + h - stand["h"] / n, z0 + h),
                    stand["role"], tone=1.0 + 0.03 * (i % 2))
