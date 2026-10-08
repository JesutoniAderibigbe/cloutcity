"""The Brooklyn arena (a generic label, LEGAL-1: no logos, sponsor or team names, signage or
text): the arena kind of the stadium archetype. A rounded oblong body clad in a weathered-metal
band over a glazed concourse level, a planted roof, and an entrance canopy over the corner
plaza with a round opening whose plain ring screen glows at night.

Numbers come from data/landmarks/measurements/brooklyn-arena.json (Wikidata for the point and
capacity; the rest estimates). Map-oriented: placed at the landmarks.json location, heading 0.
"""

from archetypes import stadium
from cclib import inputs

ARCHETYPE = stadium
CATEGORY = "stadium"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    p = 1.0 if true_scale else game["plan"]
    v = lambda key: m[key]["valueM"]  # noqa: E731
    return {
        "kind": "arena",
        "id": data["id"],
        "detail": (h * p) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "arena": {
            "length": m["length"]["widthM"] * p,
            "width": m["length"]["depthM"] * p,
            "heading": v("headingDeg"),
            "base": v("glazedBaseM") * h,
            "height": expected_height(data, true_scale),
            "cladding": "brick",
            "cladding_tone": 0.72,
            "screen": "screen-white",
            "canopy": {"heading": v("canopyHeadingDeg"), "distance": v("canopyDistanceM") * p,
                       "radius": v("canopyRadiusM") * p, "opening": v("canopyOpeningM") * p,
                       "height": v("canopyM") * h, "thickness": 2.4 * h},
        },
    }


def expected_height(data, true_scale=False):
    return stadium.expected_height(data, true_scale)


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 450.0}
