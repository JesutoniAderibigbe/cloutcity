"""Promenade archetype: a long raised boardwalk along a beach. A plank deck on rows of piles,
railings along both edges, benches, double rows of lamps (lit at night), generic roofed
shelters along it, the beach below on the sea side and an optional pier out over the water.
No rides, no signs, no text (LEGAL-1: copy never names rides or amusement brands, and the
model draws none).

Blender coordinates (z up) in map orientation (x east, y north, metres from the landmark's
location, heading 0), on `land_top`. The boardwalk runs along the compass `heading`; the sea
is on its right-hand side.

`spec`: length, width, deck height, heading, beach width, pier (offset along, length, width) or
None, piles (spacing), lamps (spacing), benches (spacing), shelters (count, width, depth,
height), detail.
"""

import math

from cclib import prim

LEVELS = {
    0: {"piles": 1.0, "lamps": 1.0, "benches": 1.0, "rails": True, "shelters": True, "pier": True},
    1: {"piles": 0.5, "lamps": 0.5, "benches": 0.0, "rails": True, "shelters": True, "pier": True},
    2: {"piles": 0.0, "lamps": 0.25, "benches": 0.0, "rails": False, "shelters": True, "pier": True},
    # The far level draws each shelter as one block: it still sets the model's top.
    3: {"piles": 0.0, "lamps": 0.0, "benches": 0.0, "rails": False, "shelters": "blocks", "pier": True},
}

#: The beach sheet sits this far above the land so it never fights the map.
BEACH_LIFT = 0.25


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    k = spec["detail"]
    z0 = spec["land_top"]
    t = math.radians(spec["heading"])
    ux, uy = math.sin(t), math.cos(t)
    rx, ry = uy, -ux  # to the right: the sea side

    def at(along, across, z=0.0):
        return (along * ux + across * rx, along * uy + across * ry, z)

    def box(a0, a1, c0, c1, z_lo, z_hi):
        corners = [at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)]
        verts = [(x, y, z_lo) for x, y, _ in corners] + [(x, y, z_hi) for x, y, _ in corners]
        faces = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        return prim.from_faces(verts, faces)

    half_l, half_w = spec["length"] / 2, spec["width"] / 2
    deck = z0 + spec["deck"]
    beach = spec["beach"]
    # The beach, from the boardwalk's sea edge out to the water line.
    b0, b1 = half_w, half_w + beach
    corners = [at(-half_l, b0), at(half_l, b0), at(half_l, b1), at(-half_l, b1)]
    builder.add(_flat(corners, z0 + BEACH_LIFT), "sand", jitter=False)
    # The deck: planks over a darker edge beam.
    builder.add(box(-half_l, half_l, -half_w, half_w, deck - 0.9 * k, deck), "wood-plank")
    builder.add(box(-half_l, half_l, -half_w, half_w, z0, deck - 0.9 * k), "stone", tone=0.75)
    if flags["rails"]:
        for c in (-half_w, half_w - 0.3 * k):
            builder.add(box(-half_l, half_l, c, c + 0.3 * k, deck, deck + 1.1 * k), "steel-dark", tone=0.9)
    piles = int(round(spec["length"] / spec["piles"] * flags["piles"] * density))
    for i in range(piles):
        a = -half_l + spec["length"] * (i + 0.5) / piles
        for c in (half_w + 0.2 * k, half_w - 2.0 * k):
            builder.add(box(a - 0.4 * k, a + 0.4 * k, c - 0.4 * k, c + 0.4 * k, z0, deck - 0.9 * k), "stone",
                        tone=0.85, jitter=False)
    benches = int(round(spec["length"] / spec["benches"] * flags["benches"] * density))
    for i in range(benches):
        a = -half_l + spec["length"] * (i + 0.5) / benches
        for c in (-half_w + 1.2 * k, half_w - 2.6 * k):
            builder.add(box(a - 1.4 * k, a + 1.4 * k, c, c + 1.0 * k, deck, deck + 0.6 * k), "wood-plank",
                        tone=0.8, jitter=False)
    lamps = int(round(spec["length"] / spec["lamps"] * flags["lamps"] * density))
    head = spec["lamp_head"]
    for i in range(lamps):
        a = -half_l + spec["length"] * (i + 0.5) / lamps
        for c in (-half_w + 0.8 * k, half_w - 0.8 * k):
            x, y, _ = at(a, c)
            builder.add(prim.box(x - 0.15 * k, x + 0.15 * k, y - 0.15 * k, y + 0.15 * k, deck, deck + 4.0 * k),
                        "steel-dark", jitter=False)
            builder.add(prim.diamond((x, y, deck + 4.0 * k + head / 2), head / 2), "lamp", group="windows",
                        jitter=False)
    if flags["shelters"]:
        sh = spec["shelters"]
        for i in range(sh["count"]):
            a = -half_l + spec["length"] * (i + 0.5) / sh["count"]
            top = deck + sh["height"]
            if flags["shelters"] == "blocks":
                builder.add(box(a - sh["width"] / 2, a + sh["width"] / 2, -sh["depth"] / 2, sh["depth"] / 2, deck, top),
                            "roof", tone=0.95)
                continue
            for c in (-sh["depth"] / 2 + 0.5 * k, sh["depth"] / 2 - 0.5 * k):
                for e in (-sh["width"] / 2 + 0.5 * k, sh["width"] / 2 - 0.5 * k):
                    builder.add(box(a + e - 0.3 * k, a + e + 0.3 * k, c - 0.3 * k, c + 0.3 * k, deck, top - 0.8 * k),
                                "steel-dark", tone=0.9, jitter=False)
            builder.add(box(a - sh["width"] / 2, a + sh["width"] / 2, -sh["depth"] / 2, sh["depth"] / 2,
                            top - 0.8 * k, top), "roof", tone=0.95)
    pier = spec.get("pier")
    if pier is not None and flags["pier"]:
        a = pier["along"]
        builder.add(box(a - pier["width"] / 2, a + pier["width"] / 2, half_w, half_w + pier["length"], deck - 0.9 * k,
                        deck), "wood-plank", tone=0.92)
        # The pier's substructure down to the sea (the water plane, y = 0).
        builder.add(box(a - pier["width"] / 2, a + pier["width"] / 2, half_w + beach, half_w + pier["length"], 0.0,
                        deck - 0.9 * k), "stone", tone=0.7)
    return builder


def _flat(corners, z):
    """A flat sheet facing up (seen only from above; the runtime culls back faces)."""
    a, b, c, d = [(x, y, z) for x, y, _ in corners]
    return prim.quad(a, b, c, d, (0.0, 0.0, 1.0))
