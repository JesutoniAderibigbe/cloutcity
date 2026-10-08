"""Flushing Meadows Corona Park: the park archetype over the map's park outline (park-qn8191).
Tree masses round the fairgrounds, the open lawns, a long formal pool, Meadow Lake and Willow
Lake; promenades down the park and across the fairgrounds, lamplit at night; at the fair's
central plaza a generic round fountain pool with plain jets (no globe replica, LEGAL-1); generic
observation towers beside an open ring of columns at the exposition pavilion; two generic museum
halls; the tennis grounds paved and the ballpark's ground kept clear for its own model.

Points are Wikidata P625 (CC0) or marked estimates in
data/landmarks/measurements/flushing-meadows.json. Map-oriented: placed at the landmarks.json
location with heading 0.
"""

from archetypes import park
from cclib import inputs

ARCHETYPE = park
CATEGORY = "park"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    read = data["measurements"]["readabilityScale"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    s = 1.0 if true_scale else read["structures"]
    v = lambda key: m[key]["valueM"]  # noqa: E731
    area, local = park.map_frame(data)
    axis = v("parkHeadingDeg")

    def at(key):
        return local(m[key]["lat"], m[key]["lng"])

    def clearing(key, kind, heading, tone=1.0):
        x, y = at(key)
        axes = m[key + "Axes"]
        return {"kind": kind, "cx": x, "cy": y, "rx": axes["widthM"], "ry": axes["depthM"], "heading": heading,
                "tone": tone}

    bx, by = at("ballpark")
    clear = v("ballparkClearM")
    clearings = [
        clearing("meadowLake", "water", axis),
        clearing("willowLake", "water", axis),
        clearing("longPool", "water", v("longPoolHeadingDeg")),
        clearing("fairLawn", "lawn", axis, 1.2),
        clearing("tennis", "plaza", axis),
        {"kind": "keep", "cx": bx, "cy": by, "rx": clear, "ry": clear, "heading": 0.0},
    ]

    def line(prefix):
        pts = []
        i = 0
        while "%s%d" % (prefix, i) in m:
            pts.append(at("%s%d" % (prefix, i)))
            i += 1
        return pts

    width = v("pathWidthM") * read["paths"]
    paths = [{"points": line(name), "width": width, "closed": False, "lamps": v("lampSpacingM"), "role": "granite",
              "tone": 1.0, "lit": True} for name in ("spine", "cross")]
    fx, fy = at("fountainPool")
    px, py = at("pavilion")
    deck_r, shaft_r = v("towerDeckRadiusM") * s, v("towerShaftRadiusM") * s
    top = expected_height(data, true_scale)
    if abs(v("towerHighM") - v("heightM")) > 0.01:
        raise ValueError("the tallest tower's deck must be the measured height")
    shafts = [
        {"dx": -80.0 * s, "dy": -30.0 * s, "r": shaft_r, "deck": top, "deck_r": deck_r, "deck_t": 5.0 * h},
        {"dx": -95.0 * s, "dy": 5.0 * s, "r": shaft_r, "deck": v("towerMidM") * h, "deck_r": deck_r * 0.9,
         "deck_t": 4.0 * h},
        {"dx": -65.0 * s, "dy": 15.0 * s, "r": shaft_r, "deck": v("towerLowM") * h, "deck_r": deck_r * 1.1,
         "deck_t": 3.0 * h},
    ]
    structures = [
        {"kind": "fountain", "x": fx, "y": fy, "radius": v("fountainRadiusM") * s, "jets": 12,
         "jet_h": v("jetM") * h, "clear": v("fountainRadiusM") * s + 25.0},
        {"kind": "towers", "x": px, "y": py, "shafts": shafts,
         "ring": {"dx": 0.0, "dy": 0.0, "rx": m["ringAxes"]["widthM"] * s, "ry": m["ringAxes"]["depthM"] * s,
                  "h": v("ringM") * h, "columns": m["ringColumns"]["count"]},
         "clear": 140.0 * s},
    ]
    for key in ("museum", "science"):
        x, y = at(key)
        plan = m[key + "Plan"]
        structures.append({"kind": "hall", "x": x, "y": y, "heading": axis, "length": plan["widthM"] * s,
                           "width": plan["depthM"] * s, "height": v(key + "M") * h,
                           "clear": 0.6 * plan["widthM"] * s + 10.0})
    return {
        "id": data["id"],
        "detail": (h * s) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "area": area,
        "inset": 18.0,
        "trees": {"spacing": v("treeSpacingM"), "height": (v("treeLowM") * h, v("treeHighM") * h)},
        "clearings": clearings,
        "paths": paths,
        "lamp_head": 0.5 * read["lamp"],
        "structures": structures,
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 1200.0, "green": [polygon[0] for polygon in spec["area"]]}


def exclusions(spec):
    """None: the map already draws the park's green, and its own data keeps buildings out."""
    return []
