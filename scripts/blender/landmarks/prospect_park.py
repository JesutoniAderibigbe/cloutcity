"""Prospect Park: the park archetype over the map's park outline (park-bk5591). Tree masses
around the Long Meadow, the Nethermead, Prospect Park Lake and the Lullwater; the loop drive,
lamplit at night; a generic pavilion and terrace where the boathouse stands and a generic villa
with a square tower where Litchfield Villa stands (no signs or text, LEGAL-1).

Points are Wikidata P625 (CC0) or marked estimates in
data/landmarks/measurements/prospect-park.json. Map-oriented: placed at the landmarks.json
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

    def at(key):
        return local(m[key]["lat"], m[key]["lng"])

    def clearing(key, kind, heading, tone=1.0):
        x, y = at(key)
        axes = m[key + "Axes"]
        return {"kind": kind, "cx": x, "cy": y, "rx": axes["widthM"], "ry": axes["depthM"], "heading": heading,
                "tone": tone}

    meadow = v("longMeadowHeadingDeg")
    clearings = [
        clearing("longMeadowNorth", "lawn", meadow, 1.2),
        clearing("longMeadowSouth", "lawn", meadow, 1.2),
        clearing("nethermead", "lawn", meadow, 1.2),
        clearing("lake", "water", v("lakeHeadingDeg")),
        clearing("lullwater", "water", 180.0),
    ]
    drive = []
    i = 0
    while "drive%d" % i in m:
        drive.append(at("drive%d" % i))
        i += 1
    bx, by = at("boathouse")
    vx, vy = at("villa")
    return {
        "id": data["id"],
        "detail": (h * s) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "area": area,
        "inset": 18.0,
        "trees": {"spacing": v("treeSpacingM"), "height": (v("treeLowM") * h, v("treeHighM") * h)},
        "clearings": clearings,
        "paths": [{"points": drive, "width": v("driveWidthM") * read["paths"], "closed": True,
                   "lamps": v("lampSpacingM"), "role": "asphalt", "tone": 1.15, "lit": True}],
        "lamp_head": 0.5 * read["lamp"],
        "structures": [
            # The boathouse faces the Lullwater, south of it.
            {"kind": "terrace", "x": bx, "y": by, "heading": 180.0, "width": m["boathouse2"]["widthM"] * s,
             "depth": m["boathouse2"]["depthM"] * s, "height": v("boathouseM") * h, "fountain": 0.0,
             "fountain_h": 0.0, "clear": 0.6 * m["boathouse2"]["widthM"] * s},
            {"kind": "folly", "x": vx, "y": vy, "rock_h": 1.0 * h, "rock_r": 20.0 * s,
             "keep": m["villaKeep"]["widthM"] * s, "keep_h": m["villaKeep"]["depthM"] * h,
             "tower_w": v("villaTowerWidthM") * s, "roof_h": v("villaRoofM") * h,
             "top": expected_height(data, true_scale), "clear": 22.0 * s},
        ],
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 900.0, "green": [polygon[0] for polygon in spec["area"]]}
