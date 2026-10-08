"""The High Line: the elevated park archetype along its route from Gansevoort Street up the
avenue grid to 30th Street, west to 12th Avenue, north to 34th Street and east along it. A steel
deck on column pairs, railed, with a lamplit walk between planting beds of shrubs and small
trees (no signs or text, LEGAL-1).

The route points are estimates (no PD/CC0 alignment found) in
data/landmarks/measurements/high-line.json, checked against the Wikidata length. Map-oriented:
chunk 4 places it at the landmarks.json location with heading 0.
"""

import math

from archetypes import elevated, park
from cclib import inputs

ARCHETYPE = elevated
CATEGORY = "park"

#: The route may differ from the Wikidata length by this fraction.
LENGTH_TOLERANCE = 0.1


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    read = data["measurements"]["readabilityScale"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else read["deck"]
    v = lambda key: m[key]["valueM"]  # noqa: E731
    local = park.local_frame(data)
    route = []
    i = 0
    while "route%d" % i in m:
        route.append(local(m["route%d" % i]["lat"], m["route%d" % i]["lng"]))
        i += 1
    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(route, route[1:]))
    if abs(length - v("lengthM")) > LENGTH_TOLERANCE * v("lengthM"):
        raise ValueError("the route is %.0f m, Wikidata says %.0f m" % (length, v("lengthM")))
    if abs(v("elevationM") + v("treeHighM") - v("heightM")) > 0.01:
        raise ValueError("the elevation and the tallest tree must add up to the height")
    return {
        "id": data["id"],
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "route": route,
        "corner_radius": v("cornerRadiusM"),
        "elevation": v("elevationM") * h,
        "deck": {"width": v("deckWidthM") * w, "thickness": v("deckThicknessM") * h, "girder": v("girderM") * h},
        "walk": v("walkWidthM") * w,
        "columns": {"spacing": v("columnSpacingM"), "width": v("columnWidthM") * read["columns"]},
        "beds": {"tree_spacing": v("treeSpacingM"), "shrub_spacing": v("shrubSpacingM"),
                 "tree_height": (v("treeLowM") * h, v("treeHighM") * h)},
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 600.0}
