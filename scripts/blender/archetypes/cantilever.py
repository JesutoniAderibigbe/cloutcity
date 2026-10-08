"""Cantilever truss bridge archetype: masonry piers from the water with steel towers and
finials over them, two truss walls (top and bottom chords, verticals, diagonals) whose depth
peaks over the towers and dips mid-span and at the anchor piers, and a deck on the bottom chord.

Blender coordinates (z up); the axis runs along +y (s = y) from the first end (s = -half) to the
second; x is across. Water at z = 0, the land top at `land_top`, where the deck meets the ground.

`build(spec, level, view, density, builder)` adds one level's parts. `spec` (plain numbers
from a landmark script):

- `supports`: [{"s", "kind": "anchor" | "tower", "chord": truss depth there}] from end to end;
- `mid_chord`: truss depth mid-way between two supports (the cantilever arms meet there);
- `deck`: width, height (deck top at the supports), thickness;
- `truss`: x of the two walls, chord section, member width, target panel length;
- `pier`: plan (w, d) and top; `tower`: leg (w, d) and finial height; `detail`: trim scale.
"""

from cclib import curves, loft, ops, prim

LEVELS = {
    0: {"chamfer": True, "trims": True, "panels": 1.0, "diagonals": True, "fill": False, "chords": True,
        "necklace": 1.0, "simple": False},
    1: {"chamfer": True, "trims": False, "panels": 0.6, "diagonals": True, "fill": False, "chords": True,
        "necklace": 0.6, "simple": False},
    2: {"chamfer": False, "trims": False, "panels": 0.35, "diagonals": False, "fill": True, "chords": True,
        "necklace": 0.3, "simple": False},
    3: {"chamfer": False, "trims": False, "panels": 0.0, "diagonals": False, "fill": True, "chords": "top",
        "necklace": 0.0, "simple": True},
}

TRIM_TONE = 1.1
PLINTH_TONE = 0.82
FILL_TONE = 0.8
FLOOD_TONE = 0.42
UPLIGHT_TONE = 0.24
NECKLACE_SCALE = 1.3


def floodlight(builder):
    return builder.colour("lamp", FLOOD_TONE)


def uplight(builder):
    return builder.colour("lamp", UPLIGHT_TONE)


def deck_profile(spec):
    """[(s, z)] of the deck top: the land top at the ends, level across the supports."""
    first, last = spec["supports"][0]["s"], spec["supports"][-1]["s"]
    z = spec["deck"]["height"]
    return [(-spec["half"], spec["land_top"]), (first, z), (last, z), (spec["half"], spec["land_top"])]


def chord_stations(spec, panel):
    """Panel points [(s, depth)] along the truss: every support, and evenly between them, the
    depth falling parabolically from each support's to `mid_chord` mid-way."""
    points = []
    supports = spec["supports"]
    for a, b in zip(supports, supports[1:]):
        length = b["s"] - a["s"]
        count = max(2, int(round(length / panel)))
        for i in range(count):
            u = i / count
            ends = a["chord"] + (b["chord"] - a["chord"]) * u
            dip = (ends - spec["mid_chord"]) * 4.0 * u * (1.0 - u)
            points.append((a["s"] + length * u, max(spec["mid_chord"], ends - dip)))
    points.append((supports[-1]["s"], supports[-1]["chord"]))
    return points


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    profile = deck_profile(spec)
    for support in spec["supports"]:
        _pier(spec, support, flags, builder)
    _deck(spec, profile, builder)
    panel = spec["truss"]["panel"] / max(flags["panels"] * density, 1e-3) if flags["panels"] > 0 else None
    stations = chord_stations(spec, panel if panel is not None else 1e9)
    _truss(spec, stations, flags, builder)
    if flags["necklace"] > 0:
        _necklace(spec, stations, flags["necklace"] * density, view, builder)
    return builder


def _pier(spec, support, flags, builder):
    k = spec["detail"]
    pw, pd = spec["pier"]["plan"]
    top = spec["pier"]["top"]
    s = support["s"]
    chamfer = flags["chamfer"]
    deck = spec["deck"]
    builder.add(prim.frustum(0, s, 0, top, pw, pd, pw - 1.0 * k, pd - 1.0 * k), "granite",
                chamfer_dim=min(pw, pd) if chamfer else None, glow=uplight(builder))
    if flags["trims"]:
        builder.add(prim.frustum(0, s, 0, 3.0 * k, pw + 2.0 * k, pd + 2.0 * k, pw + 1.4 * k, pd + 1.4 * k),
                    "granite", tone=PLINTH_TONE)
    if support["kind"] != "tower":
        return
    if flags["simple"]:
        xs = spec["truss"]["xs"]
        leg_d = spec["tower"]["leg"][1]
        top_z = deck["height"] + support["chord"] + spec["tower"]["finial"]
        builder.add(prim.box(min(xs) - leg_d / 2, max(xs) + leg_d / 2, s - leg_d / 2, s + leg_d / 2, top, top_z),
                    metal(spec), glow=uplight(builder))
        return
    # The steel tower over a pier: a leg up each truss wall to the top chord, a finial above.
    leg_w, leg_d = spec["tower"]["leg"]
    chord_top = deck["height"] + support["chord"]
    finial = spec["tower"]["finial"]
    for x in spec["truss"]["xs"]:
        builder.add(prim.frustum(x, s, top, chord_top, leg_w, leg_d, leg_w * 0.8, leg_d * 0.85), metal(spec),
                    chamfer_dim=min(leg_w, leg_d) if chamfer else None, glow=uplight(builder))
        builder.add(prim.frustum(x, s, chord_top, chord_top + finial, leg_w * 0.9, leg_d * 0.9, leg_w * 0.2,
                                 leg_d * 0.2), metal(spec), tone=TRIM_TONE, glow=floodlight(builder))
    xs = spec["truss"]["xs"]
    beam = 2.4 * k
    builder.add(prim.box(min(xs), max(xs), s - leg_d / 2, s + leg_d / 2, chord_top - beam, chord_top), metal(spec),
                tone=TRIM_TONE, glow=floodlight(builder))


def _deck(spec, profile, builder):
    deck = spec["deck"]
    k = spec["detail"]
    half_w = deck["width"] / 2

    def sweep(section, role, tone=1.0):
        path = [(0.0, s, z) for (s, z) in profile]
        builder.add(loft.sweep(path, section, caps=True), role, tone=tone)

    sweep(_rect(-half_w, half_w, -deck["thickness"], -0.4 * k), "steel-dark")
    sweep(_rect(-half_w + 1.0 * k, half_w - 1.0 * k, -0.4 * k, 0.0), "asphalt")


def _rect(x0, x1, z0, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def _truss(spec, stations, flags, builder):
    truss = spec["truss"]
    deck_z = spec["deck"]["height"]
    c = truss["chord"]
    member = truss["member"]
    for x in truss["xs"]:
        bottom = [(x, s, deck_z) for (s, _d) in stations]
        top = [(x, s, deck_z + d) for (s, d) in stations]
        section = [(-c / 2, -c / 2), (c / 2, -c / 2), (c / 2, c / 2), (-c / 2, c / 2)]
        if flags["chords"] is True:
            builder.add(loft.sweep(bottom, section, caps=True), metal(spec))
        if flags["chords"]:
            builder.add(loft.sweep(top, section, caps=True), metal(spec), tone=TRIM_TONE)
        if flags["fill"]:
            # Far levels: the truss wall as a darker solid band, which is how a lattice reads.
            builder.add(prim.quad_strip(bottom, top), metal(spec), tone=FILL_TONE, jitter=False)
        if flags["panels"] <= 0 or flags["fill"]:
            continue
        for i, ((s0, d0), (s1, d1)) in enumerate(zip(stations, stations[1:])):
            builder.add(_member((x, s0, deck_z), (x, s0, deck_z + d0), member), metal(spec), tone=0.95, jitter=False)
            if flags["diagonals"]:
                a, b = ((x, s0, deck_z), (x, s1, deck_z + d1)) if i % 2 == 0 else ((x, s0, deck_z + d0), (x, s1, deck_z))
                builder.add(_member(a, b, member), metal(spec), tone=0.9, jitter=False)


def _member(a, b, width):
    """A truss member: an open square tube from a to b (its ends hide in the chords)."""
    along = ops.norm(ops.sub(b, a))
    side = ops.cross(along, (1.0, 0.0, 0.0))
    if ops.dot(side, side) < 1e-9:
        side = (0.0, 1.0, 0.0)
    return loft.sweep([a, b], [(-width / 2, -width / 2), (width / 2, -width / 2), (width / 2, width / 2),
                               (-width / 2, width / 2)], up_hint=(1.0, 0.0, 0.0))


def _necklace(spec, stations, density, view, builder):
    """Lights along the top chords, the bridge's night outline (8-triangle diamonds)."""
    size = spec["lamp"]["head"] * NECKLACE_SCALE
    if not view.shows(size):
        return
    spacing = spec["lamp"]["necklace_spacing"] / max(density, 1e-3)
    deck_z = spec["deck"]["height"]
    lift = spec["truss"]["chord"] / 2 + size / 2
    s0, s1 = stations[0][0], stations[-1][0]
    count = int((s1 - s0) / spacing)
    for x in spec["truss"]["xs"]:
        for i in range(1, count):
            s = s0 + i * spacing
            depth = curves.profile_at(stations, s)
            builder.add(prim.diamond((x, s, deck_z + depth + lift), size / 2), "lamp", group="windows", jitter=False)


def metal(spec):
    return spec.get("metal", "steel")

