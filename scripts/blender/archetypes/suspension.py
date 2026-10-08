"""Suspension bridge archetype: masonry towers with pointed-arch openings on piers from the
water, a deck with an optional raised central promenade, main cables over saddles to
anchorages, suspenders and a web of diagonal stays, and lamps along the promenade.

Blender coordinates (z up). The axis runs along +y: s = y, from the first end (s = -half) to
the second (s = +half); x is across the deck. The water plane is z = 0 and the land top is
`land_top`, where the deck meets the ground at both ends.

`build(spec, level, view, density, builder)` adds one level's parts. `spec` is plain numbers
(prepared by a landmark script from its measurements; `spec["detail"]` scales the fixed trims,
bands and railings with the model's game scale); `view` is the level's camera view
(cclib.camera_aware.View); `density` (<= 2) scales counts so the level fits its budget.
"""

import math

from cclib import curves, loft, prim

#: What each level draws. Finer levels add chamfers, trims, members and lamps.
LEVELS = {
    0: {"chamfer": True, "trims": True, "plinth": True, "cable_sides": 6, "cables": "all", "suspenders": 1.0,
        "stays": 1.0, "lamps": 1.0, "necklace": 1.0, "deck": "full", "arch_hi": 10},
    1: {"chamfer": True, "trims": True, "plinth": True, "cable_sides": 4, "cables": "all", "suspenders": 0.5,
        "stays": 0.5, "lamps": 0.5, "necklace": 0.6, "deck": "full", "arch_hi": 5},
    2: {"chamfer": False, "trims": False, "plinth": False, "cable_sides": 3, "cables": "all", "suspenders": 0.3,
        "stays": 0.25, "lamps": 0.0, "necklace": 0.35, "deck": "simple", "arch_hi": 2},
    3: {"chamfer": False, "trims": False, "plinth": False, "cable_sides": 3, "cables": "outer", "suspenders": 0.0,
        "stays": 0.0, "lamps": 0.0, "necklace": 0.0, "deck": "slab", "arch_hi": 1},
}

ARCH_SOFFIT_TONE = 0.52
TRIM_TONE = 1.1
PLINTH_TONE = 0.82
UNDERSIDE_TONE = 0.75
#: Girder railing and promenade railing heights above their deck, real metres (x `detail`).
RAIL_M = 1.5
PROMENADE_RAIL_M = 1.1


def deck_profile(spec, view, density):
    """[(s, z)] of the deck top from the first end to the second."""
    t0, t1 = spec["towers"]
    deck = spec["deck"]
    rise = deck["mid"] - deck["road_at_towers"]
    segments = view.parabola_segments(abs(rise), lo=2, hi=16, density=density) if rise > 0 else 1
    main = curves.crowned_span(t0, t1, deck["road_at_towers"], deck["mid"], segments)
    return [(-spec["half"], spec["land_top"])] + main + [(spec["half"], spec["land_top"])]


def build(spec, level, view, density, builder):
    flags = LEVELS[level]
    profile = deck_profile(spec, view, density)
    for s in spec["towers"]:
        _tower(spec, s, flags, view, density, builder)
    _anchorages(spec, profile, flags, builder)
    _deck(spec, profile, flags, builder)
    cable_paths = _cables(spec, profile, flags, view, density, builder)
    if flags["suspenders"] > 0:
        _suspenders(spec, profile, cable_paths, flags["suspenders"] * density, view, builder)
    if flags["stays"] > 0:
        _stays(spec, profile, flags["stays"] * density, view, builder)
    if flags["lamps"] > 0:
        _lamps(spec, profile, flags["lamps"] * density, view, builder)
    if flags["necklace"] > 0:
        _necklace(spec, profile, flags["necklace"] * density, view, builder)
    return builder


# ---- towers --------------------------------------------------------------------------------


def _tower(spec, s, flags, view, density, builder):
    t = spec["tower"]
    deck = spec["deck"]
    chamfer = flags["chamfer"]
    (w_water, d_water), (w_road, d_road), (w_corn, d_corn) = t["water"], t["road"], t["cornice"]
    road_bottom = deck["road_at_towers"] - deck["thickness"]
    k = spec["detail"]

    def dim(w, d):
        return min(w, d) if chamfer else None

    # The pier and lower tower, battering from the water to the roadway.
    builder.add(prim.frustum(0, s, 0, road_bottom, w_water, d_water, w_road, d_road), "granite", chamfer_dim=dim(w_road, d_road))
    if flags["plinth"]:
        builder.add(
            prim.frustum(0, s, 0, t["plinth_h"], w_water + 2.4 * k, d_water + 2.4 * k, w_water + 1.6 * k, d_water + 1.6 * k),
            "granite",
            tone=PLINTH_TONE,
            chamfer_dim=dim(w_water, d_water),
        )
    if flags["trims"]:
        # A string course part-way up the pier, where the batter is interpolated.
        f = 0.45
        zc = road_bottom * f
        wc, dc = w_water + (w_road - w_water) * f + 0.8 * k, d_water + (d_road - d_water) * f + 0.8 * k
        builder.add(prim.box(-wc / 2, wc / 2, s - dc / 2, s + dc / 2, zc - 0.6 * k, zc + 0.6 * k), "granite",
                    tone=TRIM_TONE, chamfer_dim=1.2 * k if chamfer else None)
        band = 1.4 * k
        builder.add(
            prim.box(-w_road / 2 - 0.5 * k, w_road / 2 + 0.5 * k, s - d_road / 2 - 0.5 * k, s + d_road / 2 + 0.5 * k,
                     road_bottom - band, road_bottom),
            "granite",
            tone=TRIM_TONE,
            chamfer_dim=band if chamfer else None,
        )

    # Above the roadway: three columns, the arched spandrel, the cornice and the top.
    openings = t["openings"]
    span = t["arch_span"]
    half_span = span / 2
    apex = t["arch_apex"]
    corner_base = t["cornice_base"]
    w_up = (w_road + w_corn) / 2
    d_up = (d_road + d_corn) / 2
    column_total = w_up - openings * span
    outer_column = column_total * 0.36 if openings == 2 else column_total / 2
    centres = []
    x = -w_up / 2 + outer_column
    for _ in range(openings):
        centres.append(x + half_span)
        x += span + (column_total - 2 * outer_column) / max(1, openings - 1)

    offset = t["arch_radius"] - half_span
    arc_angle = math.atan2(math.sqrt(t["arch_radius"] ** 2 - offset ** 2), offset)
    arch_segments = view.arc_segments(t["arch_radius"], arc_angle, lo=1, hi=flags["arch_hi"], density=density)
    sample, rise = curves.pointed_arch(0.0, half_span, 0.0, t["arch_radius"], arch_segments)
    spring = apex - rise

    edges = [-w_up / 2] + [c for cx in centres for c in (cx - half_span, cx + half_span)] + [w_up / 2]
    for i in range(0, len(edges), 2):
        x0, x1 = edges[i], edges[i + 1]
        builder.add(prim.box(x0, x1, s - d_up / 2, s + d_up / 2, road_bottom, spring), "granite",
                    chamfer_dim=min(x1 - x0, d_up) if chamfer else None)

    outline = [(-w_up / 2, spring)]
    for cx in centres:
        outline.extend((cx + px, spring + pz) for (px, pz) in sample)
    outline.extend([(w_up / 2, spring), (w_up / 2, corner_base), (-w_up / 2, corner_base)])
    spandrel = prim.prism_xz(outline, s - d_up / 2, s + d_up / 2)
    builder.add_toned(spandrel, "granite", lambda c, n: ARCH_SOFFIT_TONE if (abs(c[0]) < w_up / 2 - 0.05 and c[2] < corner_base - 0.05 and abs(n[1]) < 0.5) else 1.0)

    if flags["trims"]:
        _panels(s, edges, d_up, w_up, road_bottom, spring, corner_base, k, builder)
        impost = 1.0 * k
        o = 0.35 * k
        for i in range(0, len(edges), 2):
            x0, x1 = edges[i], edges[i + 1]
            builder.add(prim.box(x0 - o, x1 + o, s - d_up / 2 - o, s + d_up / 2 + o, spring - impost, spring),
                        "granite", tone=TRIM_TONE, chamfer_dim=impost if chamfer else None)
    # Cornice: an overhanging band, then the top block.
    over = 0.9 * k if flags["trims"] else 0.0
    band = 2.2 * k
    builder.add(prim.box(-w_corn / 2 - over, w_corn / 2 + over, s - d_corn / 2 - over, s + d_corn / 2 + over, corner_base, corner_base + band),
                "granite", tone=TRIM_TONE if flags["trims"] else 1.0, chamfer_dim=band if chamfer else None)
    builder.add(prim.box(-w_corn / 2, w_corn / 2, s - d_corn / 2, s + d_corn / 2, corner_base + band, t["top"]),
                "granite", chamfer_dim=min(t["top"] - corner_base - band, d_corn) if chamfer else None)


PANEL_TONE = 0.66
PANEL_PROUD = 0.12


def _panels(s, edges, d_up, w_up, z0, spring, cornice, k, builder):
    """Recessed panels on the columns' faces: a dark quad just proud of the stone reads as a
    deep recess (in the stone's own shadow) for 2 triangles each."""
    proud = PANEL_PROUD * k
    margin = 3.0 * k
    for i in range(0, len(edges), 2):
        x0, x1 = edges[i], edges[i + 1]
        inset = 0.2 * (x1 - x0)
        for side in (-1, 1):
            y = s + side * (d_up / 2 + proud)
            builder.add(prim.quad((x0 + inset, y, z0 + margin), (x1 - inset, y, z0 + margin),
                                  (x1 - inset, y, spring - margin), (x0 + inset, y, spring - margin)),
                        "granite", tone=PANEL_TONE)
    edge = 0.15 * d_up
    for side in (-1, 1):
        x = side * (w_up / 2 + proud)
        builder.add(prim.quad((x, s - d_up / 2 + edge, z0 + margin), (x, s + d_up / 2 - edge, z0 + margin),
                              (x, s + d_up / 2 - edge, cornice - margin), (x, s - d_up / 2 + edge, cornice - margin)),
                    "granite", tone=PANEL_TONE)


# ---- anchorages ----------------------------------------------------------------------------


def _anchorages(spec, profile, flags, builder):
    a = spec["anchorage"]
    deck = spec["deck"]
    for s_anchor, direction in zip(a["s"], (-1, 1)):
        z_deck = curves.profile_at(profile, s_anchor)
        base = max(0.0, spec["land_top"] - 6.0 * spec["detail"])
        top = z_deck - deck["thickness"]
        s0, s1 = sorted((s_anchor, s_anchor + direction * a["depth"]))
        builder.add(prim.box(-a["width"] / 2, a["width"] / 2, s0, s1, base, top), "granite",
                    chamfer_dim=min(a["width"], a["depth"]) if flags["chamfer"] else None)
        if flags["trims"]:
            # Masonry ears either side of the deck, where the outer cables enter.
            k = spec["detail"]
            ear = (a["width"] - deck["width"]) / 2 - 0.5 * k
            for side in (-1, 1):
                xa = side * (deck["width"] / 2 + 0.5 * k)
                xb = side * (a["width"] / 2)
                builder.add(prim.box(min(xa, xb), max(xa, xb), s0, s1, top, z_deck + 3.0 * k), "granite",
                            tone=TRIM_TONE,
                            chamfer_dim=ear if flags["chamfer"] else None)


# ---- deck ----------------------------------------------------------------------------------


def _sweep_profile(profile, section, x_offset=0.0):
    path = [(x_offset, s, z) for (s, z) in profile]
    return loft.sweep(path, section, caps=True)


def _rect(x0, x1, z0, z1):
    """A rectangle section in (side, up); for a path along +y, side is +x and up is +z."""
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def _deck(spec, profile, flags, builder):
    deck = spec["deck"]
    half_w = deck["width"] / 2
    thick = deck["thickness"]
    k = spec["detail"]
    girder = 1.0 * k
    if flags["deck"] == "slab":
        builder.add(_sweep_profile(profile, _rect(-half_w, half_w, -thick, 0.0)), "bridge-tan")
        builder.add(_sweep_profile(profile, _rect(-half_w + girder, half_w - girder, -0.2 * k, 0.15 * k)), "asphalt")
        return
    builder.add(_sweep_profile(profile, _rect(-half_w, half_w, -thick, -0.4 * k)), "steel-dark")
    prom = deck["promenade"]
    inner = prom["width"] / 2 + 0.6 * k
    for side in (-1, 1):
        x0, x1 = sorted((side * inner, side * (half_w - girder)))
        builder.add(_sweep_profile(profile, _rect(x0, x1, -0.4 * k, 0.0)), "asphalt")
        # Outer stiffening trusses, read as a girder with a railing above the roadway.
        g0, g1 = sorted((side * (half_w - girder), side * half_w))
        builder.add(_sweep_profile(profile, _rect(g0, g1, -thick - 0.6 * k, RAIL_M * k)), "bridge-tan")
    if flags["deck"] == "simple":
        builder.add(_sweep_profile(profile, _rect(-inner, inner, -0.4 * k, prom["height"])), "wood-plank")
        return
    # The raised promenade on its inner trusses, between the two inner cables.
    for side in (-1, 1):
        x0, x1 = sorted((side * prom["width"] / 2, side * inner))
        builder.add(_sweep_profile(profile, _rect(x0, x1, -0.4 * k, prom["height"] + PROMENADE_RAIL_M * k)), "bridge-tan")
    builder.add(_sweep_profile(profile, _rect(-prom["width"] / 2, prom["width"] / 2, prom["height"] - 0.5 * k,
                                              prom["height"])), "wood-plank")


# ---- cables, suspenders, stays, lamps -----------------------------------------------------


def _cable_xs(spec, flags):
    xs = spec["cables"]["xs"]
    if flags["cables"] == "outer":
        return [x for x in xs if abs(x) == max(abs(v) for v in xs)]
    return xs


def cable_z(spec, profile, s):
    """Height of the main cables at axis position s."""
    t0, t1 = spec["towers"]
    c = spec["cables"]
    a0, a1 = spec["anchorage"]["s"]
    if t0 <= s <= t1:
        u = (s - t0) / (t1 - t0)
        low = spec["deck"]["mid"] + c["low_above_deck"]
        return curves.catenary_y(u, c["saddle_z"], c["saddle_z"], c["saddle_z"] - low)
    if s < t0:
        za = curves.profile_at(profile, a0) - 0.5 * spec["detail"]
        u = (s - a0) / (t0 - a0)
        return curves.catenary_y(u, za, c["saddle_z"], c["side_sag"] * (t0 - a0))
    za = curves.profile_at(profile, a1) - 0.5 * spec["detail"]
    u = (s - t1) / (a1 - t1)
    return curves.catenary_y(u, c["saddle_z"], za, c["side_sag"] * (a1 - t1))


def _cables(spec, profile, flags, view, density, builder):
    t0, t1 = spec["towers"]
    a0, a1 = spec["anchorage"]["s"]
    c = spec["cables"]
    main_sag = c["saddle_z"] - (spec["deck"]["mid"] + c["low_above_deck"])
    n_main = view.parabola_segments(main_sag, lo=4, hi=40, density=density)
    n_side = view.parabola_segments(c["side_sag"] * (t0 - a0), lo=2, hi=12, density=density)
    paths = {}
    for x in _cable_xs(spec, flags):
        stations = (
            [a0 + (t0 - a0) * i / n_side for i in range(n_side)]
            + [t0 + (t1 - t0) * i / n_main for i in range(n_main)]
            + [t1 + (a1 - t1) * i / n_side for i in range(n_side + 1)]
        )
        path = [(x, s, cable_z(spec, profile, s)) for s in stations]
        paths[x] = path
        builder.add(loft.tube(path, c["radius"], flags["cable_sides"]), "bridge-tan")
    return paths


def _span_stations(start, end, spacing, keep_clear):
    count = max(1, int(round((end - start) / spacing)))
    step = (end - start) / count
    return [start + i * step for i in range(1, count) if keep_clear <= start + i * step - start <= (end - start) - keep_clear]


def _suspenders(spec, profile, paths, density, view, builder):
    sp = spec["suspender"]
    if not view.shows(sp["width"]):
        return
    t0, t1 = spec["towers"]
    a0, a1 = spec["anchorage"]["s"]
    spacing = sp["spacing"] / max(density, 1e-3)
    k = spec["detail"]
    clear = spec["tower"]["road"][1] / 2 + 2.0 * k
    stations = (_span_stations(a0, t0, spacing, clear) + _span_stations(t0, t1, spacing, clear)
                + _span_stations(t1, a1, spacing, clear))
    prom_top = spec["deck"]["promenade"]["height"] + PROMENADE_RAIL_M * k
    for x in paths:
        deck_top = RAIL_M * k if abs(x) > spec["deck"]["promenade"]["width"] else prom_top
        for s in stations:
            top = cable_z(spec, profile, s)
            bottom = curves.profile_at(profile, s) + deck_top
            if top - bottom < 1.0:
                continue
            builder.add(prim.ribbon((x, s, bottom), (x, s, top), sp["width"] / 2, (0.0, 1.0, 0.0)), "bridge-tan", jitter=False)


def _stays(spec, profile, density, view, builder):
    st = spec["stay"]
    if not view.shows(st["width"]):
        return
    count = max(2, int(round(st["count"] * density)))
    t0, t1 = spec["towers"]
    a0, a1 = spec["anchorage"]["s"]
    saddle = spec["cables"]["saddle_z"]
    d_up = spec["tower"]["road"][1] / 2
    g = spec["detail"]
    fans = [(t0, +1, st["reach_main"]), (t0, -1, min(st["reach_side"], t0 - a0 - 10)),
            (t1, -1, st["reach_main"]), (t1, +1, min(st["reach_side"], a1 - t1 - 10))]
    for x in spec["cables"]["xs"]:
        prom = spec["deck"]["promenade"]
        deck_top = RAIL_M * g if abs(x) > prom["width"] else prom["height"] + PROMENADE_RAIL_M * g
        for tower_s, direction, reach in fans:
            for k in range(1, count + 1):
                s_end = tower_s + direction * (d_up + reach * k / count)
                top = (x, tower_s + direction * d_up, saddle - (2.0 + 1.2 * k * 6 / count) * g)
                bottom = (x, s_end, curves.profile_at(profile, s_end) + deck_top)
                along = (0.0, bottom[1] - top[1], bottom[2] - top[2])
                length = math.sqrt(along[1] ** 2 + along[2] ** 2)
                across = (0.0, -along[2] / length, along[1] / length)
                builder.add(prim.ribbon(top, bottom, st["width"] / 2, across), "bridge-tan", tone=0.94, jitter=False)


def _lamps(spec, profile, density, view, builder):
    lamp = spec["lamp"]
    if not view.shows(lamp["head"]):
        return
    t0, t1 = spec["towers"]
    a0, a1 = spec["anchorage"]["s"]
    spacing = lamp["spacing"] / max(density, 1e-3)
    clear = spec["tower"]["road"][1] / 2 + 4.0 * spec["detail"]
    prom = spec["deck"]["promenade"]
    stations = (_span_stations(a0, t0, spacing, clear) + _span_stations(t0, t1, spacing, clear)
                + _span_stations(t1, a1, spacing, clear))
    for i, s in enumerate(stations):
        side = -1 if i % 2 == 0 else 1
        x = side * (prom["width"] / 2 - 0.4 * spec["detail"])
        z0 = curves.profile_at(profile, s) + prom["height"]
        post = lamp["post"] / 2
        builder.add(prim.box(x - post, x + post, s - post, s + post, z0, z0 + lamp["height"]), "steel-dark", jitter=False)
        h = lamp["head"] / 2
        builder.add(prim.box(x - h, x + h, s - h, s + h, z0 + lamp["height"], z0 + lamp["height"] + lamp["head"]), "lamp",
                    group="windows", jitter=False)


def _necklace(spec, profile, density, view, builder):
    """Lights strung along the outer main cables: the bridge's night silhouette. Each is a small
    diamond (8 triangles) in the lamp colour, so it glows with the night-glow contract."""
    lamp = spec["lamp"]
    size = lamp["head"] * NECKLACE_SCALE
    if not view.shows(size):
        return
    t0, t1 = spec["towers"]
    a0, a1 = spec["anchorage"]["s"]
    spacing = lamp["necklace_spacing"] / max(density, 1e-3)
    clear = spec["tower"]["road"][1] / 2 + spacing / 2
    stations = (_span_stations(a0, t0, spacing, clear) + _span_stations(t0, t1, spacing, clear)
                + _span_stations(t1, a1, spacing, clear))
    outer = max(abs(x) for x in spec["cables"]["xs"])
    lift = spec["cables"]["radius"] + size / 2
    for x in (-outer, outer):
        for s in stations:
            builder.add(prim.diamond((x, s, cable_z(spec, profile, s) + lift), size / 2), "lamp",
                        group="windows", jitter=False)


#: Necklace lights are this many times a promenade lamp head.
NECKLACE_SCALE = 1.3
