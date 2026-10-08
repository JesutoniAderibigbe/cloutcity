"""Central Park: the park archetype over the map's park outline (data/geo/parks.derived.json
park-mn6491). Tree masses fill it around the open lawns (Sheep Meadow, the Great Lawn, North
Meadow) and the water (the Reservoir, the Lake, Turtle Pond, Harlem Meer, the Pond,
Conservatory Water), with the loop drive and the Mall, lamps along the drive, a generic terrace
and fountain where Bethesda Terrace stands and a generic folly on its rock where Belvedere
Castle stands (LEGAL-1: no statue, sign or text).

Feature points are Wikidata P625 coordinates (CC0) or marked estimates in
data/landmarks/measurements/central-park.json. Map-oriented: placed at the landmarks.json
location with heading 0.
"""

from archetypes import park
from cclib import inputs

ARCHETYPE = park
CATEGORY = "park"


def best_heading(points):
    """The compass heading (whole degrees) of the long axis of the smallest box round points."""
    best = None
    for deg in range(180):
        _c, half_l, half_w = park.oriented_box(points, deg)
        if best is None or half_l * half_w < best[0]:
            best = (half_l * half_w, deg if half_l >= half_w else (deg + 90) % 180)
    return best[1]


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    read = data["measurements"]["readabilityScale"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    s = 1.0 if true_scale else read["structures"]
    k = (h * s) ** 0.5
    v = lambda key: m[key]["valueM"]  # noqa: E731
    area, local = park.map_frame(data)
    outline = [p for polygon in area for p in polygon[0]]
    heading = best_heading(outline)
    centre, half_l, half_w = park.oriented_box(outline, heading)

    def at(key):
        return local(m[key]["lat"], m[key]["lng"])

    def clearing(key, kind):
        x, y = at(key)
        axes = m[key + "Axes"]
        return {"kind": kind, "cx": x, "cy": y, "rx": axes["widthM"], "ry": axes["depthM"], "heading": heading}

    clearings = [dict(clearing(key, "lawn"), tone=1.2) for key in ("sheepMeadow", "greatLawn", "northMeadow")]
    clearings += [clearing(key, "water") for key in ("reservoir", "lake", "turtlePond", "harlemMeer", "pond",
                                                      "conservatoryWater")]
    inset_side, inset_end = m["driveInset"]["widthM"], m["driveInset"]["depthM"]
    la, lw = half_l - inset_end, half_w - inset_side
    # The loop drive: the long sides joined round each end.
    drive = [park.axis_point(centre, heading, a, c) for a, c in (
        (-la + 0.4 * lw, -lw), (la - 0.4 * lw, -lw), (la, -0.4 * lw), (la, 0.4 * lw), (la - 0.4 * lw, lw),
        (-la + 0.4 * lw, lw), (-la, 0.4 * lw), (-la, -0.4 * lw))]
    bx, by = at("bethesda")
    paths = [
        {"points": drive, "width": v("driveWidthM") * read["paths"], "closed": True,
         "lamps": v("lampSpacingM"), "role": "asphalt", "tone": 1.15, "lit": True},
        {"points": [at("mallSouth"), park.axis_point((bx, by), heading, -0.5 * m["terrace"]["depthM"] * s, 0.0)],
         "width": v("mallWidthM") * read["paths"], "closed": False, "lamps": 0, "role": "granite", "lit": True},
    ]
    fx, fy = at("belvedere")
    land_top = inputs.land_top_y(data["scene"])
    return {
        "id": data["id"],
        "detail": k,
        "land_top": land_top,
        "area": area,
        "inset": 18.0,
        "trees": {"spacing": v("treeSpacingM"), "height": (v("treeLowM") * h, v("treeHighM") * h)},
        "clearings": clearings,
        "paths": paths,
        "lamp_head": 0.5 * read["lamp"],
        "structures": [
            {"kind": "terrace", "x": bx, "y": by, "heading": heading, "width": m["terrace"]["widthM"] * s,
             "depth": m["terrace"]["depthM"] * s, "height": v("terraceM") * h, "fountain": v("fountainRadiusM") * s,
             "fountain_h": v("fountainM") * h, "clear": 0.6 * m["terrace"]["widthM"] * s},
            {"kind": "folly", "x": fx, "y": fy, "rock_h": v("rockM") * h, "rock_r": v("rockRadiusM") * s,
             "keep": m["keep"]["widthM"] * s, "keep_h": m["keep"]["depthM"] * h, "tower_w": v("towerWidthM") * s,
             "roof_h": v("towerRoofM") * h, "top": expected_height(data, true_scale),
             "clear": v("rockRadiusM") * s},
        ],
        "heading": heading,
        "half": (half_l, half_w),
        "centre": centre,
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 900.0, "green": [polygon[0] for polygon in spec["area"]]}



def exclusions(spec):
    """None: the map already draws the park's green, and its own data keeps buildings out."""
    return []
